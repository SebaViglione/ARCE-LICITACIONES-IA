import fs from 'node:fs/promises';
import { config } from '../config.js';
import type { Logger } from '../logger.js';
import * as repos from '../db/repos.js';
import { cargarRubro, type Rubro } from './filtro.js';
import { descargarAdjunto } from './descarga.js';
import { extraerTexto } from './extract.js';
import { decodificarHtml, esHtmlIm, extraerIm } from './extract_im.js';
import { getProveedor, resumenError, type MetaLlm, type ProveedorLlm } from '../llm/index.js';
import { promptAnalisisCompleto, promptChunk, promptFallback, promptSintesis, systemPrompt } from '../llm/prompts.js';
import {
  AnalisisLlmSchema,
  ChunkSchema,
  analisisJsonSchema,
  aplicarCoherenciaVisita,
  chunkJsonSchema,
  normalizarAnalisis,
  type Analisis,
  type Chunk,
} from '../llm/schema.js';
import { truncar } from '../utils/texto.js';

export interface ResumenAnalisis {
  analizados: number;
  fallback: number;
  errores: number;
  extraccion_fallida: number;
  descubiertos: number;
  tiempos_ms: number[];
}

export const FALLBACK = 'METADATA_FALLBACK';
const MAX_CONFIANZA_FALLBACK = 50;

// ---------------------------------------------------------------------------
// Contexto y chunking
// ---------------------------------------------------------------------------

export function construirContexto(ctx: repos.ContextoLlamado, nombreArchivo: string | null, textoArchivo: string | null): string {
  const partes = [`=== TÍTULO DEL LLAMADO ===\n${ctx.titulo}`];
  if (ctx.descripcion) partes.push(`=== DESCRIPCIÓN DEL LLAMADO ===\n${ctx.descripcion}`);
  if (ctx.items.length) partes.push(`=== ITEMS/PRODUCTOS SOLICITADOS ===\n${ctx.items.map((i) => `- ${i}`).join('\n')}`);
  if (ctx.aclaraciones.length) partes.push(`=== ACLARACIONES DEL LLAMADO ===\n${ctx.aclaraciones.map((a) => `- ${a}`).join('\n')}`);
  if (nombreArchivo && textoArchivo) partes.push(`=== CONTENIDO DEL ARCHIVO: ${nombreArchivo} ===\n${textoArchivo}`);
  return partes.join('\n\n');
}

/** Divide por caracteres (no bytes) con solapamiento; corta en salto de línea cuando puede. */
export function dividirEnChunks(texto: string, tamano: number, solape: number): string[] {
  if (texto.length <= tamano) return [texto];
  const chunks: string[] = [];
  let inicio = 0;
  while (inicio < texto.length) {
    let fin = Math.min(texto.length, inicio + tamano);
    if (fin < texto.length) {
      const corte = texto.lastIndexOf('\n', fin);
      if (corte > inicio + tamano * 0.6) fin = corte;
    }
    chunks.push(texto.slice(inicio, fin));
    if (fin >= texto.length) break;
    inicio = Math.max(inicio + 1, fin - solape);
  }
  return chunks;
}

function sumarMeta(a: MetaLlm, b: MetaLlm): MetaLlm {
  return {
    proveedor: b.proveedor,
    modelo: b.modelo,
    prompt_tokens: (a.prompt_tokens ?? 0) + (b.prompt_tokens ?? 0),
    completion_tokens: (a.completion_tokens ?? 0) + (b.completion_tokens ?? 0),
    duracion_ms: a.duracion_ms + b.duracion_ms,
    intentos: a.intentos + b.intentos,
  };
}

export interface ResultadoLlm {
  analisis: Analisis;
  meta: MetaLlm;
  chunks: number;
  chars: number;
  ajustes: string[];
}

/** Análisis completo o por fragmentos + síntesis, con normalización y reglas de coherencia. */
export async function analizarContenido(prov: ProveedorLlm, rubro: Rubro, titulo: string, contenido: string, log: Logger): Promise<ResultadoLlm> {
  const system = systemPrompt(rubro);
  let bruto;
  let meta: MetaLlm;
  let chunks = 1;

  if (contenido.length <= config.LLM_MAX_CHARS) {
    const r = await prov.generarJson({ system, prompt: promptAnalisisCompleto(rubro, contenido), jsonSchema: analisisJsonSchema, validar: (raw) => AnalisisLlmSchema.parse(raw) });
    bruto = r.datos;
    meta = r.meta;
  } else {
    const partes = dividirEnChunks(contenido, config.LLM_CHUNK_CHARS, config.LLM_CHUNK_OVERLAP);
    chunks = partes.length;
    log.info({ chars: contenido.length, chunks }, 'pliego largo: análisis por fragmentos');
    const resultados: Chunk[] = [];
    meta = { proveedor: prov.nombre, modelo: prov.modelo, prompt_tokens: 0, completion_tokens: 0, duracion_ms: 0, intentos: 0 };
    for (let i = 0; i < partes.length; i++) {
      const r = await prov.generarJson({ system, prompt: promptChunk(rubro, i + 1, partes.length, partes[i]!), jsonSchema: chunkJsonSchema, validar: (raw) => ChunkSchema.parse(raw) });
      resultados.push(r.datos);
      meta = sumarMeta(meta, r.meta);
      log.debug({ chunk: i + 1, de: partes.length, ms: r.meta.duracion_ms }, 'fragmento analizado');
    }
    const r = await prov.generarJson({
      system,
      prompt: promptSintesis(rubro, titulo, truncar(JSON.stringify(resultados, null, 1), config.LLM_MAX_CHARS)),
      jsonSchema: analisisJsonSchema,
      validar: (raw) => AnalisisLlmSchema.parse(raw),
    });
    bruto = r.datos;
    meta = sumarMeta(meta, r.meta);
  }

  const normalizado = normalizarAnalisis(bruto);
  const { analisis, ajustes } = aplicarCoherenciaVisita(normalizado);
  return { analisis, meta, chunks, chars: contenido.length, ajustes };
}

// ---------------------------------------------------------------------------
// Procesamiento de un adjunto
// ---------------------------------------------------------------------------

type ResultadoAdjunto = { estado: 'ok'; ms: number } | { estado: 'extraccion_fallida'; error: string } | { estado: 'error'; error: string };

async function obtenerTexto(a: repos.AdjuntoPendiente, log: Logger): Promise<{ texto: string; error?: string; descubiertos: number }> {
  const d = await descargarAdjunto(a.archivo_url, a.llamado_id, a.archivo_analizado);
  log.debug({ bytes: d.bytes, contentType: d.contentType }, 'adjunto descargado');
  const pareceHtml = a.tipo === 'html' || /text\/html/i.test(d.contentType ?? '');
  if (pareceHtml) {
    const html = decodificarHtml(await fs.readFile(d.ruta), d.contentType);
    if (esHtmlIm(html)) {
      const im = await extraerIm(html);
      if (im.error) return { texto: '', error: im.error, descubiertos: 0 };
      let descubiertos = 0;
      if (im.items.length) await repos.insertItems(a.llamado_id, im.items);
      if (im.adjuntos.length) {
        descubiertos = await repos.upsertAdjuntos(a.llamado_id, im.adjuntos);
        log.info({ adjuntos: im.adjuntos.map((x) => x.nombre), paginas: im.paginas_visitadas.length }, 'archivos reales descubiertos en la Intendencia de Montevideo');
      }
      return { texto: im.texto, ...(im.texto ? {} : { error: 'ERROR_HTML_VACIO' }), descubiertos };
    }
  }
  const e = await extraerTexto(d.ruta);
  return { texto: e.texto, ...(e.error ? { error: e.error } : {}), descubiertos: 0 };
}

async function procesarAdjunto(prov: ProveedorLlm, rubro: Rubro, a: repos.AdjuntoPendiente, log: Logger): Promise<ResultadoAdjunto & { descubiertos: number }> {
  const t0 = Date.now();
  let descubiertos = 0;
  try {
    const ext = await obtenerTexto(a, log);
    descubiertos = ext.descubiertos;
    if (!ext.texto) {
      const error = ext.error ?? 'SIN_TEXTO';
      await repos.guardarErrorExtraccion(a.llamado_id, a.archivo_analizado, error, rubro.nombre);
      return { estado: 'extraccion_fallida', error, descubiertos };
    }
    const ctx = await repos.contextoLlamado(a.llamado_id);
    const contenido = construirContexto(ctx, a.archivo_analizado, ext.texto);
    const r = await analizarContenido(prov, rubro, ctx.titulo, contenido, log);
    await repos.guardarAnalisis({
      ...r.analisis,
      llamado_id: a.llamado_id,
      archivo_analizado: a.archivo_analizado,
      errores_extraccion: null,
      modelo: r.meta.modelo,
      proveedor: r.meta.proveedor,
      rubro: rubro.nombre,
      prompt_tokens: r.meta.prompt_tokens,
      duracion_ms: r.meta.duracion_ms,
      chars_enviados: r.chars,
    });
    const ms = Date.now() - t0;
    log.info(
      { es_relevante: r.analisis.es_relevante, confianza: r.analisis.confianza, chars: r.chars, prompt_tokens: r.meta.prompt_tokens, chunks: r.chunks, llm_ms: r.meta.duracion_ms, total_ms: ms, ajustes: r.ajustes, descripcion: r.analisis.descripcion_llamado },
      'análisis guardado',
    );
    return { estado: 'ok', ms, descubiertos };
  } catch (err) {
    return { estado: 'error', error: resumenError(err), descubiertos };
  }
}

// ---------------------------------------------------------------------------
// Fallback por metadatos
// ---------------------------------------------------------------------------

async function fallbackMetadatos(prov: ProveedorLlm, rubro: Rubro, l: repos.LlamadoSinAnalisis, log: Logger): Promise<boolean> {
  try {
    const ctx = await repos.contextoLlamado(l.llamado_id);
    const contenido = construirContexto(ctx, null, null) + '\n\nNOTA: los archivos adjuntos no pudieron ser extraídos o no existen; este análisis se basa solo en los metadatos.';
    const r = await prov.generarJson({ system: systemPrompt(rubro), prompt: promptFallback(rubro, contenido), jsonSchema: analisisJsonSchema, validar: (raw) => AnalisisLlmSchema.parse(raw) });
    const { analisis } = aplicarCoherenciaVisita(normalizarAnalisis(r.datos));
    analisis.confianza = Math.min(analisis.confianza, MAX_CONFIANZA_FALLBACK);
    await repos.guardarAnalisis({
      ...analisis,
      llamado_id: l.llamado_id,
      archivo_analizado: FALLBACK,
      errores_extraccion: 'Sin adjuntos extraíbles: análisis por metadatos',
      modelo: r.meta.modelo,
      proveedor: r.meta.proveedor,
      rubro: rubro.nombre,
      prompt_tokens: r.meta.prompt_tokens,
      duracion_ms: r.meta.duracion_ms,
      chars_enviados: contenido.length,
    });
    log.info({ es_relevante: analisis.es_relevante, confianza: analisis.confianza, llm_ms: r.meta.duracion_ms }, 'análisis fallback guardado');
    return true;
  } catch (err) {
    log.error({ id: l.llamado_id, error: resumenError(err) }, 'fallback fallido');
    return false;
  }
}

// ---------------------------------------------------------------------------
// Entrada principal
// ---------------------------------------------------------------------------

export async function analizarPendientes(logBase: Logger, limite: number): Promise<ResumenAnalisis> {
  const resumen: ResumenAnalisis = { analizados: 0, fallback: 0, errores: 0, extraccion_fallida: 0, descubiertos: 0, tiempos_ms: [] };
  const rubro = cargarRubro(config.RUBRO);
  const prov = await getProveedor();
  const log = logBase.child({ etapa: 'analisis', modelo: prov.modelo });

  let pendientes = await repos.adjuntosPendientes(limite);
  if (pendientes.length === 0) {
    log.info('no hay adjuntos pendientes de análisis');
  } else {
    await prov.preparar();
  }

  let procesados = 0;
  let pasada = 0;
  while (pendientes.length > 0 && pasada < 3) {
    pasada++;
    log.info({ pendientes: pendientes.length, pasada }, 'adjuntos pendientes');
    let descubiertosEnPasada = 0;
    for (const a of pendientes) {
      procesados++;
      const l = log.child({ id: a.llamado_id, archivo: a.archivo_analizado, n: `${procesados}` });
      const r = await procesarAdjunto(prov, rubro, a, l);
      descubiertosEnPasada += r.descubiertos;
      if (r.estado === 'ok') {
        resumen.analizados++;
        resumen.tiempos_ms.push(r.ms);
      } else if (r.estado === 'extraccion_fallida') {
        resumen.extraccion_fallida++;
        l.warn({ error: r.error }, 'adjunto no extraíble');
      } else {
        resumen.errores++;
        l.error({ error: r.error }, 'error analizando adjunto');
      }
    }
    resumen.descubiertos += descubiertosEnPasada;
    // Si la IM descubrió archivos reales, se procesan en esta misma corrida (dentro del límite)
    pendientes = descubiertosEnPasada > 0 && procesados < limite ? await repos.adjuntosPendientes(limite - procesados) : [];
  }

  const sinAnalisis = await repos.llamadosSinAnalisis(Math.min(10, Math.max(1, limite - procesados + 1)));
  if (sinAnalisis.length > 0) {
    await prov.preparar();
    log.info({ llamados: sinAnalisis.length }, 'llamados sin análisis: fallback por metadatos');
    for (const l of sinAnalisis) {
      const ok = await fallbackMetadatos(prov, rubro, l, log.child({ id: l.llamado_id, archivo: FALLBACK }));
      if (ok) resumen.fallback++;
      else resumen.errores++;
    }
  }

  if (resumen.tiempos_ms.length) {
    const prom = Math.round(resumen.tiempos_ms.reduce((s, x) => s + x, 0) / resumen.tiempos_ms.length);
    log.info({ ...resumen, tiempos_ms: undefined, promedio_ms: prom, max_ms: Math.max(...resumen.tiempos_ms) }, 'análisis terminado');
  } else {
    log.info({ ...resumen, tiempos_ms: undefined }, 'análisis terminado');
  }
  return resumen;
}
