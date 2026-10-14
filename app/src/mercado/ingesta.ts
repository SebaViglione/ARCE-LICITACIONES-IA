import type pg from 'pg';
import { pool as poolDefault } from '../db/pool.js';
import { logger } from '../logger.js';
import type { ArticuloIngesta, CategoriaIngesta, LlamadoIngesta, LoteArticulosIngesta, LoteCotizacionesIngesta, LoteLlamadosIngesta, LoteProveedoresIngesta, OrganismoIngesta, ProveedorIngesta } from './esquema.js';
import { claveOrganismo, grupoTipoCompra, hashCanonico, normalizarEstado, normalizarMoneda, normalizarRut, normalizarTexto, normalizarUnidad } from './normalizar.js';
import { programarRefresco } from './estadisticas.js';

// Ingesta del histórico de ARCE. Cada llamado llega como un snapshot completo (ítems, ofertas,
// adjudicaciones) y se guarda en dos capas: el payload crudo con su hash (idempotencia, reproceso)
// y las tablas normalizadas. Un llamado ya recibido con el mismo contenido no toca nada; uno que
// cambió (por ejemplo, pasó de publicado a adjudicado) reemplaza sus hijos dentro de una transacción.

export interface Rechazo {
  indice: number;
  clave: string;
  error: string;
}

export interface ResultadoIngesta {
  lote_id: number;
  recibidos: number;
  insertados: number;
  actualizados: number;
  sin_cambios: number;
  rechazados: Rechazo[];
  duracion_ms: number;
}

interface Opciones {
  pool?: pg.Pool;
  /** false para no programar el refresco de estadísticas (tests, cargas masivas con refresco manual al final). */
  refrescar?: boolean;
}

type Db = pg.PoolClient | pg.Pool;

interface Caches {
  organismos: Map<string, number>;
  proveedores: Map<string, number>;
  articulos: Map<string, number>;
  categorias: Map<string, { id: number; raizId: number }>;
}

function nuevosCaches(): Caches {
  return { organismos: new Map(), proveedores: new Map(), articulos: new Map(), categorias: new Map() };
}

// ---------------------------------------------------------------------------
// Dimensiones
// ---------------------------------------------------------------------------

async function obtenerOrganismo(db: Db, o: OrganismoIngesta, caches: Caches): Promise<number> {
  const clave = claveOrganismo(o.inciso, o.unidad_ejecutora);
  const cacheado = caches.organismos.get(clave);
  if (cacheado) return cacheado;
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO mercado.organismos (inciso, unidad_ejecutora, clave, codigo_inciso, codigo_unidad)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (clave) DO UPDATE SET
       inciso = EXCLUDED.inciso,
       unidad_ejecutora = EXCLUDED.unidad_ejecutora,
       codigo_inciso = COALESCE(EXCLUDED.codigo_inciso, mercado.organismos.codigo_inciso),
       codigo_unidad = COALESCE(EXCLUDED.codigo_unidad, mercado.organismos.codigo_unidad),
       actualizado_en = now()
     RETURNING id`,
    [o.inciso, o.unidad_ejecutora ?? '', clave, o.codigo_inciso ?? null, o.codigo_unidad ?? null],
  );
  const id = rows[0]!.id;
  caches.organismos.set(clave, id);
  return id;
}

export async function obtenerProveedor(db: Db, p: ProveedorIngesta, caches: Caches): Promise<number> {
  const rut = normalizarRut(p.rut);
  const nombreNorm = normalizarTexto(p.nombre) || 'SIN NOMBRE';
  const clave = rut ? `rut:${rut}` : `nombre:${nombreNorm}`;
  const cacheado = caches.proveedores.get(clave);
  if (cacheado) return cacheado;

  let id: number;
  if (rut) {
    // Si antes se cargó sin RUT con el mismo nombre, se le asigna el RUT y se fusiona.
    await db.query(`UPDATE mercado.proveedores SET rut = $1, actualizado_en = now() WHERE rut IS NULL AND nombre_normalizado = $2`, [rut, nombreNorm]);
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO mercado.proveedores (rut, nombre, nombre_normalizado, pais)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (rut) DO UPDATE SET
         nombre = EXCLUDED.nombre,
         nombre_normalizado = EXCLUDED.nombre_normalizado,
         pais = COALESCE(EXCLUDED.pais, mercado.proveedores.pais),
         actualizado_en = now()
       RETURNING id`,
      [rut, p.nombre, nombreNorm, p.pais ?? null],
    );
    id = rows[0]!.id;
  } else {
    const existente = await db.query<{ id: number }>(`SELECT id FROM mercado.proveedores WHERE nombre_normalizado = $1 ORDER BY (rut IS NOT NULL) DESC, id LIMIT 1`, [nombreNorm]);
    if (existente.rows[0]) {
      id = existente.rows[0].id;
    } else {
      const { rows } = await db.query<{ id: number }>(
        `INSERT INTO mercado.proveedores (rut, nombre, nombre_normalizado, pais)
         VALUES (NULL, $1, $2, $3)
         ON CONFLICT (nombre_normalizado) WHERE rut IS NULL DO UPDATE SET actualizado_en = now()
         RETURNING id`,
        [p.nombre, nombreNorm, p.pais ?? null],
      );
      id = rows[0]!.id;
    }
  }
  caches.proveedores.set(clave, id);
  return id;
}

async function obtenerCategoria(db: Db, c: CategoriaIngesta, caches: Caches): Promise<number | null> {
  const niveles = [c.familia, c.subfamilia, c.clase].filter((n): n is string => !!n);
  let padre: { id: number; raizId: number } | null = null;
  let ruta = '';
  for (const [i, nombre] of niveles.entries()) {
    ruta = ruta ? `${ruta} > ${nombre}` : nombre;
    const cacheado = caches.categorias.get(ruta);
    if (cacheado) {
      padre = cacheado;
      continue;
    }
    // Array declarado aparte: evita que TS infiera el tipo de `rows` a partir de `padre` (referencia circular en el bucle).
    const params: unknown[] = [nombre, padre ? padre.id : null, padre ? padre.raizId : null, i + 1, ruta];
    const { rows } = await db.query<{ id: number; raiz_id: number | null }>(
      `INSERT INTO mercado.categorias (nombre, padre_id, raiz_id, nivel, ruta)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (padre_id, nombre) DO UPDATE SET ruta = EXCLUDED.ruta
       RETURNING id, raiz_id`,
      params,
    );
    const fila = rows[0]!;
    let raizId = fila.raiz_id;
    if (raizId === null) {
      raizId = fila.id;
      await db.query(`UPDATE mercado.categorias SET raiz_id = $1 WHERE id = $1`, [fila.id]);
    }
    padre = { id: fila.id, raizId };
    caches.categorias.set(ruta, padre);
  }
  return padre?.id ?? null;
}

export async function obtenerArticulo(db: Db, a: ArticuloIngesta, caches: Caches): Promise<number> {
  const codigo = a.codigo?.trim() || null;
  const nombreNorm = normalizarTexto(a.nombre) || 'SIN NOMBRE';
  const clave = codigo ? `codigo:${codigo}` : `nombre:${nombreNorm}`;
  const cacheado = caches.articulos.get(clave);
  if (cacheado) return cacheado;

  const categoriaId = a.categoria ? await obtenerCategoria(db, a.categoria, caches) : null;
  const unidad = a.unidad ? normalizarUnidad(a.unidad) : null;
  let id: number;
  if (codigo) {
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO mercado.articulos (codigo, nombre, nombre_normalizado, categoria_id, unidad_habitual)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (codigo) DO UPDATE SET
         nombre = EXCLUDED.nombre,
         nombre_normalizado = EXCLUDED.nombre_normalizado,
         categoria_id = COALESCE(EXCLUDED.categoria_id, mercado.articulos.categoria_id),
         unidad_habitual = COALESCE(EXCLUDED.unidad_habitual, mercado.articulos.unidad_habitual),
         actualizado_en = now()
       RETURNING id`,
      [codigo, a.nombre, nombreNorm, categoriaId, unidad],
    );
    id = rows[0]!.id;
  } else {
    const existente = await db.query<{ id: number }>(`SELECT id FROM mercado.articulos WHERE nombre_normalizado = $1 ORDER BY (codigo IS NOT NULL) DESC, id LIMIT 1`, [nombreNorm]);
    if (existente.rows[0]) {
      id = existente.rows[0].id;
      if (categoriaId || unidad) {
        await db.query(`UPDATE mercado.articulos SET categoria_id = COALESCE(categoria_id, $2), unidad_habitual = COALESCE(unidad_habitual, $3), actualizado_en = now() WHERE id = $1`, [id, categoriaId, unidad]);
      }
    } else {
      const { rows } = await db.query<{ id: number }>(
        `INSERT INTO mercado.articulos (codigo, nombre, nombre_normalizado, categoria_id, unidad_habitual)
         VALUES (NULL, $1, $2, $3, $4)
         ON CONFLICT (nombre_normalizado) WHERE codigo IS NULL DO UPDATE SET actualizado_en = now()
         RETURNING id`,
        [a.nombre, nombreNorm, categoriaId, unidad],
      );
      id = rows[0]!.id;
    }
  }
  caches.articulos.set(clave, id);
  return id;
}

// ---------------------------------------------------------------------------
// Llamados
// ---------------------------------------------------------------------------

/** "($1,$2,$3),($4,$5,$6)" con los parámetros aplanados. Las columnas son constantes del código. */
function filasSql(filas: unknown[][]): { valores: string; params: unknown[] } {
  const params: unknown[] = [];
  const valores = filas
    .map((f) => `(${f.map((v) => `$${params.push(v)}`).join(',')})`)
    .join(',');
  return { valores, params };
}

async function guardarLlamado(c: pg.PoolClient, ll: LlamadoIngesta, fuente: string, crudoId: number | null, caches: Caches): Promise<{ id: number; insertado: boolean }> {
  const organismoId = ll.organismo ? await obtenerOrganismo(c, ll.organismo, caches) : null;
  const tieneAdjudicaciones = ll.items.some((i) => i.adjudicaciones.length > 0);
  const fechaAdjudicacion = ll.fecha_adjudicacion ?? ll.items.flatMap((i) => i.adjudicaciones).find((a) => a.fecha)?.fecha ?? null;
  const anio = ll.anio ?? (ll.fecha_publicacion ? Number(ll.fecha_publicacion.slice(0, 4)) : null);

  const { rows } = await c.query<{ id: number; insertado: boolean }>(
    `INSERT INTO mercado.llamados (arce_id, tipo_compra, tipo_compra_grupo, numero, anio, organismo_id, objeto, estado, estado_original,
                                   fecha_publicacion, fecha_apertura, fecha_adjudicacion, moneda, url, fuente, crudo_id, actualizado_en)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, now())
     ON CONFLICT (arce_id) DO UPDATE SET
       tipo_compra = COALESCE(EXCLUDED.tipo_compra, mercado.llamados.tipo_compra),
       tipo_compra_grupo = CASE WHEN EXCLUDED.tipo_compra_grupo = 'otro' THEN mercado.llamados.tipo_compra_grupo ELSE EXCLUDED.tipo_compra_grupo END,
       numero = COALESCE(EXCLUDED.numero, mercado.llamados.numero),
       anio = COALESCE(EXCLUDED.anio, mercado.llamados.anio),
       organismo_id = COALESCE(EXCLUDED.organismo_id, mercado.llamados.organismo_id),
       objeto = COALESCE(EXCLUDED.objeto, mercado.llamados.objeto),
       estado = EXCLUDED.estado,
       estado_original = COALESCE(EXCLUDED.estado_original, mercado.llamados.estado_original),
       fecha_publicacion = COALESCE(EXCLUDED.fecha_publicacion, mercado.llamados.fecha_publicacion),
       fecha_apertura = COALESCE(EXCLUDED.fecha_apertura, mercado.llamados.fecha_apertura),
       fecha_adjudicacion = COALESCE(EXCLUDED.fecha_adjudicacion, mercado.llamados.fecha_adjudicacion),
       moneda = COALESCE(EXCLUDED.moneda, mercado.llamados.moneda),
       url = COALESCE(EXCLUDED.url, mercado.llamados.url),
       fuente = EXCLUDED.fuente,
       crudo_id = EXCLUDED.crudo_id,
       actualizado_en = now()
     RETURNING id, (xmax = 0) AS insertado`,
    [
      ll.arce_id,
      ll.tipo_compra,
      grupoTipoCompra(ll.tipo_compra),
      ll.numero,
      anio,
      organismoId,
      ll.objeto,
      normalizarEstado(ll.estado, tieneAdjudicaciones),
      ll.estado,
      ll.fecha_publicacion,
      ll.fecha_apertura,
      fechaAdjudicacion,
      ll.moneda ? normalizarMoneda(ll.moneda) : null,
      ll.url,
      fuente,
      crudoId,
    ],
  );
  const llamadoId = rows[0]!.id;

  // Los hijos se reemplazan completos: el payload es el snapshot de la página.
  await c.query(`DELETE FROM mercado.items WHERE llamado_id = $1`, [llamadoId]);
  if (ll.items.length === 0) return { id: llamadoId, insertado: rows[0]!.insertado };

  const filasItems: unknown[][] = [];
  for (const it of ll.items) {
    const articuloId = it.articulo ? await obtenerArticulo(c, it.articulo, caches) : null;
    filasItems.push([
      llamadoId,
      it.nro_item,
      articuloId,
      it.descripcion ?? it.articulo?.nombre ?? null,
      it.cantidad,
      it.unidad ?? it.articulo?.unidad ?? null,
      normalizarUnidad(it.unidad ?? it.articulo?.unidad),
      it.variante,
      it.presentacion,
      it.detalle,
      it.marca,
    ]);
  }
  const { valores, params } = filasSql(filasItems);
  const ins = await c.query<{ id: number; nro_item: number }>(
    `INSERT INTO mercado.items (llamado_id, nro_item, articulo_id, descripcion, cantidad, unidad, unidad_normalizada, variante, presentacion, detalle, marca)
     VALUES ${valores} RETURNING id, nro_item`,
    params,
  );
  const idPorNro = new Map(ins.rows.map((r) => [r.nro_item, r.id]));

  const filasOfertas: unknown[][] = [];
  const filasAdj: unknown[][] = [];
  for (const it of ll.items) {
    const itemId = idPorNro.get(it.nro_item)!;
    const nroPorProveedor = new Map<number, number>();
    for (const o of it.ofertas) {
      const proveedorId = await obtenerProveedor(c, o.proveedor, caches);
      const nro = (nroPorProveedor.get(proveedorId) ?? 0) + 1;
      nroPorProveedor.set(proveedorId, nro);
      filasOfertas.push([itemId, proveedorId, nro, o.precio_unitario, normalizarMoneda(o.moneda ?? ll.moneda), o.impuestos_incluidos, o.tasa_impuestos, o.cantidad, o.monto_total, o.plazo_entrega, o.marca, o.observaciones]);
    }
    nroPorProveedor.clear();
    for (const a of it.adjudicaciones) {
      const proveedorId = await obtenerProveedor(c, a.proveedor, caches);
      const nro = (nroPorProveedor.get(proveedorId) ?? 0) + 1;
      nroPorProveedor.set(proveedorId, nro);
      filasAdj.push([itemId, proveedorId, nro, a.cantidad ?? it.cantidad, a.precio_unitario, normalizarMoneda(a.moneda ?? ll.moneda), a.impuestos_incluidos, a.tasa_impuestos, a.monto_total, a.monto_total_con_impuestos, a.fecha ?? fechaAdjudicacion, a.resolucion]);
    }
  }
  if (filasOfertas.length) {
    const f = filasSql(filasOfertas);
    await c.query(
      `INSERT INTO mercado.ofertas (item_id, proveedor_id, nro_oferta, precio_unitario, moneda, impuestos_incluidos, tasa_impuestos, cantidad, monto_total, plazo_entrega, marca, observaciones)
       VALUES ${f.valores}`,
      f.params,
    );
  }
  if (filasAdj.length) {
    const f = filasSql(filasAdj);
    await c.query(
      `INSERT INTO mercado.adjudicaciones (item_id, proveedor_id, nro, cantidad, precio_unitario, moneda, impuestos_incluidos, tasa_impuestos, monto_total, monto_total_con_impuestos, fecha, resolucion)
       VALUES ${f.valores}`,
      f.params,
    );
  }
  return { id: llamadoId, insertado: rows[0]!.insertado };
}

async function crearLote(pool: pg.Pool, tipo: string, fuente: string, recibidos: number): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(`INSERT INTO mercado.lotes (tipo, fuente, recibidos) VALUES ($1, $2, $3) RETURNING id`, [tipo, fuente, recibidos]);
  return rows[0]!.id;
}

async function finalizarLote(pool: pg.Pool, r: ResultadoIngesta): Promise<void> {
  await pool.query(
    `UPDATE mercado.lotes SET finalizado_en = now(), insertados = $2, actualizados = $3, sin_cambios = $4, rechazados = $5, errores = $6, duracion_ms = $7 WHERE id = $1`,
    [r.lote_id, r.insertados, r.actualizados, r.sin_cambios, r.rechazados.length, r.rechazados.length ? JSON.stringify(r.rechazados.slice(0, 200)) : null, r.duracion_ms],
  );
}

function mensajeError(err: unknown): string {
  const e = err as { message?: string; detail?: string; code?: string };
  return [e.message, e.detail].filter(Boolean).join(' · ').slice(0, 1000) || String(err);
}

/** Ingesta un lote de llamados. Idempotente: el mismo payload no se vuelve a procesar. */
export async function ingestarLlamados(lote: LoteLlamadosIngesta, opciones: Opciones = {}): Promise<ResultadoIngesta> {
  const pool = opciones.pool ?? poolDefault;
  const inicio = Date.now();
  const r: ResultadoIngesta = { lote_id: await crearLote(pool, 'llamados', lote.fuente, lote.llamados.length), recibidos: lote.llamados.length, insertados: 0, actualizados: 0, sin_cambios: 0, rechazados: [], duracion_ms: 0 };
  let caches = nuevosCaches();

  const client = await pool.connect();
  try {
    for (const [indice, ll] of lote.llamados.entries()) {
      const hash = hashCanonico(ll);
      const visto = await client.query(`SELECT 1 FROM mercado.crudos WHERE tipo = 'llamado' AND clave = $1 AND hash = $2 AND procesado_en IS NOT NULL LIMIT 1`, [ll.arce_id, hash]);
      if (visto.rowCount) {
        r.sin_cambios++;
        continue;
      }
      const crudo = await client.query<{ id: number }>(`INSERT INTO mercado.crudos (lote_id, tipo, clave, hash, payload) VALUES ($1, 'llamado', $2, $3, $4) RETURNING id`, [r.lote_id, ll.arce_id, hash, JSON.stringify(ll)]);
      const crudoId = crudo.rows[0]!.id;
      try {
        await client.query('BEGIN');
        const g = await guardarLlamado(client, ll, lote.fuente, crudoId, caches);
        await client.query(`UPDATE mercado.crudos SET procesado_en = now() WHERE id = $1`, [crudoId]);
        await client.query('COMMIT');
        if (g.insertado) r.insertados++;
        else r.actualizados++;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        caches = nuevosCaches(); // ids creados dentro de la transacción ya no existen
        const error = mensajeError(err);
        await client.query(`UPDATE mercado.crudos SET error = $2 WHERE id = $1`, [crudoId, error]).catch(() => undefined);
        r.rechazados.push({ indice, clave: ll.arce_id, error });
      }
    }
  } finally {
    client.release();
  }

  r.duracion_ms = Date.now() - inicio;
  await finalizarLote(pool, r);
  logger.info({ lote: r.lote_id, fuente: lote.fuente, recibidos: r.recibidos, insertados: r.insertados, actualizados: r.actualizados, sin_cambios: r.sin_cambios, rechazados: r.rechazados.length, duracion_ms: r.duracion_ms }, 'lote de llamados ingresado');
  if (opciones.refrescar !== false && r.insertados + r.actualizados > 0) programarRefresco('ingesta', { pool });
  return r;
}

export async function ingestarCotizaciones(lote: LoteCotizacionesIngesta, opciones: Opciones = {}): Promise<ResultadoIngesta> {
  const pool = opciones.pool ?? poolDefault;
  const inicio = Date.now();
  const r: ResultadoIngesta = { lote_id: await crearLote(pool, 'cotizaciones', 'api', lote.cotizaciones.length), recibidos: lote.cotizaciones.length, insertados: 0, actualizados: 0, sin_cambios: 0, rechazados: [], duracion_ms: 0 };
  for (const [indice, c] of lote.cotizaciones.entries()) {
    try {
      const { rows } = await pool.query<{ insertado: boolean; cambio: boolean }>(
        `INSERT INTO mercado.cotizaciones (moneda, fecha, valor_uyu, fuente) VALUES ($1, $2, $3, $4)
         ON CONFLICT (moneda, fecha) DO UPDATE SET valor_uyu = EXCLUDED.valor_uyu, fuente = COALESCE(EXCLUDED.fuente, mercado.cotizaciones.fuente)
         RETURNING (xmax = 0) AS insertado, (valor_uyu IS DISTINCT FROM $3::numeric) AS cambio`,
        [normalizarMoneda(c.moneda), c.fecha, c.valor_uyu, c.fuente ?? null],
      );
      if (rows[0]!.insertado) r.insertados++;
      else r.actualizados++;
    } catch (err) {
      r.rechazados.push({ indice, clave: `${c.moneda} ${c.fecha}`, error: mensajeError(err) });
    }
  }
  r.duracion_ms = Date.now() - inicio;
  await finalizarLote(pool, r);
  if (opciones.refrescar !== false && r.insertados + r.actualizados > 0) programarRefresco('ingesta', { pool });
  return r;
}

export async function ingestarArticulos(lote: LoteArticulosIngesta, opciones: Opciones = {}): Promise<ResultadoIngesta> {
  const pool = opciones.pool ?? poolDefault;
  const inicio = Date.now();
  const r: ResultadoIngesta = { lote_id: await crearLote(pool, 'articulos', 'api', lote.articulos.length), recibidos: lote.articulos.length, insertados: 0, actualizados: 0, sin_cambios: 0, rechazados: [], duracion_ms: 0 };
  const caches = nuevosCaches();
  for (const [indice, a] of lote.articulos.entries()) {
    try {
      await obtenerArticulo(pool, a, caches);
      r.actualizados++;
    } catch (err) {
      r.rechazados.push({ indice, clave: a.codigo ?? a.nombre, error: mensajeError(err) });
    }
  }
  r.duracion_ms = Date.now() - inicio;
  await finalizarLote(pool, r);
  if (opciones.refrescar !== false && r.actualizados > 0) programarRefresco('ingesta', { pool });
  return r;
}

export async function ingestarProveedores(lote: LoteProveedoresIngesta, opciones: Opciones = {}): Promise<ResultadoIngesta> {
  const pool = opciones.pool ?? poolDefault;
  const inicio = Date.now();
  const r: ResultadoIngesta = { lote_id: await crearLote(pool, 'proveedores', 'api', lote.proveedores.length), recibidos: lote.proveedores.length, insertados: 0, actualizados: 0, sin_cambios: 0, rechazados: [], duracion_ms: 0 };
  const caches = nuevosCaches();
  for (const [indice, p] of lote.proveedores.entries()) {
    try {
      await obtenerProveedor(pool, p, caches);
      r.actualizados++;
    } catch (err) {
      r.rechazados.push({ indice, clave: normalizarRut(p.rut) ?? p.nombre, error: mensajeError(err) });
    }
  }
  r.duracion_ms = Date.now() - inicio;
  await finalizarLote(pool, r);
  return r;
}

/**
 * Vuelve a normalizar los llamados a partir del último crudo de cada uno. Sirve cuando cambian las
 * reglas de normalización (unidades, estados, categorías) sin pedirle al scraper que reenvíe todo.
 */
export async function reprocesarCrudos(opciones: Opciones & { desdeLote?: number; limite?: number } = {}): Promise<ResultadoIngesta> {
  const pool = opciones.pool ?? poolDefault;
  const inicio = Date.now();
  const { rows } = await pool.query<{ id: number; clave: string; payload: LlamadoIngesta; fuente: string }>(
    `SELECT DISTINCT ON (c.clave) c.id, c.clave, c.payload, COALESCE(l.fuente, 'reproceso') AS fuente
       FROM mercado.crudos c
       LEFT JOIN mercado.lotes l ON l.id = c.lote_id
      WHERE c.tipo = 'llamado' AND c.procesado_en IS NOT NULL AND ($1::bigint IS NULL OR c.lote_id >= $1)
      ORDER BY c.clave, c.id DESC
      LIMIT $2`,
    [opciones.desdeLote ?? null, opciones.limite ?? 1_000_000],
  );
  const r: ResultadoIngesta = { lote_id: await crearLote(pool, 'reproceso', 'reproceso', rows.length), recibidos: rows.length, insertados: 0, actualizados: 0, sin_cambios: 0, rechazados: [], duracion_ms: 0 };
  let caches = nuevosCaches();
  const client = await pool.connect();
  try {
    for (const [indice, fila] of rows.entries()) {
      try {
        await client.query('BEGIN');
        const g = await guardarLlamado(client, fila.payload, fila.fuente, fila.id, caches);
        await client.query('COMMIT');
        if (g.insertado) r.insertados++;
        else r.actualizados++;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        caches = nuevosCaches();
        r.rechazados.push({ indice, clave: fila.clave, error: mensajeError(err) });
      }
    }
  } finally {
    client.release();
  }
  r.duracion_ms = Date.now() - inicio;
  await finalizarLote(pool, r);
  logger.info({ lote: r.lote_id, reprocesados: r.actualizados + r.insertados, rechazados: r.rechazados.length, duracion_ms: r.duracion_ms }, 'crudos reprocesados');
  if (opciones.refrescar !== false) programarRefresco('reproceso', { pool });
  return r;
}

/** Borra todo lo que vino de una fuente (por ejemplo, los datos sintéticos de demostración). */
export async function borrarFuente(fuente: string, opciones: Opciones = {}): Promise<{ llamados: number; crudos: number; lotes: number }> {
  const pool = opciones.pool ?? poolDefault;
  const llamados = await pool.query(`DELETE FROM mercado.llamados WHERE fuente = $1`, [fuente]);
  const crudos = await pool.query(`DELETE FROM mercado.crudos c USING mercado.lotes l WHERE c.lote_id = l.id AND l.fuente = $1`, [fuente]);
  const lotes = await pool.query(`DELETE FROM mercado.lotes WHERE fuente = $1`, [fuente]);
  // Dimensiones que quedaron sin uso
  await pool.query(`DELETE FROM mercado.proveedores p WHERE NOT EXISTS (SELECT 1 FROM mercado.adjudicaciones a WHERE a.proveedor_id = p.id) AND NOT EXISTS (SELECT 1 FROM mercado.ofertas o WHERE o.proveedor_id = p.id)`);
  await pool.query(`DELETE FROM mercado.articulos a WHERE NOT EXISTS (SELECT 1 FROM mercado.items i WHERE i.articulo_id = a.id)`);
  await pool.query(`DELETE FROM mercado.organismos o WHERE NOT EXISTS (SELECT 1 FROM mercado.llamados l WHERE l.organismo_id = o.id)`);
  if (opciones.refrescar !== false) programarRefresco('borrado', { pool });
  return { llamados: llamados.rowCount ?? 0, crudos: crudos.rowCount ?? 0, lotes: lotes.rowCount ?? 0 };
}

export async function ultimosLotes(n = 20, pool: pg.Pool = poolDefault): Promise<pg.QueryResultRow[]> {
  const { rows } = await pool.query(`SELECT * FROM mercado.lotes ORDER BY id DESC LIMIT $1`, [n]);
  return rows;
}
