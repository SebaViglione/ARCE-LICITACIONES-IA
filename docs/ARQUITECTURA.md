# Arquitectura

Un único servicio Node 22 + TypeScript (`app/`) contiene el scheduler, el pipeline, la API y el dashboard. Al lado, PostgreSQL 16. El modelo de lenguaje corre en Ollama (en el host o como perfil opcional del compose) o en la API de Anthropic.

```
                       cada 15 min (cron) · botón "Actualizar ahora" · POST /api/pipeline/run
                                                 │
   ┌─────────────────────────────────────────────▼──────────────────────────────────────────┐
   │ app (Node 22 / TypeScript)                                                             │
   │                                                                                        │
   │  pipeline/run.ts  ──►  rss.ts ──► filtro.ts ──► scraper.ts ──► db/repos.ts            │
   │   (lock en memoria)    RSS ARCE    keywords por    Puppeteer     upserts llamados,      │
   │                        60 días     palabra completa (1 browser,  adjuntos, aclaraciones,│
   │                                    + exclusiones    2 pages)     ítems                  │
   │                                                                                        │
   │                   ──►  analyze.ts ──► descarga.ts ──► extract.ts / extract_im.ts        │
   │                        pendientes     DATA_DIR         pdftotext · pandoc · antiword    │
   │                        de análisis                     tesseract (OCR) · unzip · HTML   │
   │                                            │                                           │
   │                                            ▼                                           │
   │                        llm/  schema.ts (zod → JSON Schema) · prompts.ts (por rubro)     │
   │                              ollama.ts (structured output) · anthropic.ts (tool use)    │
   │                                            │                                           │
   │                                            ▼                                           │
   │                        analisis_ia (es_relevante, confianza 0-100, visita, contactos,   │
   │                                     formularios, modelo, tokens, duración)             │
   │                                                                                        │
   │  api/  Express 5: /api/llamados · /api/llamados/:id · /api/feedback · /api/metricas     │
   │                   /api/pipeline/run · /api/pipeline/estado · /api/health · /api/rubros  │
   │  public/  dashboard (HTML + JS vanilla): tarjetas, modal, feedback humano, precisión IA │
   └──────────────────────────────────────┬─────────────────────────────────────────────────┘
                                          │ pg
                                          ▼
                              ┌─────────────────────┐          ┌──────────────────────┐
                              │ PostgreSQL 16       │          │ Ollama (host o perfil)│
                              │ migrations/*.sql    │          │ qwen3.5:4b por defecto│
                              │ v_llamados_dashboard│          │ o Anthropic API       │
                              └─────────────────────┘          └──────────────────────┘
```

## Flujo de una corrida

1. **Estados**: los llamados con apertura pasada pasan a `vencido`; a los 120 días, a `archivado` (no se borra nada: el histórico alimenta las métricas).
2. **RSS**: se descarga el feed de publicaciones de los últimos 60 días (hasta 1000 ítems) y se parsea título, descripción, fecha/hora de apertura ("Recepción de ofertas hasta") y publicación, todo en hora de Montevideo.
3. **Filtro**: pasa un llamado si alguna keyword del rubro aparece como palabra o frase completa (sin acentos, sin distinguir mayúsculas), ninguna exclusión aparece y la apertura es hoy o futura. Se loguea la proporción candidatos/total.
4. **Scraper**: solo para llamados no vistos hoy. Un Chromium headless compartido, 2 páginas en paralelo, sin imágenes/CSS. Extrae aclaraciones, adjuntos e ítems. Si el llamado tiene ítems y ninguno menciona el rubro, se descarta.
5. **Extracción**: cada adjunto pendiente se descarga a `DATA_DIR/adjuntos/<id>/` con nombre saneado y se convierte a texto según la extensión. Los pliegos de la Intendencia de Montevideo (un HTML de redirección) se siguen hasta la página real y sus documentos de comentarios, de donde salen los PDF verdaderos, que se agregan como adjuntos y se analizan en la misma corrida.
6. **IA**: contexto = título + descripción + ítems + aclaraciones + texto del archivo. Si supera `LLM_MAX_CHARS` (derivado de `OLLAMA_NUM_CTX`), se fragmenta con solape, se analiza cada fragmento y se sintetiza. La respuesta está forzada al JSON Schema del análisis; luego se normaliza (confianza 0-100, fechas ISO) y se aplican las reglas de coherencia de visita técnica.
7. **Fallback**: un llamado activo sin ningún análisis válido y sin adjuntos extraíbles pendientes se analiza solo con sus metadatos (`archivo_analizado = METADATA_FALLBACK`, confianza ≤ 50).
8. **Dashboard**: la vista `v_llamados_dashboard` combina cada llamado con su mejor análisis (prefiere un archivo real al fallback, luego mayor confianza) y el conteo de archivos. El feedback humano guarda un snapshot de lo que dijo la IA; `/api/metricas` calcula precisión, recall y F1 con eso.

## Tablas

| Tabla | Contenido |
|---|---|
| `llamados` | Un llamado del portal: fechas, urgencia, estado (`activo/vencido/archivado`), `detectado_en` (primera vez), `actualizado_en` (última vez visto) |
| `archivos_adjuntos` | Adjuntos descubiertos por el scraper o por la cadena IM (`tipo` por extensión) |
| `aclaraciones` | Aclaraciones publicadas, con su archivo si lo hay |
| `items_llamado` | Ítems del llamado (únicos por llamado) |
| `analisis_ia` | Un análisis por archivo analizado (o `METADATA_FALLBACK`); errores de extracción quedan registrados sin `es_relevante` |
| `feedback_usuario` | Revisión humana: relevante real, estado de seguimiento, comentario, snapshot IA |
| `corridas_pipeline` | Resumen de cada corrida (origen, conteos, duración) |
| `schema_migrations` | Migraciones aplicadas |

## Configuración por rubro

`app/rubros/<nombre>.json` define keywords, exclusiones, materiales de ejemplo y los criterios de relevancia que se inyectan en los prompts. `RUBRO=<nombre>` selecciona uno. Cada análisis guarda el rubro con el que se hizo.
