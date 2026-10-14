import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { logger } from '../logger.js';
import type { LlamadoIngesta, LoteLlamadosIngesta } from './esquema.js';

// Generador de DATOS SINTÉTICOS para probar la cadena completa (contrato → ingesta → vistas → dashboard)
// sin scrapear nada. Es también un ejemplo de cliente del contrato de ingesta.
//
//   npm run mercado:demo                       → genera y manda por HTTP a API_URL (default http://localhost:3000)
//   npm run mercado:demo -- --archivo demo.json → solo escribe el JSON (para mirar el formato)
//   npm run mercado:demo -- --limpiar           → borra lo que vino de la fuente "demo-sintetico"
//   npm run mercado:demo -- --meses 36 --llamados 1500 --semilla 7
//
// Necesita INGESTA_TOKEN en el entorno (el mismo que usa la API).

export const FUENTE_DEMO = 'demo-sintetico';

// PRNG determinista (mulberry32) para que la demo sea reproducible.
function crearAzar(semilla: number) {
  let a = semilla >>> 0;
  const siguiente = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    numero: siguiente,
    entre: (min: number, max: number) => min + siguiente() * (max - min),
    entero: (min: number, max: number) => Math.floor(min + siguiente() * (max - min + 1)),
    elegir: <T>(arr: readonly T[]): T => arr[Math.floor(siguiente() * arr.length)]!,
    chance: (p: number) => siguiente() < p,
  };
}

interface ProductoDemo {
  codigo: string;
  nombre: string;
  familia: string;
  subfamilia: string;
  unidad: string;
  precio: number; // UYU sin impuestos, base
  moneda?: 'USD';
  cantidad: [number, number];
  popularidad: number; // peso relativo
}

const PRODUCTOS: ProductoDemo[] = [
  { codigo: '10101', nombre: 'VENTANA DE ALUMINIO', familia: 'Construcción', subfamilia: 'Aberturas', unidad: 'UNIDAD', precio: 18500, cantidad: [2, 40], popularidad: 4 },
  { codigo: '10102', nombre: 'PUERTA DE ALUMINIO', familia: 'Construcción', subfamilia: 'Aberturas', unidad: 'UNIDAD', precio: 24000, cantidad: [1, 20], popularidad: 3 },
  { codigo: '10103', nombre: 'PERFIL DE ALUMINIO', familia: 'Construcción', subfamilia: 'Perfiles', unidad: 'KG', precio: 420, cantidad: [100, 3000], popularidad: 3 },
  { codigo: '10104', nombre: 'VIDRIO DOBLE HERMETICO (DVH)', familia: 'Construcción', subfamilia: 'Vidrios', unidad: 'M2', precio: 5200, cantidad: [10, 300], popularidad: 2 },
  { codigo: '10105', nombre: 'MAMPARA DE ALUMINIO Y VIDRIO', familia: 'Construcción', subfamilia: 'Aberturas', unidad: 'M2', precio: 7800, cantidad: [5, 120], popularidad: 2 },
  { codigo: '10201', nombre: 'PORTLAND', familia: 'Construcción', subfamilia: 'Materiales', unidad: 'BOLSA', precio: 390, cantidad: [50, 2000], popularidad: 5 },
  { codigo: '10202', nombre: 'CHAPA GALVANIZADA', familia: 'Construcción', subfamilia: 'Materiales', unidad: 'M2', precio: 950, cantidad: [20, 800], popularidad: 3 },
  { codigo: '10203', nombre: 'PINTURA LATEX', familia: 'Construcción', subfamilia: 'Pinturas', unidad: 'LITRO', precio: 310, cantidad: [40, 2000], popularidad: 5 },
  { codigo: '20101', nombre: 'NOTEBOOK', familia: 'Informática', subfamilia: 'Equipos', unidad: 'UNIDAD', precio: 850, moneda: 'USD', cantidad: [2, 150], popularidad: 6 },
  { codigo: '20102', nombre: 'MONITOR LED', familia: 'Informática', subfamilia: 'Equipos', unidad: 'UNIDAD', precio: 190, moneda: 'USD', cantidad: [5, 300], popularidad: 4 },
  { codigo: '20103', nombre: 'IMPRESORA MULTIFUNCION', familia: 'Informática', subfamilia: 'Equipos', unidad: 'UNIDAD', precio: 420, moneda: 'USD', cantidad: [1, 40], popularidad: 3 },
  { codigo: '20104', nombre: 'TONER', familia: 'Informática', subfamilia: 'Insumos', unidad: 'UNIDAD', precio: 3900, cantidad: [5, 400], popularidad: 7 },
  { codigo: '20105', nombre: 'LICENCIA DE SOFTWARE OFIMATICO', familia: 'Informática', subfamilia: 'Software', unidad: 'UNIDAD', precio: 120, moneda: 'USD', cantidad: [10, 1000], popularidad: 3 },
  { codigo: '30101', nombre: 'PAPEL A4', familia: 'Papelería', subfamilia: 'Papel', unidad: 'RESMA', precio: 265, cantidad: [100, 5000], popularidad: 9 },
  { codigo: '30102', nombre: 'BOLIGRAFO', familia: 'Papelería', subfamilia: 'Escritura', unidad: 'UNIDAD', precio: 14, cantidad: [500, 20000], popularidad: 5 },
  { codigo: '30103', nombre: 'CARPETA COLGANTE', familia: 'Papelería', subfamilia: 'Archivo', unidad: 'UNIDAD', precio: 38, cantidad: [100, 5000], popularidad: 3 },
  { codigo: '40101', nombre: 'HIPOCLORITO DE SODIO', familia: 'Limpieza', subfamilia: 'Químicos', unidad: 'LITRO', precio: 42, cantidad: [200, 20000], popularidad: 7 },
  { codigo: '40102', nombre: 'PAPEL HIGIENICO', familia: 'Limpieza', subfamilia: 'Descartables', unidad: 'ROLLO', precio: 48, cantidad: [500, 30000], popularidad: 8 },
  { codigo: '40103', nombre: 'JABON LIQUIDO', familia: 'Limpieza', subfamilia: 'Químicos', unidad: 'LITRO', precio: 95, cantidad: [100, 5000], popularidad: 5 },
  { codigo: '40104', nombre: 'BOLSA DE RESIDUOS', familia: 'Limpieza', subfamilia: 'Descartables', unidad: 'UNIDAD', precio: 9, cantidad: [2000, 100000], popularidad: 6 },
  { codigo: '50101', nombre: 'GASOIL', familia: 'Combustibles', subfamilia: 'Combustibles', unidad: 'LITRO', precio: 58, cantidad: [2000, 200000], popularidad: 6 },
  { codigo: '50102', nombre: 'NAFTA SUPER', familia: 'Combustibles', subfamilia: 'Combustibles', unidad: 'LITRO', precio: 74, cantidad: [1000, 80000], popularidad: 4 },
  { codigo: '60101', nombre: 'UNIFORME DE TRABAJO', familia: 'Vestimenta', subfamilia: 'Uniformes', unidad: 'UNIDAD', precio: 1850, cantidad: [20, 2000], popularidad: 4 },
  { codigo: '60102', nombre: 'CALZADO DE SEGURIDAD', familia: 'Vestimenta', subfamilia: 'Seguridad', unidad: 'PAR', precio: 2400, cantidad: [20, 1500], popularidad: 4 },
  { codigo: '60103', nombre: 'GUANTES DE NITRILO', familia: 'Vestimenta', subfamilia: 'Seguridad', unidad: 'CAJA', precio: 480, cantidad: [50, 5000], popularidad: 6 },
  { codigo: '70101', nombre: 'LECHE ENTERA', familia: 'Alimentos', subfamilia: 'Lácteos', unidad: 'LITRO', precio: 46, cantidad: [1000, 100000], popularidad: 6 },
  { codigo: '70102', nombre: 'ARROZ', familia: 'Alimentos', subfamilia: 'Secos', unidad: 'KG', precio: 62, cantidad: [500, 50000], popularidad: 5 },
  { codigo: '70103', nombre: 'ACEITE DE GIRASOL', familia: 'Alimentos', subfamilia: 'Secos', unidad: 'LITRO', precio: 115, cantidad: [200, 20000], popularidad: 4 },
  { codigo: '80101', nombre: 'PARACETAMOL 500 MG', familia: 'Salud', subfamilia: 'Medicamentos', unidad: 'COMPRIMIDO', precio: 1.9, cantidad: [10000, 2000000], popularidad: 6 },
  { codigo: '80102', nombre: 'JERINGA DESCARTABLE 5 ML', familia: 'Salud', subfamilia: 'Descartables', unidad: 'UNIDAD', precio: 6.5, cantidad: [5000, 500000], popularidad: 5 },
  { codigo: '80103', nombre: 'GASA ESTERIL', familia: 'Salud', subfamilia: 'Descartables', unidad: 'PAQUETE', precio: 85, cantidad: [200, 20000], popularidad: 4 },
  { codigo: '90101', nombre: 'SERVICIO DE LIMPIEZA', familia: 'Servicios', subfamilia: 'Limpieza', unidad: 'MES', precio: 185000, cantidad: [6, 24], popularidad: 5 },
  { codigo: '90102', nombre: 'SERVICIO DE VIGILANCIA', familia: 'Servicios', subfamilia: 'Seguridad', unidad: 'HORA', precio: 420, cantidad: [2000, 50000], popularidad: 5 },
  { codigo: '90103', nombre: 'MANTENIMIENTO DE ASCENSORES', familia: 'Servicios', subfamilia: 'Mantenimiento', unidad: 'MES', precio: 28000, cantidad: [12, 36], popularidad: 2 },
  { codigo: '90104', nombre: 'ALQUILER DE VEHICULOS', familia: 'Servicios', subfamilia: 'Transporte', unidad: 'MES', precio: 48000, cantidad: [6, 36], popularidad: 3 },
];

const ORGANISMOS = [
  ['Intendencia de Montevideo', 'Desarrollo Urbano'], ['Intendencia de Montevideo', 'Gestión Humana'], ['Intendencia de Canelones', 'Obras'], ['Intendencia de Maldonado', 'Compras'],
  ['Intendencia de Salto', 'Hacienda'], ['Intendencia de Paysandú', 'Servicios'], ['Intendencia de Colonia', 'Obras'], ['Intendencia de Rivera', 'Compras'],
  ['Administración de los Servicios de Salud del Estado', 'Hospital Maciel'], ['Administración de los Servicios de Salud del Estado', 'Hospital Pereira Rossell'], ['Administración de los Servicios de Salud del Estado', 'RAP Metropolitana'],
  ['Administración Nacional de Educación Pública', 'Consejo de Educación Secundaria'], ['Administración Nacional de Educación Pública', 'Dirección General de Educación Inicial y Primaria'], ['Administración Nacional de Educación Pública', 'UTU'],
  ['Universidad de la República', 'Facultad de Ingeniería'], ['Universidad de la República', 'Hospital de Clínicas'],
  ['Ministerio del Interior', 'Jefatura de Policía de Montevideo'], ['Ministerio del Interior', 'Dirección Nacional de Bomberos'], ['Ministerio de Defensa Nacional', 'Ejército Nacional'],
  ['Ministerio de Transporte y Obras Públicas', 'Dirección Nacional de Vialidad'], ['Ministerio de Salud Pública', 'Dirección General de Secretaría'], ['Ministerio de Educación y Cultura', 'Dirección General'],
  ['Banco de Previsión Social', 'Gerencia de Compras'], ['Administración Nacional de Usinas y Trasmisiones Eléctricas', 'Abastecimientos'], ['Obras Sanitarias del Estado', 'Compras'],
  ['Administración Nacional de Telecomunicaciones', 'Logística'], ['Administración Nacional de Puertos', 'Compras'], ['Banco de la República Oriental del Uruguay', 'Abastecimientos'],
] as const;

const TIPOS = ['Compra Directa', 'Compra Directa', 'Compra Directa', 'Licitación Abreviada', 'Licitación Abreviada', 'Licitación Pública', 'Pregón', 'Compra Directa por Excepción', 'Convenio Marco'] as const;

interface ProveedorDemo {
  rut: string;
  nombre: string;
  familias: string[];
  agresividad: number; // < 1 más barato
}

function generarProveedores(azar: ReturnType<typeof crearAzar>): ProveedorDemo[] {
  const nombres = [
    'Aluminios del Sur', 'Aberturas Rodríguez', 'Vidriería Central', 'Metalúrgica Oriental', 'Perfiles Uruguay', 'Barraca El Puente', 'Pinturas Nacionales', 'Ferretería Industrial',
    'Infotec', 'Datalab', 'Sistemas Integrales', 'Compuservice', 'Red Digital', 'Toner Express', 'Ofimática Total', 'Librería Académica', 'Papelera Nacional', 'Distribuidora Escolar',
    'Química Limpia', 'Higiene Total', 'Descartables del Este', 'Limpiamax', 'Combustibles del Litoral', 'Distribuidora Ancap Norte', 'Uniformes Profesionales', 'Calzados Industriales',
    'Seguridad Laboral', 'Lácteos del Sur', 'Alimentos Mayorista', 'Molino Central', 'Farmacéutica Nacional', 'Insumos Médicos', 'Hospitalaria', 'Servicios Integrales de Limpieza',
    'Vigilancia Profesional', 'Guardias Unidas', 'Ascensores Técnicos', 'Rentacar Empresarial', 'Logística Oriental', 'Multiservicios del Plata', 'Proveedora General', 'Comercial Universal',
  ];
  const familiasPorNombre: Record<string, string[]> = {
    'Aluminios del Sur': ['Construcción'], 'Aberturas Rodríguez': ['Construcción'], 'Vidriería Central': ['Construcción'], 'Metalúrgica Oriental': ['Construcción'], 'Perfiles Uruguay': ['Construcción'],
    'Barraca El Puente': ['Construcción'], 'Pinturas Nacionales': ['Construcción'], 'Ferretería Industrial': ['Construcción', 'Vestimenta'],
    Infotec: ['Informática'], Datalab: ['Informática'], 'Sistemas Integrales': ['Informática'], Compuservice: ['Informática'], 'Red Digital': ['Informática'], 'Toner Express': ['Informática', 'Papelería'],
    'Ofimática Total': ['Informática', 'Papelería'], 'Librería Académica': ['Papelería'], 'Papelera Nacional': ['Papelería', 'Limpieza'], 'Distribuidora Escolar': ['Papelería'],
    'Química Limpia': ['Limpieza'], 'Higiene Total': ['Limpieza'], 'Descartables del Este': ['Limpieza', 'Salud'], Limpiamax: ['Limpieza', 'Servicios'],
    'Combustibles del Litoral': ['Combustibles'], 'Distribuidora Ancap Norte': ['Combustibles'], 'Uniformes Profesionales': ['Vestimenta'], 'Calzados Industriales': ['Vestimenta'], 'Seguridad Laboral': ['Vestimenta', 'Salud'],
    'Lácteos del Sur': ['Alimentos'], 'Alimentos Mayorista': ['Alimentos'], 'Molino Central': ['Alimentos'], 'Farmacéutica Nacional': ['Salud'], 'Insumos Médicos': ['Salud'], Hospitalaria: ['Salud'],
    'Servicios Integrales de Limpieza': ['Servicios'], 'Vigilancia Profesional': ['Servicios'], 'Guardias Unidas': ['Servicios'], 'Ascensores Técnicos': ['Servicios'], 'Rentacar Empresarial': ['Servicios'],
    'Logística Oriental': ['Servicios', 'Combustibles'], 'Multiservicios del Plata': ['Servicios', 'Limpieza'], 'Proveedora General': ['Papelería', 'Limpieza', 'Alimentos', 'Vestimenta'], 'Comercial Universal': ['Informática', 'Papelería', 'Construcción'],
  };
  return nombres.map((nombre, i) => ({
    rut: `21${String(100000 + i * 7919).padStart(6, '0')}0012`,
    nombre: `${nombre} ${azar.elegir(['S.A.', 'S.R.L.', 'Ltda.', 'S.A.S.'])}`,
    familias: familiasPorNombre[nombre] ?? ['Servicios'],
    agresividad: azar.entre(0.88, 1.12),
  }));
}

function fechaIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface OpcionesDemo {
  meses: number;
  llamados: number;
  semilla: number;
}

export function generarDemo(o: OpcionesDemo): { lotes: LoteLlamadosIngesta[]; cotizaciones: Array<{ moneda: string; fecha: string; valor_uyu: number; fuente: string }> } {
  const azar = crearAzar(o.semilla);
  const proveedores = generarProveedores(azar);
  const hoy = new Date();
  const inicio = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - o.meses + 1, 1));
  const diasTotales = Math.round((hoy.getTime() - inicio.getTime()) / 86400000);

  // Cotizaciones semanales: dólar subiendo despacio, UI subiendo con la inflación.
  const cotizaciones: Array<{ moneda: string; fecha: string; valor_uyu: number; fuente: string }> = [];
  for (let d = 0; d <= diasTotales; d += 7) {
    const f = new Date(inicio.getTime() + d * 86400000);
    const anios = d / 365;
    cotizaciones.push({ moneda: 'USD', fecha: fechaIso(f), valor_uyu: Number((38.5 + anios * 1.2 + Math.sin(d / 40) * 0.8).toFixed(3)), fuente: FUENTE_DEMO });
    cotizaciones.push({ moneda: 'UI', fecha: fechaIso(f), valor_uyu: Number((5.6 * Math.pow(1.065, anios)).toFixed(4)), fuente: FUENTE_DEMO });
  }

  const pesoTotal = PRODUCTOS.reduce((s, p) => s + p.popularidad, 0);
  const elegirProducto = () => {
    let r = azar.numero() * pesoTotal;
    for (const p of PRODUCTOS) {
      r -= p.popularidad;
      if (r <= 0) return p;
    }
    return PRODUCTOS[PRODUCTOS.length - 1]!;
  };

  const llamados: LlamadoIngesta[] = [];
  for (let n = 0; n < o.llamados; n++) {
    const dia = azar.entero(0, diasTotales);
    const fecha = new Date(inicio.getTime() + dia * 86400000);
    const anios = dia / 365;
    const inflacion = Math.pow(1.07, anios); // precios en UYU suben ~7 % anual
    const org = azar.elegir(ORGANISMOS);
    const tipo = azar.elegir(TIPOS);
    const estadoAzar = azar.numero();
    const estado = estadoAzar < 0.86 ? 'Adjudicado' : estadoAzar < 0.93 ? 'Desierto' : estadoAzar < 0.97 ? 'Anulado' : 'Publicado';
    const nItems = tipo === 'Compra Directa' ? azar.entero(1, 3) : azar.entero(1, 6);
    const familiaPrincipal = elegirProducto().familia;
    const candidatos = PRODUCTOS.filter((p) => p.familia === familiaPrincipal);
    const fechaApertura = new Date(Math.min(hoy.getTime(), fecha.getTime() + azar.entero(5, 25) * 86400000));
    const fechaAdjudicacion = new Date(Math.min(hoy.getTime(), fechaApertura.getTime() + azar.entero(5, 40) * 86400000));
    const conCuadro = azar.chance(0.45);

    const items = [];
    const usados = new Set<string>();
    for (let i = 0; i < nItems; i++) {
      const prod = azar.elegir(candidatos);
      if (usados.has(prod.codigo)) continue;
      usados.add(prod.codigo);
      const cantidad = Math.round(azar.entre(prod.cantidad[0], prod.cantidad[1]));
      const moneda = prod.moneda ?? 'UYU';
      const precioBase = prod.moneda ? prod.precio * (1 + anios * 0.01) : prod.precio * inflacion;
      // Oferentes: 2-5 de la familia, el ganador suele ser el más barato
      const aptos = proveedores.filter((p) => p.familias.includes(prod.familia));
      const nOferentes = azar.entero(2, Math.min(5, aptos.length));
      const oferentes = [...aptos].sort(() => azar.numero() - 0.5).slice(0, nOferentes);
      const ofertas = oferentes.map((p) => ({ proveedor: p, precio: Number((precioBase * p.agresividad * azar.entre(0.93, 1.1)).toFixed(2)) }));
      ofertas.sort((a, b) => a.precio - b.precio);
      const ganadora = azar.chance(0.8) ? ofertas[0]! : azar.elegir(ofertas);
      const esAdjudicado = estado === 'Adjudicado';

      items.push({
        nro_item: i + 1,
        articulo: { codigo: prod.codigo, nombre: prod.nombre, categoria: { familia: prod.familia, subfamilia: prod.subfamilia }, unidad: prod.unidad },
        cantidad,
        unidad: prod.unidad,
        ofertas:
          conCuadro && esAdjudicado
            ? ofertas.map((of) => ({ proveedor: { rut: of.proveedor.rut, nombre: of.proveedor.nombre }, precio_unitario: of.precio, moneda, impuestos_incluidos: false, cantidad }))
            : [],
        adjudicaciones: esAdjudicado
          ? [{ proveedor: { rut: ganadora.proveedor.rut, nombre: ganadora.proveedor.nombre }, cantidad, precio_unitario: ganadora.precio, moneda, impuestos_incluidos: false, tasa_impuestos: 0.22, monto_total: Number((ganadora.precio * cantidad).toFixed(2)), monto_total_con_impuestos: Number((ganadora.precio * cantidad * 1.22).toFixed(2)), fecha: fechaIso(fechaAdjudicacion) }]
          : [],
      });
    }

    const numero = `${azar.entero(1, 999)}/${fecha.getUTCFullYear()}`;
    llamados.push({
      arce_id: `demo-${o.semilla}-${n + 1}`,
      tipo_compra: tipo,
      numero,
      anio: fecha.getUTCFullYear(),
      organismo: { inciso: org[0], unidad_ejecutora: org[1] },
      objeto: `${items.map((i) => i.articulo.nombre.toLowerCase()).join(', ')} para ${org[1]}`,
      estado,
      fecha_publicacion: fechaIso(fecha),
      fecha_apertura: `${fechaIso(fechaApertura)}T11:00:00-03:00`,
      fecha_adjudicacion: estado === 'Adjudicado' ? fechaIso(fechaAdjudicacion) : null,
      moneda: items[0]?.ofertas[0]?.moneda ?? items[0]?.adjudicaciones[0]?.moneda ?? 'UYU',
      url: `https://www.comprasestatales.gub.uy/consultas/detalle/id/demo-${n + 1}`,
      items,
    } as LlamadoIngesta);
  }

  const lotes: LoteLlamadosIngesta[] = [];
  for (let i = 0; i < llamados.length; i += 200) lotes.push({ fuente: FUENTE_DEMO, llamados: llamados.slice(i, i + 200) });
  return { lotes, cotizaciones };
}

async function enviar(url: string, token: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const texto = await res.text();
  let json: unknown = texto;
  try {
    json = JSON.parse(texto);
  } catch {
    /* no era JSON */
  }
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}: ${typeof json === 'string' ? json : JSON.stringify(json).slice(0, 500)}`);
  return json;
}

function argumento(nombre: string, porDefecto: string): string {
  const i = process.argv.indexOf(`--${nombre}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1]! : porDefecto;
}

const esMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (esMain) {
  const { config } = await import('../config.js');
  const apiUrl = process.env.API_URL ?? `http://localhost:${config.PORT}`;
  const token = config.INGESTA_TOKEN;
  const opciones: OpcionesDemo = { meses: Number(argumento('meses', '36')), llamados: Number(argumento('llamados', '1500')), semilla: Number(argumento('semilla', '7')) };

  if (process.argv.includes('--limpiar')) {
    if (!token) throw new Error('Falta INGESTA_TOKEN');
    const res = await fetch(`${apiUrl}/api/ingesta/fuente/${FUENTE_DEMO}?confirmar=${FUENTE_DEMO}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
    logger.info({ status: res.status, respuesta: await res.json() }, 'datos sintéticos borrados');
  } else {
    const { lotes, cotizaciones } = generarDemo(opciones);
    const archivo = argumento('archivo', '');
    if (archivo) {
      await fs.writeFile(archivo, JSON.stringify({ cotizaciones, lotes }, null, 2));
      logger.info({ archivo, llamados: opciones.llamados, lotes: lotes.length, cotizaciones: cotizaciones.length }, 'JSON de demo escrito (DATOS SINTÉTICOS)');
    } else {
      if (!token) throw new Error('Falta INGESTA_TOKEN en el entorno (el mismo que usa la API)');
      logger.warn({ apiUrl, ...opciones, fuente: FUENTE_DEMO }, 'enviando DATOS SINTÉTICOS de demostración (no son compras reales)');
      const rc = await enviar(`${apiUrl}/api/ingesta/cotizaciones`, token, { cotizaciones });
      logger.info({ resultado: rc }, 'cotizaciones');
      for (const [i, lote] of lotes.entries()) {
        const r = (await enviar(`${apiUrl}/api/ingesta/llamados`, token, lote)) as Record<string, unknown>;
        logger.info({ lote: i + 1, de: lotes.length, insertados: r.insertados, actualizados: r.actualizados, sin_cambios: r.sin_cambios, rechazados: (r.rechazados as unknown[])?.length, duracion_ms: r.duracion_ms }, 'lote enviado');
      }
      logger.info('listo: las estadísticas se refrescan solas en ~1 minuto (o POST /api/mercado/refrescar)');
    }
  }
}
