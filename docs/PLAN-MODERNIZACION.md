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
- [x] `descarga.ts`: `fetch` con los mismos headers (UA, Referer) que el `wget` actual, guardar en `DATA_DIR/<llamado_id>/<basename saneado>`. Nunca usar el nombre remoto crudo en el path.
- [x] `extract.ts`: port de `extract_text.sh` por extensión: pdf → `pdftotext` y OCR con `tesseract -l spa` si < 50 chars; doc → `antiword` luego `pandoc`; docx/rtf/odt/xls/xlsx/ods → `pandoc -t plain`; txt; zip → `unzip` a tmp y recursión; imágenes → tesseract; rar/7z → error tipado. Todo con `execFile` + timeout 120 s. Devuelve `{ texto, error? }`.
- [x] `extract_im.ts`: port de `extract_im_html.sh` (detección de redirect "Haga click aqui", hidden inputs, items y adjuntos de la Intendencia). Inserta items y adjuntos descubiertos vía `repos`.
- [x] Verificación: test unitario con un PDF y un DOCX chicos de fixture (generarlos con pandoc en el test o commitear 2 archivos pequeños).

### Fase 5. Análisis con IA
- [x] `llm/schema.ts`: zod `AnalisisSchema` con los 15 campos actuales (`descripcion_llamado`, `es_relevante`, `confianza` int 0-100, `razon`, `materiales_detectados[]`, `resumen_trabajo`, `ubicacion_obra`, `requiere_visita`, `ubicacion_visita`, `fecha_visita_especifica` (date|null), `coordina_visita`, contactos, `formularios_requeridos[{nombre,obligatorio,seccion}]`). Exportar el JSON Schema para `format`.
- [x] `llm/prompts.ts`: reutilizar los prompts de `procesar_analisis_batch.sh` (análisis completo, chunk, síntesis, fallback) pero: criterios de relevancia y materiales vienen del `rubros/*.json`; **todas** las escalas de confianza 0-100; sin el bloque "NUNCA null" (lo garantiza el schema).
- [x] `llm/ollama.ts`: `ollama.generate({ model, prompt, system, format: jsonSchema, options: { temperature: 0, num_ctx: 16384 }, stream: false })`. Parsear con zod; un reintento si falla validación.
- [x] `pipeline/analyze.ts`:
  - Contexto = título + texto del archivo + descripción + items + aclaraciones (como `obtener_contexto_llamado`).
  - `MAX_CHARS` 40000 (con num_ctx 16k entra), chunking por caracteres con overlap solo por encima de eso; pasar total real de chunks (hoy se pasa `"?"`).
  - Post-proceso mínimo de coherencia de visita (reglas 1-4 del bash) sobre el objeto ya validado.
  - Fallback por metadatos cuando ningún adjunto es extraíble, `archivo_analizado = 'METADATA_FALLBACK'`, confianza acotada a ≤ 50.
  - Guardar `modelo`, `proveedor`, `rubro`.
  - Límite por corrida configurable (default 50 archivos) y lock en memoria para que el cron no solape corridas.
- [ ] Verificación: `npm run pipeline:once` sobre 3-5 llamados reales. Revisar que `analisis_ia` tenga `es_relevante` no nulo, `confianza` entre 0 y 100, y que un pliego largo no quede truncado (loggear chars enviados vs `prompt_eval_count` que devuelve Ollama).

### Fase 5b. Proveedor alternativo Anthropic (opcional, solo si Fase 5 está verde)
- [x] `llm/anthropic.ts` con la misma interfaz, usando tool-use/structured output con el mismo JSON Schema. Modelo por env (`ANTHROPIC_MODEL`), default el más capaz vigente según la skill `claude-api`. `LLM_PROVIDER=anthropic` lo activa. Sirve de respaldo si el modelo local es lento en la demo.

### Fase 6. API y dashboard
- [x] `api/routes.ts`: portar las 3 rutas de `src/dashboard/server.js` (ya usan parámetros, están bien). Agregar:
  - `GET /api/metricas`: a partir de `feedback_usuario` (`ia_es_relevante` vs `es_relevante_real`): precisión, recall, F1, matriz de confusión, total revisados; más conteos de `analisis_ia` por modelo.
  - `POST /api/pipeline/run`: dispara una corrida (responde 202 si ya hay una en curso). Para la demo en vivo.
  - `GET /api/health`: BD y Ollama alcanzables, modelo cargado.
  - Validar body de `/api/feedback` con zod (`estado_seguimiento` en el enum del frontend).
  - Paginación simple en `/api/llamados` (`?limit&offset`, default 200) y filtro `?rubro`.
- [x] `public/`: mover el dashboard actual; agregar card "Precisión IA" en el resumen (`summary-grid` de `index.html`) y un botón "Actualizar ahora" que llama a `/api/pipeline/run`. Mostrar `modelo` en el modal. Nada más de UI (no vale la pena rediseñar a días de la hackathon).
- [x] Eliminar `src/dashboard/app.js` (copia vieja de `public/app.js`).
- [x] Verificación: `curl /api/health`, `/api/metricas`, abrir `http://localhost:3000` y ver tarjetas con datos reales.

### Fase 7. Docker y arranque en un comando
- [x] `app/Dockerfile` multi-stage (`node:22-bookworm-slim`), instala chromium + poppler-utils + pandoc + antiword + tesseract-ocr + tesseract-ocr-spa + unzip + fonts, usuario no root, `HEALTHCHECK` contra `/api/health`.
- [x] `docker-compose.yml`: `postgres:16-alpine` (healthcheck), `app` (depende de postgres healthy, corre `migrate` al arrancar, `extra_hosts: host.docker.internal:host-gateway`, `OLLAMA_HOST=http://host.docker.internal:11434` por default), servicio `ollama` bajo `profiles: [ollama]` para quien no tenga Ollama nativo. Volúmenes: `postgres_data`, `app_data` (adjuntos descargados).
- [x] `.env.example` en la raíz con todas las variables y comentarios. `.env` actual se adapta (sin variables de N8N).
- [x] README reescrito: qué es, diagrama nuevo, quick start (`cp .env.example .env`, `ollama pull qwen3.5:9b`, `docker compose up --build`, abrir :3000, botón "Actualizar ahora"), cómo cambiar de rubro, cómo cambiar de proveedor LLM, métricas.
- [x] Verificación de punta a punta (criterio de éxito de toda la noche):
  1. `docker compose down -v && docker compose up --build -d`
  2. `curl localhost:3000/api/health` → ok
  3. `curl -X POST localhost:3000/api/pipeline/run` y esperar; logs sin errores no controlados
  4. `psql`: `llamados > 0`, `analisis_ia > 0`, ninguna `confianza` fuera de 0-100
  5. Dashboard muestra tarjetas; guardar un feedback desde el modal; `/api/metricas` lo refleja.

### Fase 8. Limpieza (solo si Fase 7 pasó)
- [x] Borrar `src/n8n/`, `src/processing/`, `scripts/` (salvo lo que tenga sentido como `scripts/dev-*.sh`), `src/dashboard/`, `src/scraper/`, `database/` (ya migrado a `app/migrations`). Mover a `legacy/` NO: el historial de git alcanza.
- [x] Quitar la contraseña vieja de N8N de cualquier `.md` que quede (estaba solo en los README de `src/` y `scripts/`, borrados).
- [x] `.gitignore` actualizado (`app/node_modules`, `app/dist`, `data/`, `.env`).
- [x] Commit final y resumen en `docs/PLAN-MODERNIZACION.md` → sección Bitácora con: qué se hizo, qué quedó pendiente, tiempos del pipeline (cuánto tarda analizar un pliego con el modelo elegido).

### Fase 9. Stretch para la hackathon (solo con todo lo anterior verde)
- [x] Segundo rubro de ejemplo: `app/rubros/informatica.json` (46 keywords; sobre el RSS real da 24 candidatos de 1000). Se activa con `RUBRO=informatica`.
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

### 2026-10-09 · Fase 4
- `extract.ts`: `execFile` sin shell, timeout 120 s, `maxBuffer` 64 MB. PDF con `pdftotext -layout`; si trae < 50 chars, OCR con `pdftoppm` (8 páginas a 200 dpi) + `tesseract -l spa`. ZIP con `unzip -j` a un tmp y recursión (profundidad ≤ 2). HTML genérico → texto plano. Errores tipados (`ERROR_*`) como en el bash, más `ERROR_HERRAMIENTA_NO_DISPONIBLE`.
- Cadena real de la Intendencia de Montevideo relevada con un llamado vivo (D197462): el `.html` de ARCE (263 bytes) redirige a una página Lotus Notes en **ISO-8859-1 sin meta charset**, que no tiene los `<input hidden>` que esperaba el bash (formato viejo; se mantiene soporte) sino una lista de "Comentarios, aclaraciones y modificaciones"; cada comentario es otro documento con el archivo real en `.../$FILE/<NOMBRE>.PDF`. `extract_im.ts` sigue toda la cadena, devuelve el texto de la página + comentarios y **descubre los PDF reales**, que se insertan como adjuntos y se analizan en la misma corrida.
- Descargas a `DATA_DIR/adjuntos/<id>/<nombre saneado>-<hash8>.<ext>`; nunca se usa el nombre remoto crudo.
- Fixtures commiteados: PDF mínimo generado a mano (731 bytes), DOCX generado con pandoc, ZIP con ambos, y los 3 HTML reales de la IM. 40 tests verdes (los de pdftotext/pandoc/unzip se saltan si la herramienta no está).

### 2026-10-09 · Fase 5 (código)
- `llm/schema.ts`: esquema laxo para el modelo (`AnalisisLlmSchema`, JSON Schema vía `z.toJSONSchema` sin `$schema`) + esquema estricto para la BD; `normalizarAnalisis` lleva confianza a 0-100 (acepta 0-1 y "85%"), fechas a ISO (acepta dd/mm/aaaa), extrae el email, deduplica materiales/formularios; `aplicarCoherenciaVisita` = reglas 1-4 del bash.
- `llm/ollama.ts`: `generate` con `format=<json schema>`, `options {temperature:0, num_ctx, num_predict}`, `think:false` solo si el modelo declara la capacidad `thinking` (Ollama rechaza el parámetro en modelos sin ella), `keep_alive 30m`, timeout por request vía `fetch` propio, un reintento si la respuesta no valida (y duplica `num_predict` si cortó por largo).
- `pipeline/analyze.ts`: contexto = título + descripción + ítems + aclaraciones + archivo; chunking por caracteres con solape y conteo real de fragmentos; límites derivados de `OLLAMA_NUM_CTX` (`derivarLimites`: 16k → 41.6k chars, 8k → 17k chars) salvo que `LLM_MAX_CHARS` se fije a mano; errores de extracción quedan registrados en `analisis_ia.errores_extraccion` (sin `es_relevante`) para no reintentar en cada corrida; fallback por metadatos con confianza ≤ 50 para llamados activos sin análisis válido ni adjuntos pendientes; los PDF descubiertos en la IM se analizan en la misma corrida (hasta 3 pasadas dentro del límite).
- Primer análisis real (llamado D197530, puerta de madera de la IM, 1.681 chars / 1.966 tokens): `llama3.2:3b` tardó 51 s y **se equivocó** (relevante 95 %, inventó "liceo en Salto" copiando el ejemplo del prompt, marcó visita sin base). Saqué el ejemplo concreto del prompt. Ver la comparación de modelos al final de la Fase 5.

### 2026-10-09 · Fase 6
- Express 5 (`app/src/api`): `GET /api/health` (BD + Ollama: modelo descargado/cargado), `GET /api/llamados?estado&rubro&limit&offset`, `GET /api/llamados/:id` (incluye todos los análisis del llamado e ítems), `POST /api/feedback` (zod; si el cliente no manda `ia_*` se guarda el snapshot del mejor análisis, así las métricas funcionan: el frontend viejo mandaba `null`), `GET /api/metricas` (matriz de confusión, precisión/recall/F1/exactitud, totales, por modelo con duración y tokens promedio), `POST /api/pipeline/run` (202, no bloquea; 202 con `iniciada:false` si ya corre), `GET /api/pipeline/estado`, `GET /api/rubros`.
- Dashboard: mismo HTML/CSS/JS en `app/public/` + card "Precisión IA" (precision/recall/revisadas), botón "Actualizar ahora" que dispara el pipeline y hace polling del estado cada 5 s, línea de estado de la última corrida, y "Modelo" en el modal. `src/dashboard/app.js` (copia vieja) se va en la Fase 8.
- Verificado nativo en :3011 con curl: health ok, listado, detalle, 404, feedback inválido → 400 con detalle zod, feedback válido → snapshot IA, métricas (1 FP tras marcar la puerta de madera como no relevante), 404 de API en JSON, body inválido → 400.
- `index.ts`: migra con reintentos, levanta API, valida el cron (`node-cron` 4, zona `America/Montevideo`), corrida inicial a los 5 s si `RUN_ON_START`, apagado limpio con SIGTERM.
- Modelo por defecto cambiado a **`qwen3.5:4b` con `num_ctx` 8192** (ver comparación en Fase 5). `OLLAMA_HOST` (nativo) y `OLLAMA_HOST_DOCKER` (contenedor) separados en `.env`.

### 2026-10-09 · Fase 5b
- `llm/anthropic.ts` con `@anthropic-ai/sdk` 0.133: `client.beta.messages.create` con `output_config.format = { type: 'json_schema', schema }` (mismo JSON Schema que Ollama), `effort: 'medium'`, `max_tokens` 16000, y `fallbacks: 'default'` + beta `server-side-fallback-2026-07-01` (si un clasificador rechaza, la API reintenta en otro modelo en la misma llamada). Modelo por defecto `claude-opus-5-5` según la skill `claude-api`; `ANTHROPIC_MODEL` lo cambia. Maneja `stop_reason` `refusal`/`max_tokens`, un reintento si no valida, y `salud()` distingue key inválida / modelo inexistente / sin conexión.
- **No probado contra la API real**: en el host no hay `ANTHROPIC_API_KEY` ni `ant auth`. Verificado por tipado contra el SDK y con 4 tests con cliente simulado (esquema enviado, reintento, rechazo, salud).

### 2026-10-09 · Fase 5 (verificación nativa) y comparación de modelos
- Benchmark en CPU con un pedido chico de structured output (92 tokens de prompt): `qwen3.5:9b` 45 tok/s prompt / **2,0 tok/s** generación con la RAM al límite (5,5 GB de swap); `llama3.2:3b` ~10 tok/s prompt / 4 tok/s generación. Conclusión: en este host el 9b no es viable como default.
- Sobre el mismo pliego real (D197530 IM, puerta interior de madera, ~1.900 tokens): `llama3.2:3b` 51 s y respuesta mala (relevante 95 %, inventó "liceo en Salto", visita sin base); `qwen3.5:4b` 60 s y respuesta correcta en forma (descripción fiel, sin visita, detecta "Madera") aunque la marcó relevante 92 % → se agregó al rubro el criterio "aberturas de madera/chapa/PVC no son del rubro". Default final: **`qwen3.5:4b`, `num_ctx` 8192**.
- Corrida nativa completa con `qwen3.5:4b`: 3 adjuntos chicos analizados en 45-60 s cada uno; la cadena IM descubrió los PDF reales de dos llamados y los encoló en la misma corrida; un PDF escaneado quedó como `ERROR_PDF_NO_EXTRAIBLE` (sin tesseract en el host; en Docker sí está). El pliego largo `pliego_1375325.docx` (73.524 chars) entró en modo fragmentos (7 chunks). A las 20:56 **desapareció el contenedor/volumen de Postgres** (un `down -v` externo): los guardados posteriores fallaron con `ECONNREFUSED` y se perdió esa corrida. Se aprovechó para mejorar `resumenError` (los `AggregateError` de red venían con mensaje vacío). Los tiempos definitivos se toman de la verificación Docker de la Fase 7.

### 2026-10-09 · Fase 7 (primera corrida completa en Docker, `qwen3.5:4b`, `num_ctx` 8192)
- `docker compose up --build` desde cero: migraciones OK, `/api/health` OK con Ollama del host vía `host.docker.internal` (modelo descargado y cargado).
- La corrida inicial (5 s tras el boot) falló al bajar el RSS con `Connect Timeout` aunque 30 s después ambas IPs del portal respondían en 10 ms desde el contenedor: la red recién creada tarda en salir a internet. Fix: reintentos en `descargarRss` (3, con espera creciente) y en `descargarAdjunto`, y corrida inicial a los 15 s.
- Corrida completa: RSS 1000 ítems → 15 candidatos (1,5 %) → 15 scrapeados en ~12 s → 10 llamados nuevos (5 descartados por ítems) → 13 adjuntos analizados (10 originales + 3 PDF reales descubiertos en la cadena IM), 0 pendientes, 0 fallos de extracción (el PDF escaneado se resolvió por OCR dentro de la imagen). Duración total 47 min.
- Tiempos por adjunto (incluye descarga + extracción + LLM): pliegos de 1,3-3,9 k chars → **35-61 s**; PDF escaneado con OCR (10,5 k chars) → 112-120 s; pliegos de 61-73 k chars (6-7 fragmentos + síntesis) → **470-630 s**. Promedio 171 s, 7.853 tokens de prompt promedio.
- Calidad (revisión manual): correctos los "no relevante" (puertas de madera, panel LED, cables de aluminio, limpieza de vidrios, restauración de ventanas de hierro) y los "relevante" (mampara de aluminio ASSE, 2 puertas de aluminio IM). Discutibles: "chapas galvanizadas + escalera de aluminio" (92 %) y "mantenimiento edilicio y pintura" (85 %): son los casos para el feedback humano.
- Incidente: a las 21:27 el kernel mató `llama-server` por OOM (4,8 GB RSS; el host tiene ~3 GB disponibles con los otros stacks). Ollama recargó el modelo solo; el adjunto en curso quedó sin análisis y lo retomó el cron 15 min después. Fix: `ollama.ts` reintenta hasta 3 veces (10/20/30 s) ante errores transitorios ("unexpected EOF", ECONNRESET, timeouts). Tests con cliente simulado para Ollama y Anthropic (61 tests en total).

### 2026-10-09 · Fase 7 (verificación final desde cero) → **OK**
- `scripts/dev-verificar.sh` ejecuta el criterio de éxito completo: `docker compose down -v && up --build -d` → `/api/health` ok (BD + Ollama) → corrida (`RUN_ON_START` + `POST /api/pipeline/run`) → BD con `llamados > 0`, `analisis_ia > 0`, ninguna confianza fuera de 0-100 → feedback por API → `/api/metricas` lo refleja.
- Resultado con la imagen final: RSS 1000 → 15 candidatos → 10 llamados → 13 análisis (3 PDF descubiertos en la IM), **0 errores**, 0 extracciones fallidas, 39,5 min. Tiempos por adjunto: 34-57 s los chicos, 110 s el PDF con OCR, 604-631 s los tres pliegos largos (6-7 fragmentos). Ollama volvió a reiniciarse por OOM una vez a mitad de un pliego largo y el reintero nuevo lo absorbió sin perder el análisis.
- Claude Code detuvo mis esperas en segundo plano por falta de memoria del host (swap lleno mientras corría `llama-server`); no afecta al sistema, solo a cómo se vigiló la corrida. Para la demo conviene tener ~6 GB libres (parar los stacks de Supabase si no se usan).
- `init: true` en el servicio `app` para recoger los procesos zombi de Chromium que deja cada scraping.

### 2026-10-09 · Fase 8 · limpieza y resumen final

**Qué se hizo.** N8N y los 1.239 líneas de bash quedaron reemplazados por un único servicio Node 22 + TypeScript en `app/` (scheduler con node-cron, pipeline, API Express 5 y dashboard), con PostgreSQL 16 al lado y Ollama en el host (o perfil `ollama` del compose). Borrados `src/` (n8n, processing, dashboard, scraper), `scripts/*` salvo `scripts/dev-verificar.sh`, y `database/` (migrado a `app/migrations`). Commits por fase en la rama `modernizacion` (sin push).

**Estado final verificado.** `docker compose down -v && docker compose up --build -d` → `/api/health` OK → corrida completa en 39,5 min: 1000 ítems de RSS, 15 candidatos, 10 llamados, 13 análisis con `qwen3.5:4b`, 0 errores → feedback y métricas funcionando. 61 tests unitarios verdes (`cd app && npm test`).

**Tiempos del pipeline (CPU, `qwen3.5:4b`, `num_ctx` 8192).** Ingesta (RSS + 15 scrapes): ~15 s. Por adjunto: 34-61 s para pliegos de 1,3-3,9 k caracteres; ~110 s para un PDF escaneado con OCR; 600-630 s para pliegos de 60-73 k caracteres (6-7 fragmentos + síntesis). Con `qwen3.5:9b` en este host (RAM al límite) la generación cae a 2 tok/s: solo conviene con ≥ 8 GB libres.

**Qué quedó pendiente / a decidir.**
- Proveedor Anthropic implementado pero sin probar contra la API real (no había credenciales en el host).
- La precisión de la IA se mide recién cuando haya feedback humano: hay que revisar llamados en el dashboard antes de la demo para que la card "Precisión IA" muestre un número.
- Casos discutibles del modelo (escalera de aluminio, mantenimiento edilicio) se pueden afinar editando los criterios en `app/rubros/aluminio.json` sin tocar código.
- Memoria del host: con los stacks de Supabase corriendo, Ollama se reinicia por OOM de vez en cuando (la app lo reintenta). Para la demo, liberar RAM o usar una máquina con GPU.
- Stretch de la Fase 9: segundo rubro de ejemplo sí; Telegram y "preguntale al pliego" no se hicieron (riesgo alto a días de la hackathon).

### 2026-10-09 · Fase 9 (stretch)
- `app/rubros/informatica.json` como segundo rubro: mismo formato, sin tocar código. Test `rubros.test.ts` verifica que todos los rubros del directorio cargan y que sus criterios llegan al prompt (63 tests en total).
- Telegram y "preguntale al pliego" quedan fuera a propósito.
