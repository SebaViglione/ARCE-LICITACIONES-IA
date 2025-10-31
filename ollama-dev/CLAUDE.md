# 🏗️ ARCE Licitaciones – CLAUDE.md (AI‑First Project Brain)

> **Propósito:** Proveer a **Claude Code** (o al motor IA seleccionado) el **contexto mínimo, vital y exacto** para operar este proyecto.  
> **Alcance:** **El análisis de pliegos y llamados es IA‑primero**. El **regex solo actúa como pre‑filtro** para descartar casos obvios. Todo criterio final de relevancia lo decide la **IA**.

---

## 1) TL;DR (qué es y para qué sirve)
- Monitoreo de **llamados/licencias** (ARCE / compras estatales).
- **Descarga de pliegos (PDF)** → **extracción de texto** → **clasificación IA** (relevancia para rubro **aluminio**).
- **Pre‑filtro rápido (regex)** solo para quitar falsos obvios (madera, PVC, herrería).  
- **Deduplicación** (no reprocesar) + **persistencia** (Postgres).  
- **Notificación** (Telegram) con **datos clave** y enlaces.

> Meta: priorizar IA para **recall** alto y **precisión** razonable, con feedback de usuario para mejorar.

---

## 2) Arquitectura lógica (pipeline)
1) **Ingesta** (RSS/HTML de ARCE) → URLs de llamados + links a pliegos (PDF).  
2) **Descarga & extracción** → PDF → **texto plano** (respetar saltos y páginas).  
3) **Pre‑filtro regex (rápido, opcional)** → descarta materiales no objetivo obvios.  
4) **IA de análisis (núcleo)** → clasificación y extracción **estructurada** (ver §3).  
5) **Deduplicación & persistencia** → guardar resultado y evitar reprocesos.  
6) **Notificación Telegram** → resumen + botones (abrir pliego, marcar interés, descartar).  
7) **Feedback loop** → si el usuario marca *interesa/no*, registrar para **re‑entrenar prompts** o ajustar umbrales.

**Motores IA soportados (elige uno):**
- **Ollama local** (e.g., `llama3.1:8b`) con **ModelFile** → ideal offline/costos.

---

## 3) Esquema de **salida IA** (JSON canónico)
La IA **DEBE** responder **solo JSON** con este formato (sin texto extra):

```json
{
  "es_relevante": true,
  "confianza": 0.0,
  "razon": "string corta",
  "materiales_detectados": ["aluminio", "DVH"],
  "descartar_por": [],
  "numero_llamado": "string|null",
  "titulo": "string|null",
  "fecha_apertura": "YYYY-MM-DD HH:MM|null",
  "fecha_visita": "YYYY-MM-DD HH:MM|null",
  "entidad": "string|null",
  "objeto": "string|null",
  "links": {"detalle": "url|null", "pliego": "url|null"},
  "items_clave": ["string", "string"],
  "valor_estimado": "string|null"
}
```

**Criterios principales IA (positivos):** aluminio, aberturas de aluminio, DVH, curtain wall, fachadas que impliquen arreglos de aberturas en aluminio.  
**Negativos fuertes (descarto)**: madera, PVC, herrería (salvo si conviven con aluminio **y** IA detecta aluminio como central).

**Reglas de robustez:**
- Si hay conflicto materiales **y** aluminio aparece central → `es_relevante=true` y anotar `descartar_por=[]` con explicación en `razon`.
- Tolerar OCR ruidoso (acentos, cortes de palabra).  
- Si no hay fecha explícita, devolver `null` y listar pistas en `items_clave`.

---

## 4) Chunking y límites de contexto (IA‑first)
- **No procesar PDFs completos** de una. Usar **chunks** (p. ej. 2–5 páginas) con **ventana deslizante** si es necesario.  
- Prioridad de secciones: portada/resumen, “Objeto”, “Especificaciones Técnicas”, “Pliego de condiciones”.  
- Si la **primera pasada** es ambigua (`confianza < 0.55`), analizar **chunk adicional** antes de decidir.  
- **Evitar duplicidad de texto** (no volver a enviar el mismo chunk).

---

## 5) Persistencia mínima (PostgreSQL)
Tabla sugerida (ajustar a tu esquema real):

```sql
CREATE TABLE IF NOT EXISTS llamados_procesados (
  id SERIAL PRIMARY KEY,
  numero_llamado VARCHAR(64) UNIQUE,
  titulo TEXT,
  entidad TEXT,
  fecha_publicacion TIMESTAMP NULL,
  fecha_apertura TIMESTAMP NULL,
  fecha_visita TIMESTAMP NULL,
  link_detalle TEXT,
  link_pliego TEXT,
  es_relevante BOOLEAN,
  confianza NUMERIC(3,2),
  razon TEXT,
  materiales_detectados TEXT[],
  items_clave TEXT[],
  valor_estimado TEXT,
  hash_contenido VARCHAR(64),
  texto_resumen TEXT,
  creado_en TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_llamados_creado_en ON llamados_procesados(creado_en);
```

**Deduplicación:** usar `numero_llamado` y/o `hash_contenido` (sha‑256 del texto o del link).

---

## 6) Notificación (Telegram)
**Mensaje:**  
- Encabezado: `#{numero_llamado} – {titulo}`  
- Cuerpo: entidad, **fecha_apertura**, **visita** (si hay), **razón IA** (1 línea), links.  
- **Botones:** `[✅ Me interesa] [❌ Descartar] [📎 Ver pliego]`  
- El **callback** de los botones debe registrar feedback y actualizar `es_relevante` o `razon` si aplica.

---

## 7) Configuración (variables críticas)
- `TZ=America/Montevideo` / `GENERIC_TIMEZONE=America/Montevideo`
- **DB (Postgres):** `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASS`
- **Telegram:** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (o routing por chat)
- **ARCE endpoints:** `ARCE_RSS_URL` y/o `ARCE_LIST_URL`
- **Modo IA:** `AI_ENGINE=claude|ollama`, `AI_MODEL=claude-sonnet-4.5|llama3.1:8b`
- (Dev only n8n HTTP) `N8N_SECURE_COOKIE=false`

**Seguridad:** no commitear tokens/credenciales; usar variables/secret manager; no exponer DB.

---

## 8) Reglas para **Claude** (cómo trabajar acá)
- **No hagas full-scan** del repo; trabaja **por archivos/tareas** y cita **chunks** relevantes.  
- **Primero IA**: si pedimos “clasificar pliego”, **usa el motor IA** con el **JSON canónico** (§3).  
- **Explica antes de editar**: resume intención (3–6 bullets) y luego proponé *diffs* pequeños.  
- **Ahorro de contexto**: respeta `.claudeignore`; evita repetir texto ya enviado.  
- **Seguridad ante todo**: no imprimas credenciales; no guardes PDFs descartados salvo auditoría controlada.

**Formato esperado de respuesta (cuando edites código/workflows):**
1) **Resumen** (qué vas a tocar y por qué).  
2) **Diffs** (bloques `diff`).  
3) **Checklist** de pruebas (pasos concretos en n8n/DB/Telegram).  
4) **Notas** (nuevas env vars o migraciones).

---

## 9) Operación (día a día)
- **Job programado** (n8n cron): cada mañana.  
- **Idempotencia**: consultar DB antes de analizar; saltar si ya existe.  
- **Fail‑safe**: si IA falla/parsing vacío → registrar con `es_relevante=null` y reintentar con otro chunk.  
- **Tuning continuo**: usar feedback de Telegram para ajustar prompts/umbrales (`confianza`).

---

## 10) Archivos a ignorar para Claude
Crear `.claudeignore` en la raíz:
```
.git/
node_modules/
venv/
*.log
*.zip
*.pdf
*.png
*.jpg
*.xlsx
*.csv
.env
.env.*
workflows/run-*.json
backups/
```

---

## 11) Snippets útiles
**Verificar puerto n8n (Fedora):**
```bash
sudo firewall-cmd --permanent --add-port=5678/tcp
sudo firewall-cmd --reload
ss -tulpn | grep 5678
```

**Dedup rápida (ejemplo):**
```sql
SELECT 1 FROM llamados_procesados WHERE numero_llamado = $1 LIMIT 1;
```

---

## 12) Créditos
Proyecto interno de monitoreo de licitaciones **IA‑primero** (rubro **aluminio**).  
Infra prevista: **Docker + n8n + Postgres**; motor de IA **Claude** u **Ollama**.
