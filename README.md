# ARCE Licitaciones IA

Monitor de licitaciones públicas de Uruguay (portal ARCE / Compras Estatales) para un rubro concreto, con análisis automático de los pliegos usando un modelo de lenguaje local y un dashboard para revisarlos.

Cada 15 minutos el sistema lee el RSS de publicaciones, filtra los llamados que podrían ser del rubro (por defecto aluminio, aberturas y vidrio), scrapea el detalle, descarga y convierte a texto los pliegos (PDF, Word, Excel, ZIP, HTML, OCR) y le pide a la IA un análisis estructurado: ¿es relevante y con qué confianza?, ¿qué hay que hacer?, ¿dónde?, ¿hay visita técnica obligatoria, cuándo y con quién coordinar?, ¿qué formularios hay que presentar? Un humano revisa en el dashboard y ese feedback mide la precisión de la IA.

Desde octubre de 2026 el proyecto tiene un segundo objetivo: **inteligencia de mercado sobre todo el histórico de ARCE**, de cualquier rubro: qué productos conviene vender, a qué precio se gana, quiénes son los competidores y quiénes compran. Un scraper externo (pendiente) manda los llamados históricos a una API de ingesta; el sistema los normaliza, las estadísticas salen solas en el tablero `/mercado` y la IA (el mismo proveedor del pipeline: Ollama local o la API de Anthropic) las lee y escribe el informe: qué atacar, a qué precio, contra quién, y responde preguntas libres citando los datos. El porqué del cambio está en [docs/portfolio/CAMBIO-DE-ENFOQUE.md](docs/portfolio/CAMBIO-DE-ENFOQUE.md) y la referencia técnica (contrato de ingesta, modelo, métricas) en [docs/MERCADO.md](docs/MERCADO.md).

Arquitectura y flujo detallado: [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md). Plan de modernización y bitácora: [docs/PLAN-MODERNIZACION.md](docs/PLAN-MODERNIZACION.md).

## Quick start

Requisitos: Docker con Compose v2 y [Ollama](https://ollama.com) corriendo en el host (o usar el perfil `ollama` del compose). Sin GPU alcanza; con 8 GB de RAM libres funciona el modelo por defecto.

```bash
cp .env.example .env            # 1. editar POSTGRES_PASSWORD como mínimo
ollama pull qwen3.5:4b          # 2. modelo por defecto (3,3 GB)
docker compose up --build -d    # 3. postgres + app; aplica migraciones y corre una vez al arrancar
xdg-open http://localhost:3000  # 4. dashboard
curl -X POST localhost:3000/api/pipeline/run   # 5. (opcional) disparar una corrida; o el botón "Actualizar ahora"
```

Seguir la corrida: `docker compose logs -f app`. Salud: `curl localhost:3000/api/health`. Verificación completa desde cero (levanta todo, corre el pipeline, chequea BD, feedback y métricas): `scripts/dev-verificar.sh`.

Sin Ollama en el host:

```bash
docker compose --profile ollama up -d
docker compose exec ollama ollama pull qwen3.5:4b
# y en .env: OLLAMA_HOST_DOCKER=http://ollama:11434
```

## Cómo funciona

```
RSS ARCE ─► filtro por keywords del rubro ─► scraper (Puppeteer) ─► PostgreSQL
                                                                        │
dashboard ◄── API Express ◄── analisis_ia ◄── LLM (Ollama / Anthropic) ◄── extracción de texto de los pliegos
```

- **Filtro**: palabra o frase completa, sin acentos ni mayúsculas, con lista de exclusiones; solo llamados con apertura futura. Luego, si el llamado tiene ítems y ninguno menciona el rubro, se descarta.
- **Extracción**: `pdftotext` (+ OCR con `tesseract` si el PDF es escaneado), `pandoc` (docx, rtf, odt, xls, xlsx, ods), `antiword` (doc), `unzip` (recursivo), HTML. Los pliegos de la Intendencia de Montevideo redirigen a otra página: se sigue la cadena hasta los PDF reales.
- **IA**: respuesta forzada a un JSON Schema (zod) con 15 campos; confianza 0-100; pliegos largos se analizan por fragmentos y se sintetizan; reglas de coherencia para la visita técnica; fallback por metadatos cuando no hay adjuntos extraíbles.
- **Métricas**: cada feedback humano guarda qué había dicho la IA; `/api/metricas` devuelve matriz de confusión, precisión, recall, F1 y conteos por modelo (duración y tokens promedio).

## Configuración (`.env`)

| Variable | Default | Para qué |
|---|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | — / — / `arce_licitaciones` | Base de datos |
| `POSTGRES_PORT` | `5433` | Puerto publicado en `127.0.0.1` para psql y desarrollo nativo |
| `PORT` | `3000` | Puerto del dashboard/API |
| `TZ` | `America/Montevideo` | Zona horaria del cron y de las fechas |
| `RUBRO` | `aluminio` | Archivo `app/rubros/<RUBRO>.json` |
| `CRON` / `CRON_ENABLED` | `*/15 * * * *` / `true` | Frecuencia del pipeline |
| `RUN_ON_START` | `true` | Corrida al arrancar el contenedor |
| `MAX_ANALISIS_POR_CORRIDA` | `50` | Tope de adjuntos analizados por corrida |
| `LLM_PROVIDER` | `ollama` | `ollama` o `anthropic` |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama visto desde la app nativa |
| `OLLAMA_HOST_DOCKER` | `http://host.docker.internal:11434` | Ollama visto desde el contenedor |
| `OLLAMA_MODEL` | `qwen3.5:4b` | Modelo local |
| `OLLAMA_NUM_CTX` | `8192` | Contexto; de él se deriva cuántos caracteres de pliego entran sin fragmentar (~3 por token) |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | — | Solo con `LLM_PROVIDER=anthropic` |
| `DATABASE_URL` | — | Solo para correr la app nativa |
| `INGESTA_TOKEN` | — | Token que manda el scraper del histórico (`Authorization: Bearer`). Vacío = ingesta deshabilitada |
| `INGESTA_MAX_MB` | `50` | Tamaño máximo de un lote de ingesta |
| `MERCADO_REFRESCO_CRON` / `MERCADO_REFRESCO_ENABLED` | `30 3 * * *` / `true` | Refresco nocturno de las estadísticas de mercado (además del que dispara cada lote) |
| `MERCADO_REFRESCO_DEBOUNCE_MS` | `60000` | Espera tras el último lote antes de recalcular |

## Cambiar de rubro

1. Copiar `app/rubros/aluminio.json` a `app/rubros/<nuevo>.json` y editar `descripcion`, `keywords`, `exclusiones`, `materiales_ejemplo` y los criterios de `relevancia` (son texto libre: van directo al prompt).
2. `RUBRO=<nuevo>` en `.env` y `docker compose up -d --build`.

Los análisis guardan el rubro con el que se hicieron; `/api/llamados?rubro=<nuevo>` filtra por él. Viene un segundo rubro de ejemplo, `informatica`, para probar el cambio (`RUBRO=informatica`).

## Cambiar de modelo o proveedor

- Otro modelo de Ollama: `OLLAMA_MODEL=qwen3.5:9b` (mejor, necesita ~8 GB libres) o `llama3.2:3b` (más rápido, se equivoca más). Si el pliego tarda más de ~3 minutos en CPU, bajar `OLLAMA_NUM_CTX`.
- Anthropic: `LLM_PROVIDER=anthropic`, `ANTHROPIC_API_KEY=sk-ant-...` y opcionalmente `ANTHROPIC_MODEL`. Misma interfaz y mismo JSON Schema (tool use).

## API

| Método y ruta | Qué hace |
|---|---|
| `GET /api/health` | BD y proveedor LLM (modelo descargado y cargado), estado del pipeline |
| `GET /api/llamados?estado=activo&rubro=&limit=200&offset=0` | Tarjetas del dashboard (vista + feedback) |
| `GET /api/llamados/:id` | Detalle: llamado, adjuntos, aclaraciones, ítems y todos sus análisis |
| `POST /api/feedback` | `{ llamado_id, es_relevante_real, estado_seguimiento, comentario }` (upsert) |
| `GET /api/metricas` | Precisión/recall/F1, matriz de confusión, totales, por modelo |
| `POST /api/pipeline/run` | Dispara una corrida (202; no espera). Body opcional `{ soloIngesta, soloAnalisis, limiteAnalisis }` |
| `GET /api/pipeline/estado` | Corrida en curso y últimas 10 corridas |
| `GET /api/rubros` | Rubro actual y disponibles |
| `GET /api/ingesta/esquema` | JSON Schema del contrato de ingesta del histórico |
| `POST /api/ingesta/llamados` · `/cotizaciones` · `/articulos` · `/proveedores` | Ingesta del histórico (token). Lotes de hasta 500 llamados con ítems, ofertas y adjudicaciones |
| `POST /api/ingesta/reprocesar` · `DELETE /api/ingesta/fuente/:fuente` · `GET /api/ingesta/lotes` | Reproceso desde los crudos, borrado por fuente, historial de lotes |
| `GET /api/mercado/resumen` · `/productos` · `/productos/:id` · `/proveedores` · `/proveedores/:id` · `/organismos` · `/categorias` · `/oportunidades` · `/buscar` | Estadísticas de mercado (ver [docs/MERCADO.md](docs/MERCADO.md)) |
| `GET /api/mercado/estado` · `POST /api/mercado/refrescar` | Estado y refresco de las vistas materializadas |
| `POST`/`GET /api/mercado/analisis` · `POST`/`GET /api/mercado/productos/:id/analisis` · `POST /api/mercado/preguntar` · `GET /api/mercado/preguntas` | El analista: informe del mercado, veredicto por producto y preguntas libres escritos por la IA a partir de las estadísticas (Ollama o Anthropic, según `LLM_PROVIDER`) |

## Desarrollo nativo

```bash
docker compose up postgres -d
cd app && npm install            # baja Chrome para Puppeteer
npm --prefix web install         # dependencias del dashboard (React)
npm run migrate
npm run pipeline:once -- --solo-ingesta      # RSS → filtro → scraper → BD
npm run pipeline:once -- --solo-analisis --limite=3
npm run build:web                # compila el dashboard en app/public (lo sirve Express)
npm run dev                      # API + dashboard + cron en http://localhost:3000
npm run dev:web                  # (opcional) Vite con recarga en caliente en http://localhost:5173, proxy a :3000
npm test                         # vitest: filtro, RSS, fechas, extracción, esquema IA, normalización y contrato de mercado
npm run test:db                  # además, la integración de mercado contra Postgres (crea una base temporal)
npm run mercado:demo             # tres años de compras SINTÉTICAS por la API de ingesta, para ver /mercado con datos
npm run mercado:demo -- --limpiar
```

El dashboard es una bandeja de triage (lista por plazo a la izquierda, ficha y decisión a la derecha) hecha con Vite + React 19 + Tailwind 4, componentes de [shadcn/ui](https://ui.shadcn.com) y animaciones de [React Bits](https://reactbits.dev). Vive en `app/web/` y se compila dentro de `app/public/`, que no se versiona: lo genera `npm run build` y la imagen Docker.

Para el OCR nativo hace falta `tesseract` con el idioma español; `pdftotext`, `pandoc`, `antiword` y `unzip` para el resto. Dentro de la imagen Docker ya están.

## Estructura

```
app/
  src/index.ts          arranque: migraciones, API, cron
  src/config.ts         variables de entorno validadas con zod
  src/pipeline/         run (orquestador), rss, filtro, scraper, descarga, extract, extract_im, analyze
  src/llm/              schema (zod + JSON Schema), prompts, ollama, anthropic
  src/api/              server (Express) y routes
  src/db/               pool, migrate, repos (SQL parametrizado)
  src/mercado/          histórico de ARCE: esquema (contrato zod), normalizar, ingesta, estadisticas, consultas, rutas, demo
  rubros/               configuración por rubro
  migrations/           SQL versionado (schema_migrations); 004_mercado.sql = esquema mercado y vistas materializadas
  web/                  dashboard React (Vite + shadcn/ui + React Bits); compila a public/. web/src/mercado = tablero de mercado
  test/                 vitest + fixtures (RSS real, PDF/DOCX/ZIP, HTML de la IM) + integración de mercado
docker-compose.yml      postgres + app (+ ollama con --profile ollama)
docs/                   ARQUITECTURA.md, PLAN-MODERNIZACION.md, MERCADO.md; portfolio/ (CAMBIO-DE-ENFOQUE.md + capturas del tablero)
```

## Licencia

Apache 2.0. Ver [LICENSE](LICENSE).
