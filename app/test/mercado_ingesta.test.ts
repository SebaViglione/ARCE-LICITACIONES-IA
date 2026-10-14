import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { runMigrations } from '../src/db/migrate.js';
import { ingestarCotizaciones, ingestarLlamados, reprocesarCrudos, borrarFuente } from '../src/mercado/ingesta.js';
import { refrescarEstadisticas } from '../src/mercado/estadisticas.js';
import * as consultas from '../src/mercado/consultas.js';
import { LoteLlamadosIngesta } from '../src/mercado/esquema.js';
import { generarDemo } from '../src/mercado/demo.js';

// Prueba de integración contra un Postgres real: crea una base temporal, migra, ingesta, refresca y consulta.
// Corre solo si TEST_DATABASE_URL apunta a un servidor (npm run test:db con la BD del compose levantada).

const adminUrl = process.env.TEST_DATABASE_URL;
const describeDb = adminUrl ? describe : describe.skip;

describeDb('ingesta de mercado (integración)', () => {
  const nombreDb = `arce_test_${Date.now().toString(36)}`;
  let admin: pg.Pool;
  let pool: pg.Pool;

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: adminUrl });
    await admin.query(`CREATE DATABASE ${nombreDb}`);
    const url = new URL(adminUrl!);
    url.pathname = `/${nombreDb}`;
    pool = new pg.Pool({ connectionString: url.toString() });
    await runMigrations(pool);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS ${nombreDb} WITH (FORCE)`);
      await admin.end();
    }
  });

  const lote = () =>
    LoteLlamadosIngesta.parse({
      fuente: 'test',
      llamados: [
        {
          arce_id: 'A-1',
          tipo_compra: 'Licitación Abreviada',
          organismo: { inciso: 'Intendencia de Montevideo', unidad_ejecutora: 'Desarrollo Urbano' },
          objeto: 'Ventanas de aluminio',
          estado: 'Adjudicado',
          fecha_publicacion: '2025-02-01',
          fecha_adjudicacion: '2025-03-10',
          items: [
            {
              nro_item: 1,
              articulo: { codigo: '10101', nombre: 'VENTANA DE ALUMINIO', categoria: { familia: 'Construcción', subfamilia: 'Aberturas' }, unidad: 'UNIDAD' },
              cantidad: 10,
              unidad: 'Unidades',
              ofertas: [
                { proveedor: { rut: '211234560012', nombre: 'Aluminios del Sur S.A.' }, precio_unitario: 18000, moneda: '$' },
                { proveedor: { nombre: 'Aberturas Rodríguez' }, precio_unitario: 20000, moneda: '$' },
                { proveedor: { nombre: 'Vidriería Central' }, precio_unitario: 21000, moneda: '$' },
              ],
              adjudicaciones: [{ proveedor: { rut: '21.123456.0012', nombre: 'ALUMINIOS DEL SUR SA' }, cantidad: 10, precio_unitario: '18.000,00', moneda: '$' }],
            },
            {
              nro_item: 2,
              articulo: { codigo: '20101', nombre: 'NOTEBOOK', categoria: { familia: 'Informática' } },
              cantidad: 4,
              unidad: 'UNIDAD',
              adjudicaciones: [{ proveedor: { nombre: 'Infotec SRL' }, cantidad: 4, precio_unitario: 1000, moneda: 'U$S', impuestos_incluidos: true, tasa_impuestos: 0.22 }],
            },
            {
              nro_item: 3,
              descripcion: 'Flete sin artículo de catálogo',
              cantidad: 1,
              adjudicaciones: [{ proveedor: { nombre: 'Logística Oriental' }, cantidad: 1, precio_unitario: 5000, moneda: 'UYU' }],
            },
          ],
        },
        {
          arce_id: 'A-2',
          tipo_compra: 'Compra Directa',
          organismo: { inciso: 'ASSE', unidad_ejecutora: 'Hospital Maciel' },
          estado: 'Anulado',
          fecha_publicacion: '2025-02-15',
          items: [{ nro_item: 1, articulo: { codigo: '10101', nombre: 'VENTANA DE ALUMINIO' }, cantidad: 2, adjudicaciones: [{ proveedor: { nombre: 'Aberturas Rodríguez' }, cantidad: 2, precio_unitario: 99999, fecha: '2025-03-01' }] }],
        },
        {
          arce_id: 'A-3',
          tipo_compra: 'Compra Directa',
          organismo: { inciso: 'ASSE', unidad_ejecutora: 'Hospital Maciel' },
          estado: 'Adjudicado',
          fecha_publicacion: '2024-11-05',
          items: [{ nro_item: 1, articulo: { codigo: '10101', nombre: 'VENTANA DE ALUMINIO' }, cantidad: 5, adjudicaciones: [{ proveedor: { nombre: 'Aberturas Rodríguez' }, cantidad: 5, precio_unitario: 19500, fecha: '2024-12-01' }] }],
        },
      ],
    });

  it('ingesta, idempotencia, actualización y reproceso', async () => {
    const r1 = await ingestarLlamados(lote(), { pool, refrescar: false });
    expect(r1).toMatchObject({ recibidos: 3, insertados: 3, actualizados: 0, sin_cambios: 0 });
    expect(r1.rechazados).toEqual([]);

    // Mismo contenido → no se toca nada
    const r2 = await ingestarLlamados(lote(), { pool, refrescar: false });
    expect(r2).toMatchObject({ insertados: 0, actualizados: 0, sin_cambios: 3 });

    // Proveedor fusionado por RUT aunque el nombre cambie de escritura; sin RUT, por nombre normalizado
    const prov = await pool.query(`SELECT rut, nombre FROM mercado.proveedores ORDER BY id`);
    expect(prov.rows.filter((p) => p.rut === '211234560012')).toHaveLength(1);
    expect(prov.rows.filter((p) => p.nombre.startsWith('Aberturas'))).toHaveLength(1);

    const art = await pool.query(`SELECT a.codigo, a.nombre, c.ruta FROM mercado.articulos a LEFT JOIN mercado.categorias c ON c.id = a.categoria_id ORDER BY a.codigo`);
    expect(art.rows.find((a) => a.codigo === '10101')?.ruta).toBe('Construcción > Aberturas');
    const cat = await pool.query(`SELECT nombre, nivel, raiz_id, id FROM mercado.categorias ORDER BY id`);
    expect(cat.rows.find((c) => c.nombre === 'Aberturas')?.raiz_id).toBe(cat.rows.find((c) => c.nombre === 'Construcción')?.id);

    const items = await pool.query(`SELECT unidad_normalizada, articulo_id FROM mercado.items i JOIN mercado.llamados l ON l.id = i.llamado_id WHERE l.arce_id = 'A-1' ORDER BY nro_item`);
    expect(items.rows.map((i) => i.unidad_normalizada)).toEqual(['unidad', 'unidad', 'unidad']);
    expect(items.rows[2]!.articulo_id).toBeNull();

    // Cambio: el llamado A-3 se reenvía con otra adjudicación → se reemplazan los hijos
    const cambiado = lote();
    cambiado.llamados[2]!.items[0]!.adjudicaciones[0]!.precio_unitario = 19000;
    const r3 = await ingestarLlamados({ fuente: 'test', llamados: [cambiado.llamados[2]!] }, { pool, refrescar: false });
    expect(r3).toMatchObject({ insertados: 0, actualizados: 1, sin_cambios: 0 });
    const adj = await pool.query(`SELECT a.precio_unitario FROM mercado.adjudicaciones a JOIN mercado.items i ON i.id = a.item_id JOIN mercado.llamados l ON l.id = i.llamado_id WHERE l.arce_id = 'A-3'`);
    expect(adj.rows).toHaveLength(1);
    expect(Number(adj.rows[0]!.precio_unitario)).toBe(19000);

    // Payload inválido para la BD (nro_item duplicado pasa zod solo si no está en el mismo array; forzamos un error distinto: proveedor sin nombre)
    const roto = lote();
    (roto.llamados[0]!.items[0]!.adjudicaciones[0]!.proveedor as { nombre: string }).nombre = 'x'.repeat(400);
    const r4 = await ingestarLlamados({ fuente: 'test', llamados: [roto.llamados[0]!] }, { pool, refrescar: false });
    expect(r4.rechazados).toHaveLength(0); // 400 chars entra en text; es válido
    expect(r4.actualizados).toBe(1);

    // Reproceso: vuelve a normalizar desde el último crudo de cada llamado
    const r5 = await reprocesarCrudos({ pool, refrescar: false });
    expect(r5.recibidos).toBe(3);
    expect(r5.rechazados).toEqual([]);
  }, 60_000);

  it('cotizaciones, refresco y estadísticas', async () => {
    const rc = await ingestarCotizaciones({ cotizaciones: [{ moneda: 'USD', fecha: '2025-03-01', valor_uyu: 40, fuente: null }] }, { pool, refrescar: false });
    expect(rc.insertados).toBe(1);

    const ref = await refrescarEstadisticas('test', { pool, concurrente: true });
    expect(ref.estado).toBe('ok');
    expect(Object.keys(ref.detalle ?? {})).toHaveLength(8);

    // mv_hechos: A-2 (anulado) queda fuera; A-1 tiene 3 adjudicaciones, A-3 una
    const hechos = await pool.query(`SELECT arce_id, articulo_id, precio_base_uyu, monto_uyu, base_conocida, con_cotizacion, fecha FROM mercado.mv_hechos ORDER BY arce_id, item_id`);
    expect(hechos.rows.map((h) => h.arce_id)).toEqual(['A-1', 'A-1', 'A-1', 'A-3']);
    const notebook = hechos.rows[1]!;
    // 1000 USD con impuestos incluidos al 22 % → 819,67 USD sin impuestos × 40 = 32.786,89 UYU
    expect(Number(notebook.precio_base_uyu)).toBeCloseTo(32786.89, 1);
    expect(notebook.base_conocida).toBe(true);
    expect(notebook.con_cotizacion).toBe(true);
    expect(hechos.rows[0]!.fecha).toBe('2025-03-10');

    const resumen = await consultas.resumen(pool);
    expect(resumen.llamados).toBe(3);
    expect(resumen.hechos).toBe(4);
    expect(resumen.adjudicaciones_excluidas).toBe(1); // la de A-2 (anulado)
    expect(resumen.items_sin_articulo).toBe(1);
    expect(resumen.por_mes.length).toBeGreaterThan(0);

    const prods = await consultas.productos({ desde: null, hasta: null, q: null, categoria: null, orden: 'monto', limit: 10, offset: 0 }, pool);
    expect(prods.total).toBe(2);
    const ventana = prods.filas.find((p) => p.codigo === '10101')!;
    expect(ventana.adjudicaciones).toBe(2);
    expect(ventana.proveedores).toBe(2);
    expect(ventana.organismos).toBe(2);
    expect(ventana.monto_uyu).toBeCloseTo(18000 * 10 + 19000 * 5, 0);
    expect(ventana.precio_mediano_uyu).toBeCloseTo((18000 + 19000) / 2, 0);

    // Rango que deja afuera 2024
    const prods2025 = await consultas.productos({ desde: '2025-01', hasta: '2025-12', q: null, categoria: null, orden: 'monto', limit: 10, offset: 0 }, pool);
    expect(prods2025.filas.find((p) => p.codigo === '10101')!.adjudicaciones).toBe(1);

    const ficha = await consultas.producto(ventana.articulo_id, { desde: null, hasta: null }, pool);
    expect(ficha).not.toBeNull();
    expect(ficha!.proveedores).toHaveLength(2);
    expect(ficha!.proveedores[0].share).toBeCloseTo(180000 / 275000, 3);
    expect(ficha!.competencia).toHaveLength(1);
    expect(ficha!.competencia[0].precio_ganador_mediano).toBe(18000);
    expect(ficha!.competencia[0].precio_perdedor_mediano).toBe(20500);
    expect(ficha!.competencia[0].descuento_mediano).toBeCloseTo(18000 / 20500 - 1, 4);
    expect(ficha!.serie.length).toBe(2);

    const provs = await consultas.proveedores({ desde: null, hasta: null, q: null, articulo: null, orden: 'monto', limit: 10, offset: 0 }, pool);
    expect(provs.total).toBe(4);
    const alu = provs.filas.find((p) => p.rut === '211234560012')!;
    expect(alu.adjudicaciones).toBe(1);
    expect(alu.ofertas_presentadas).toBe(1);
    expect(alu.tasa_exito).toBe(1);

    const fichaProv = await consultas.proveedor(alu.proveedor_id, { desde: null, hasta: null }, pool);
    expect(fichaProv!.competidores.map((c: { nombre: string }) => c.nombre)).toContain('Aberturas Rodríguez');

    const orgs = await consultas.organismos({ desde: null, hasta: null, q: null, limit: 10, offset: 0 }, pool);
    expect(orgs.total).toBe(2);
    expect(orgs.filas[0].principales).toBeInstanceOf(Array);

    const cats = await consultas.categorias({ desde: null, hasta: null }, pool);
    expect(cats.map((c) => c.nombre).sort()).toEqual(['Construcción', 'Informática']);

    const busq = await consultas.buscar('alumin', pool);
    expect(busq.articulos[0].nombre).toBe('VENTANA DE ALUMINIO');
    expect(busq.proveedores[0].nombre).toMatch(/Aluminios/i);
  }, 60_000);

  it('datos sintéticos de demo: la cadena completa produce oportunidades', async () => {
    const { lotes, cotizaciones } = generarDemo({ meses: 30, llamados: 400, semilla: 3 });
    await ingestarCotizaciones({ cotizaciones }, { pool, refrescar: false });
    let insertados = 0;
    for (const l of lotes) {
      const r = await ingestarLlamados(LoteLlamadosIngesta.parse(l), { pool, refrescar: false });
      expect(r.rechazados).toEqual([]);
      insertados += r.insertados;
    }
    expect(insertados).toBe(400);
    const ref = await refrescarEstadisticas('test', { pool, concurrente: false });
    expect(ref.estado).toBe('ok');

    const op = await consultas.oportunidades(10, null, pool);
    expect(op.length).toBe(10);
    expect(op[0].indice_oportunidad).toBeGreaterThan(50);
    expect(op[0].comp_apertura).toBeGreaterThanOrEqual(0);
    expect(op[0].comp_apertura).toBeLessThanOrEqual(1);
    for (const o of op) expect(o.hhi_24m).toBeGreaterThan(0);

    const borrado = await borrarFuente('demo-sintetico', { pool, refrescar: false });
    expect(borrado.llamados).toBe(400);
    const quedan = await pool.query(`SELECT count(*)::int AS n FROM mercado.llamados`);
    expect(quedan.rows[0]!.n).toBe(3);
  }, 120_000);
});
