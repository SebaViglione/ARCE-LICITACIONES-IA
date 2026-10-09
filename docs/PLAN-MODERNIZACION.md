# Plan de modernización ARCE-LICITACIONES-IA (pre hackathon Build 101)

## Contexto

El proyecto monitorea licitaciones del portal ARCE (comprasestatales.gub.uy), filtra candidatos por rubro (hoy aluminio/aberturas), descarga pliegos, los analiza con un LLM local (Ollama) y los muestra en un dashboard con feedback humano. Se va a presentar en la hackathon Build 101 (Universidad de Montevideo, ~17-18 oct 2026, tema: herramientas con IA).

La auditoría del 9/10/2026 encontró que el pipeline **hoy no corre** (rutas rotas en el workflow N8N tras la reestructura de directorios, sin trigger programado, scraper sin `node_modules`, modelo Ollama ausente), que la IA está mal configurada (`temperature` ignorada, `num_ctx` por defecto trunca el pliego, filtro de keywords por substring que descarta candidatos válidos, escalas de confianza inconsistentes) y que hay mucha deuda (1239 líneas de bash con SQL concatenado, 8 scripts duplicados, credenciales hardcodeadas, N8N como root con `latest`).

Decisión: **reemplazar N8N y el bash por un único servicio Node/TypeScript** que contenga scheduler, pipeline, API y dashboard. Queda `postgres + app (+ ollama)`. El scraper (Puppeteer) y el dashboard (Express + vanilla JS) ya son JS, así que se reutilizan. Las herramientas de extracción (pdftotext, pandoc, tesseract, antiword) se mantienen en la imagen y se invocan con `execFile` (sin shell).

Objetivo de la ejecución nocturna: terminar con `docker compose up --build` funcionando de punta a punta, con datos reales en el dashboard y métricas de precisión de la IA. Todo en una rama `modernizacion`, un commit por fase.

## Reglas para la ejecución autónoma

- Trabajar en rama `modernizacion` (crear desde `main`). Commit al final de cada fase con mensaje `feat(fase N): ...`. No pushear.
- Antes de empezar, copiar este plan a `docs/PLAN-MODERNIZACION.md` dentro del repo y mantenerlo actualizado marcando `[x]` lo hecho y anotando bloqueos en una sección `## Bitácora` al final.
- No borrar `src/n8n/`, `src/processing/` ni `scripts/` hasta la Fase 8 (solo después de que la verificación de la Fase 7 pase). Si la Fase 7 falla, dejar el legacy y documentar en la bitácora.
- Consultar la skill `claude-api` antes de tocar el proveedor Anthropic (Fase 5b); la doc de Ollama (`ollama` npm, structured outputs con `format: <json schema>`, `options.num_ctx`) vía Context7.
- Puertos por defecto: app `3000`, postgres no publicado (o `5433` si hace falta debug). N8N desaparece, así que el 5678 ya no importa. El host tiene otros contenedores (`cps-n8n`, varios Supabase): no tocar nada fuera del proyecto `arce` de compose.
- El pliego y las keywords están en español; mantener prompts en español.
- No usar `set -e` + `$?`, ni SQL concatenado, ni `latest` en imágenes.

## Arquitectura destino

```
ARCE-LICITACIONES-IA/
├── app/                         # único servicio Node 22 + TypeScript (ESM)
│   ├── package.json             # deps: express, pg, puppeteer, ollama, fast-xml-parser,
│   │                            #       node-cron, zod, pino, dotenv; dev: typescript, tsx, vitest
│   ├── tsconfig.json
│   ├── Dockerfile               # multi-stage: build tsc → runtime node:22-bookworm-slim
│   │                            # + chromium poppler-utils pandoc antiword tesseract-ocr(-spa) unzip
│   ├── src/
│   │   ├── index.ts             # arranca API + scheduler (cron cada 15 min, configurable)
│   │   ├── config.ts            # zod sobre process.env (DATABASE_URL, OLLAMA_HOST, OLLAMA_MODEL,
│   │   │                        #   LLM_PROVIDER=ollama|anthropic, RUBRO=aluminio, CRON, PORT, DATA_DIR)
│   │   ├── db/
│   │   │   ├── pool.ts          # pg Pool
│   │   │   ├── migrate.ts       # aplica migrations/*.sql en orden (tabla schema_migrations)
│   │   │   └── repos.ts         # funciones tipadas: upsertLlamado, upsertAdjuntos, pendientesDeAnalisis,
│   │   │                        #   insertAnalisis, upsertFeedback, metricas...
│   │   ├── pipeline/
│   │   │   ├── run.ts           # orquesta: rss → filtro → scrape → extract → analyze (con lock para no solapar)
│   │   │   ├── rss.ts           # fetch + fast-xml-parser + parse fechas (código del nodo "Formateo JSON")
│   │   │   ├── filtro.ts        # keywords/exclusiones por PALABRA COMPLETA, acentos normalizados
│   │   │   ├── scraper.ts       # port de src/scraper/scrape_arce.js (browser reutilizado, 1 page por llamado)
│   │   │   ├── descarga.ts      # fetch del adjunto a DATA_DIR con nombre saneado (basename + hash)
│   │   │   ├── extract.ts       # execFile pdftotext/pandoc/antiword/tesseract/unzip; port de extract_text.sh
│   │   │   ├── extract_im.ts    # port de extract_im_html.sh (HTML Intendencia de Montevideo)
│   │   │   └── analyze.ts       # arma contexto, chunking por caracteres (no bytes), llama a llm/
│   │   ├── llm/
│   │   │   ├── schema.ts        # zod AnalisisSchema + JSON Schema derivado (zod-to-json-schema)
│   │   │   ├── prompts.ts       # prompts actuales del bash, parametrizados por rubro
│   │   │   ├── ollama.ts        # cliente `ollama`: format=<schema>, options {temperature:0, num_ctx}
│   │   │   ├── anthropic.ts     # opcional (Fase 5b), misma interfaz
│   │   │   └── index.ts         # getProvider()
│   │   ├── rubros/
│   │   │   └── aluminio.json    # keywords, exclusiones, criterios de relevancia, materiales
│   │   └── api/
│   │       ├── server.ts        # express, static public/, rutas
│   │       └── routes.ts        # GET /api/llamados, /api/llamados/:id, POST /api/feedback,
│   │                            #   GET /api/metricas, POST /api/pipeline/run, GET /api/health
│   ├── public/                  # dashboard actual (index.html, app.js, styles.css) + card de métricas
│   ├── migrations/
│   │   ├── 001_schema_base.sql  # = database/scheme.sql limpio (sin \restrict, sin OWNER)
│   │   ├── 002_vista_dashboard.sql
│   │   └── 003_ajustes.sql      # ver Fase 2
│   └── test/                    # vitest: filtro, fechas, schema, parseo RSS con fixture
├── docker-compose.yml           # postgres + app (+ ollama con profile "ollama")
├── .env.example
├── docs/
│   ├── PLAN-MODERNIZACION.md    # este plan + bitácora
│   └── ARQUITECTURA.md          # diagrama nuevo (reemplaza el del README)
├── README.md                    # reescrito: quick start real en 5 comandos
└── LICENSE
```

## Fases

### Fase 0. Preparación (10 min)
- [x] `git checkout -b modernizacion`
- [x] Copiar plan a `docs/PLAN-MODERNIZACION.md`
- [ ] Modelo por defecto: `qwen3.5:9b` (Seba lo deja pulleando el 9/10). Hardware: sin GPU, 14 GB RAM, ~6 GB libres con los otros contenedores corriendo. Si `ollama list` no lo tiene, `ollama pull qwen3.5:9b`; fallback `llama3.2:3b` vía `OLLAMA_MODEL`. Qwen3.x trae modo "thinking": desactivarlo en la llamada (`think: false`) para que devuelva solo el JSON. Por ser CPU, medir tiempo por pliego y bajar `num_ctx` a 8192 si tarda más de ~3 min.
- [x] Versionar `package-lock.json` (sacarlo de `.gitignore`).

### Fase 1. Esqueleto del servicio `app/`
- [x] `npm init` en `app/`, deps listadas arriba, `tsconfig` ESM `NodeNext`, scripts: `dev` (tsx watch), `build` (tsc), `start`, `pipeline:once` (`tsx src/pipeline/run.ts`), `migrate`, `test`.
- [x] `config.ts` con zod y defaults sensatos. Sin credenciales hardcodeadas en ningún archivo.
- [x] `db/pool.ts` + `db/migrate.ts` (lee `migrations/*.sql`, aplica los que falten dentro de una transacción, registra en `schema_migrations`).
- [x] Logger pino con nivel por env.
- [x] Verificación: `npm run build` sin errores.

### Fase 2. Base de datos
- [x] `001_schema_base.sql`: tablas de `database/scheme.sql` (`llamados`, `archivos_adjuntos`, `aclaraciones`, `items_llamado`, `analisis_ia`, `feedback_usuario`), función `calcular_prioridad` y trigger. Quitar `\restrict`, `OWNER`, `SET` de pg_dump.
- [x] `002_vista_dashboard.sql`: una sola `v_llamados_dashboard` = `database/create_dashboard_view.sql` (tiene `prioridad_score` y `formularios_requeridos` que usa el frontend) **más** el conteo de archivos de aclaraciones de `migracion_total_archivos.sql`. Eliminar la definición duplicada.
- [x] `003_ajustes.sql`:
  - `analisis_ia.confianza` queda `integer 0-100` (ya está). El fallback debe guardar en esa escala (bug actual: guarda 0.3 → 0).
  - `llamados.estado` agrega `'archivado'` como destino en vez de `DELETE` a los 120 días (conservar histórico para métricas).
  - `llamados.detectado_en` no se pisa en upsert (hoy `DO UPDATE SET detectado_en = now()` borra la fecha original). Agregar `actualizado_en`.
  - `analisis_ia.modelo text` y `analisis_ia.proveedor text` para saber qué modelo generó cada análisis (útil para la demo).
  - `analisis_ia.rubro text default 'aluminio'`.
  - Índice `idx_llamados_estado` que hoy está dentro del SQL de la vista.
- [x] Verificación: `docker compose up postgres -d && npm run migrate` crea todo; `psql -c '\d analisis_ia'` muestra columnas nuevas.

### Fase 3. Pipeline de ingesta (RSS → filtro → scraper → BD)
- [x] `rss.ts`: URL con rango 60 días (lógica de "Generar rango fechas URL"), `fast-xml-parser`, port de `clean`, `extractFechaHoraApertura`, `splitPubDate` del nodo "Formateo JSON". Fechas `YYYY-MM-DD` se parsean como **local** (`new Date(f + 'T00:00:00')`), no UTC (bug de off-by-one en UTC-3).
- [x] `filtro.ts`: lee `rubros/<RUBRO>.json`. Matching por palabra completa con regex `\b` sobre texto normalizado (NFD sin diacríticos, lowercase). Revisar la lista de exclusión al migrarla: sacar `sobre`, `pan`, `luz`, `led`, `sistema`, `cubierta`, `cable`, `pantalla` como palabras sueltas (hoy matan "sobre la calle", "paneles", "Toledo"); dejar frases ("sobres con ventana", "cubiertas de vehículo"). `diasHasta` y `urgencia` se calculan acá.
- [x] `scraper.ts`: port de `src/scraper/scrape_arce.js` a módulo que recibe `(browser, url, id)` y devuelve el mismo JSON. Un solo browser por corrida, concurrencia 2-3 con `p-limit`. Puppeteer con `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`.
- [x] Dedupe antes de scrapear: no re-scrapear llamados cuyo `actualizado_en` sea de hoy (hoy se re-scrapea todo el rango de 60 días en cada corrida).
- [x] `repos.ts`: upserts parametrizados (`$1, $2...`) equivalentes a los nodos Postgres del workflow nuevo (`src/n8n/workflows/...CON SCRIPT BASH.json`). Marcar vencidos (`estado='vencido'`), archivar a los 120 días.
- [x] Verificación: `npm run pipeline:once -- --solo-ingesta` deja filas en `llamados`, `archivos_adjuntos`, `aclaraciones`, `items_llamado`. Loggear cuántos candidatos pasaron el filtro vs total del RSS (sanity check: debería ser > 0 y < 30%).

### Fase 4. Extracción de texto
- [ ] `descarga.ts`: `fetch` con los mismos headers (UA, Referer) que el `wget` actual, guardar en `DATA_DIR/<llamado_id>/<basename saneado>`. Nunca usar el nombre remoto crudo en el path.
- [ ] `extract.ts`: port de `extract_text.sh` por extensión: pdf → `pdftotext` y OCR con `tesseract -l spa` si < 50 chars; doc → `antiword` luego `pandoc`; docx/rtf/odt/xls/xlsx/ods → `pandoc -t plain`; txt; zip → `unzip` a tmp y recursión; imágenes → tesseract; rar/7z → error tipado. Todo con `execFile` + timeout 120 s. Devuelve `{ texto, error? }`.
- [ ] `extract_im.ts`: port de `extract_im_html.sh` (detección de redirect "Haga click aqui", hidden inputs, items y adjuntos de la Intendencia). Inserta items y adjuntos descubiertos vía `repos`.
- [ ] Verificación: test unitario con un PDF y un DOCX chicos de fixture (generarlos con pandoc en el test o commitear 2 archivos pequeños).

### Fase 5. Análisis con IA
- [ ] `llm/schema.ts`: zod `AnalisisSchema` con los 15 campos actuales (`descripcion_llamado`, `es_relevante`, `confianza` int 0-100, `razon`, `materiales_detectados[]`, `resumen_trabajo`, `ubicacion_obra`, `requiere_visita`, `ubicacion_visita`, `fecha_visita_especifica` (date|null), `coordina_visita`, contactos, `formularios_requeridos[{nombre,obligatorio,seccion}]`). Exportar el JSON Schema para `format`.
- [ ] `llm/prompts.ts`: reutilizar los prompts de `procesar_analisis_batch.sh` (análisis completo, chunk, síntesis, fallback) pero: criterios de relevancia y materiales vienen del `rubros/*.json`; **todas** las escalas de confianza 0-100; sin el bloque "NUNCA null" (lo garantiza el schema).
- [ ] `llm/ollama.ts`: `ollama.generate({ model, prompt, system, format: jsonSchema, options: { temperature: 0, num_ctx: 16384 }, stream: false })`. Parsear con zod; un reintento si falla validación.
- [ ] `pipeline/analyze.ts`:
  - Contexto = título + texto del archivo + descripción + items + aclaraciones (como `obtener_contexto_llamado`).
  - `MAX_CHARS` 40000 (con num_ctx 16k entra), chunking por caracteres con overlap solo por encima de eso; pasar total real de chunks (hoy se pasa `"?"`).
  - Post-proceso mínimo de coherencia de visita (reglas 1-4 del bash) sobre el objeto ya validado.
  - Fallback por metadatos cuando ningún adjunto es extraíble, `archivo_analizado = 'METADATA_FALLBACK'`, confianza acotada a ≤ 50.
  - Guardar `modelo`, `proveedor`, `rubro`.
  - Límite por corrida configurable (default 50 archivos) y lock en memoria para que el cron no solape corridas.
- [ ] Verificación: `npm run pipeline:once` sobre 3-5 llamados reales. Revisar que `analisis_ia` tenga `es_relevante` no nulo, `confianza` entre 0 y 100, y que un pliego largo no quede truncado (loggear chars enviados vs `prompt_eval_count` que devuelve Ollama).

### Fase 5b. Proveedor alternativo Anthropic (opcional, solo si Fase 5 está verde)
- [ ] `llm/anthropic.ts` con la misma interfaz, usando tool-use/structured output con el mismo JSON Schema. Modelo por env (`ANTHROPIC_MODEL`), default el más capaz vigente según la skill `claude-api`. `LLM_PROVIDER=anthropic` lo activa. Sirve de respaldo si el modelo local es lento en la demo.

### Fase 6. API y dashboard
- [ ] `api/routes.ts`: portar las 3 rutas de `src/dashboard/server.js` (ya usan parámetros, están bien). Agregar:
  - `GET /api/metricas`: a partir de `feedback_usuario` (`ia_es_relevante` vs `es_relevante_real`): precisión, recall, F1, matriz de confusión, total revisados; más conteos de `analisis_ia` por modelo.
  - `POST /api/pipeline/run`: dispara una corrida (responde 202 si ya hay una en curso). Para la demo en vivo.
  - `GET /api/health`: BD y Ollama alcanzables, modelo cargado.
  - Validar body de `/api/feedback` con zod (`estado_seguimiento` en el enum del frontend).
  - Paginación simple en `/api/llamados` (`?limit&offset`, default 200) y filtro `?rubro`.
- [ ] `public/`: mover el dashboard actual; agregar card "Precisión IA" en el resumen (`summary-grid` de `index.html`) y un botón "Actualizar ahora" que llama a `/api/pipeline/run`. Mostrar `modelo` en el modal. Nada más de UI (no vale la pena rediseñar a días de la hackathon).
- [ ] Eliminar `src/dashboard/app.js` (copia vieja de `public/app.js`).
- [ ] Verificación: `curl /api/health`, `/api/metricas`, abrir `http://localhost:3000` y ver tarjetas con datos reales.

### Fase 7. Docker y arranque en un comando
- [ ] `app/Dockerfile` multi-stage (`node:22-bookworm-slim`), instala chromium + poppler-utils + pandoc + antiword + tesseract-ocr + tesseract-ocr-spa + unzip + fonts, usuario no root, `HEALTHCHECK` contra `/api/health`.
- [ ] `docker-compose.yml`: `postgres:16-alpine` (healthcheck), `app` (depende de postgres healthy, corre `migrate` al arrancar, `extra_hosts: host.docker.internal:host-gateway`, `OLLAMA_HOST=http://host.docker.internal:11434` por default), servicio `ollama` bajo `profiles: [ollama]` para quien no tenga Ollama nativo. Volúmenes: `postgres_data`, `app_data` (adjuntos descargados).
- [ ] `.env.example` en la raíz con todas las variables y comentarios. `.env` actual se adapta (sin variables de N8N).
- [ ] README reescrito: qué es, diagrama nuevo, quick start (`cp .env.example .env`, `ollama pull qwen3.5:9b`, `docker compose up --build`, abrir :3000, botón "Actualizar ahora"), cómo cambiar de rubro, cómo cambiar de proveedor LLM, métricas.
- [ ] Verificación de punta a punta (criterio de éxito de toda la noche):
  1. `docker compose down -v && docker compose up --build -d`
  2. `curl localhost:3000/api/health` → ok
  3. `curl -X POST localhost:3000/api/pipeline/run` y esperar; logs sin errores no controlados
  4. `psql`: `llamados > 0`, `analisis_ia > 0`, ninguna `confianza` fuera de 0-100
  5. Dashboard muestra tarjetas; guardar un feedback desde el modal; `/api/metricas` lo refleja.

### Fase 8. Limpieza (solo si Fase 7 pasó)
- [ ] Borrar `src/n8n/`, `src/processing/`, `scripts/` (salvo lo que tenga sentido como `scripts/dev-*.sh`), `src/dashboard/`, `src/scraper/`, `database/` (ya migrado a `app/migrations`). Mover a `legacy/` NO: el historial de git alcanza.
- [ ] Quitar la contraseña `n8n_secure_password_2024` de cualquier `.md` que quede.
- [ ] `.gitignore` actualizado (`app/node_modules`, `app/dist`, `data/`, `.env`).
- [ ] Commit final y resumen en `docs/PLAN-MODERNIZACION.md` → sección Bitácora con: qué se hizo, qué quedó pendiente, tiempos del pipeline (cuánto tarda analizar un pliego con el modelo elegido).

### Fase 9. Stretch para la hackathon (solo con todo lo anterior verde)
- [ ] Segundo rubro de ejemplo (`rubros/construccion.json` o `it.json`) para demostrar que es configurable.
- [ ] Notificación por Telegram/email de nuevos relevantes (un webhook simple).
- [ ] "Preguntale al pliego": embeddings con `nomic-embed-text` en pgvector + endpoint `/api/llamados/:id/preguntar`. Es lo más vistoso para la demo pero también lo más riesgoso; dejar para último.

## Cosas que NO se hacen (a propósito)
- Rediseño visual del dashboard.
- Auth multiusuario (si hace falta para "que me dejen acceder", un `APP_TOKEN` por header es suficiente y entra en Fase 6 en 15 min).
- Fine-tuning del modelo.
- Mantener compatibilidad con N8N.

## Verificación resumida
Comando único al final de la noche:
```
docker compose down -v && docker compose up --build -d \
 && sleep 20 && curl -sf localhost:3000/api/health \
 && curl -sf -X POST localhost:3000/api/pipeline/run \
 && cd app && npm test
```
Luego abrir `http://localhost:3000`, verificar tarjetas, guardar un feedback y ver `/api/metricas`.

## Bitácora

### 2026-10-09 · Fase 0
- Entorno real: Node 22.22, Docker 29.6 + Compose 5.5, 16 CPU, 15 GB RAM (~7 GB disponibles con los contenedores `cps-*` y Supabase corriendo).
- Ollama **no** está instalado nativo: corre como contenedor `cps-ollama` (ollama 0.40.2) publicado en `localhost:11434`. Solo tenía `llama3.2:3b`; se lanzó `POST /api/pull qwen3.5:9b` por la API (sin tocar el contenedor).
- En el host faltan `tesseract` y `chromium`; no importa para Docker (van en la imagen) y para el desarrollo nativo Puppeteer baja su propio Chrome. El OCR nativo simplemente falla de forma controlada.
- Puertos 3000 y 5433 libres en el host.
- Rama `modernizacion` creada desde `main`; `package-lock.json` sacado de `.gitignore`.

### 2026-10-09 · Fase 1
- `app/` con Node 22 + TypeScript 7 (ESM `NodeNext`), deps: express 5, pg 8, puppeteer 25, ollama 0.6, fast-xml-parser 5, node-cron 4, zod 4 (trae `z.toJSONSchema`, no hace falta `zod-to-json-schema`), pino 10, dotenv 18, p-limit 7. Dev: tsx, vitest 5, pino-pretty.
- `config.ts` valida `process.env` con zod; `DATABASE_URL` es obligatoria (no hay credenciales por defecto en el código). Carga `app/.env` y si no, el `.env` de la raíz.
- `db/migrate.ts` aplica `migrations/*.sql` en orden dentro de una transacción cada una, con `pg_advisory_lock` y tabla `schema_migrations`.
- `npm run build` compila sin errores.

### 2026-10-09 · Fase 2
- Orden final de migraciones: `001_schema_base` → `002_ajustes` → `003_vista_dashboard` (la vista expone `modelo/proveedor/rubro`, así que los ajustes van antes).
- Extras respecto al plan: `items_llamado` tenía duplicados en cada corrida (no había unicidad) → índice único por `(id_llamado, md5(texto))`; `analisis_ia` guarda además `prompt_tokens`, `duracion_ms`, `chars_enviados` para medir el modelo; tabla `corridas_pipeline` para `/api/pipeline/estado`; check de `estado_seguimiento`.
- La vista prioriza análisis sobre archivo real por encima de `METADATA_FALLBACK` y ya no filtra por estado (lo hace la API).
- `docker-compose.yml` nuevo (proyecto `arce`): postgres publicado solo en `127.0.0.1:5433`; `.env` adaptado sin variables de N8N. Verificado: `npm run migrate` aplica 001-003 y es idempotente.

### 2026-10-09 · Fase 3
- RSS real: 1000 ítems (el portal corta en 1000), 15-20 candidatos (~2%). Las descripciones vienen en CDATA con entidades HTML (`&Uacute;`, `&sol;`, `&nbsp;`): se decodifican en `utils/texto.ts`.
- Fechas: todo en zona `America/Montevideo` vía `Intl` (`TZ_LOCAL`), independiente del TZ del proceso; `dias_restantes` por diferencia de días calendario.
- Keywords: saqué `marco`/`marcos` sueltos (5 de 20 candidatos eran "en el marco del programa…") y agregué `marcos de aluminio`, `marcos de ventana(s)`, etc. Exclusiones sin `sobre`, `pan`, `luz`, `led`, `sistema`, `cubierta(s)`, `cable`, `pantalla`. Por eso ahora pasan el pre-filtro cosas como "cables de aluminio" o "panel LED": las descarta la IA.
- Filtro post-scraping por ítems (port del nodo "Filtro items keyword"): descartó 5 de 15. Los rechazados se recuerdan en memoria por día para no re-scrapearlos cada 15 min.
- Dedupe: no se re-scrapea un llamado con `actualizado_en` de hoy; solo se refrescan `dias_restantes`/`urgencia`.
- Resultado: `pipeline:once --solo-ingesta` → 15 scrapeados en 11 s (concurrencia 2), 10 llamados, 10 adjuntos (4 html IM, 3 docx, 3 pdf), 8 aclaraciones, 9 ítems. 26 tests unitarios (filtro, RSS con fixture real, fechas).
- Los rubros viven en `app/rubros/*.json` (fuera de `src/` para que lleguen tal cual a `dist/` y a la imagen).
