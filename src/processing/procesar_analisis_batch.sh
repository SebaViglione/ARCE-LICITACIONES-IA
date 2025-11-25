#!/bin/sh

# ============================================
# Script para procesar TODOS los archivos pendientes de análisis IA
# Sin loops de N8N - Ejecución directa en sh
# ============================================

set -eu

# Configuración
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TMP_DIR="/tmp_arce"
EXTRACT_SCRIPT="$SCRIPT_DIR/extract_text.sh"
IM_EXTRACT_SCRIPT="$SCRIPT_DIR/extract_im_html.sh"
OLLAMA_URL="http://172.17.0.1:11434/api/generate"
OLLAMA_MODEL="llama3.1:8b"
DB_HOST="postgres"
DB_PORT="5432"
DB_NAME="n8n"
DB_USER="n8n"
DB_PASS="n8n_secure_password_2024"

# Configuración de chunking
MAX_CHARS=10000       # Límite antes de activar chunking
CHUNK_SIZE=8000       # Tamaño de cada fragmento
CHUNK_OVERLAP=1000    # Overlap entre chunks
DEBUG=false           # Activar para guardar JSONs debug

# Contadores
TOTAL=0
EXITOSOS=0
ERRORES=0

# Listas para resultados (compatibles con sh)
RESULTADOS_OK=""
RESULTADOS_ERROR=""

# Función para escapar strings en SQL
escape_sql() {
    echo "$1" | sed "s/'/''/g"
}

# Función para escapar JSON
escape_json() {
    echo "$1" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g'
}

# Función para log
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >&2
}

# ============================================
# FUNCIÓN PARA OBTENER CONTEXTO DEL LLAMADO
# ============================================

# Obtener aclaraciones e items del llamado desde la BD
obtener_contexto_llamado() {
    local id_llamado="$1"

    # Obtener aclaraciones
    ACLARACIONES_QUERY="SELECT COALESCE(texto, '') FROM aclaraciones WHERE id_llamado = '$id_llamado' ORDER BY fecha DESC, hora DESC;"
    ACLARACIONES_RAW=$(PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -A -c "$ACLARACIONES_QUERY" 2>/dev/null || echo "")

    # Obtener items del llamado
    ITEMS_QUERY="SELECT COALESCE(texto, '') FROM items_llamado WHERE id_llamado = '$id_llamado';"
    ITEMS_RAW=$(PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -A -c "$ITEMS_QUERY" 2>/dev/null || echo "")

    # Obtener descripción del llamado
    DESC_QUERY="SELECT COALESCE(descripcion, '') FROM llamados WHERE id = '$id_llamado';"
    DESC_RAW=$(PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -A -c "$DESC_QUERY" 2>/dev/null || echo "")

    # Formatear aclaraciones
    CONTEXTO_ACLARACIONES=""
    if [ -n "$ACLARACIONES_RAW" ]; then
        CONTEXTO_ACLARACIONES="

=== ACLARACIONES DEL LLAMADO ===
$ACLARACIONES_RAW"
    fi

    # Formatear items
    CONTEXTO_ITEMS=""
    if [ -n "$ITEMS_RAW" ]; then
        CONTEXTO_ITEMS="

=== ITEMS/PRODUCTOS SOLICITADOS ===
$ITEMS_RAW"
    fi

    # Formatear descripción
    CONTEXTO_DESC=""
    if [ -n "$DESC_RAW" ]; then
        CONTEXTO_DESC="

=== DESCRIPCIÓN DEL LLAMADO ===
$DESC_RAW"
    fi

    # Retornar contexto combinado
    echo "${CONTEXTO_DESC}${CONTEXTO_ITEMS}${CONTEXTO_ACLARACIONES}"
}

# ============================================
# FUNCIONES PARA CHUNKING
# ============================================

# Analizar un chunk individual
analizar_chunk() {
    chunk_texto="$1"
    chunk_index="$2"
    total_chunks="$3"

    PROMPT_CHUNK="Eres un analizador de licitaciones del rubro aluminio.

Este es el FRAGMENTO ${chunk_index} de ${total_chunks} de un pliego de licitación.

EXTRAE SOLO la información presente en ESTE fragmento:

1) MATERIALES mencionados:
   - Aluminio, DVH, vidrios, mamparas, barandas, fachadas, cerramientos, etc.

2) UBICACIÓN de la obra:
   - Dirección, ciudad, departamento, referencias geográficas

3) VISITA TÉCNICA - BUSCAR CON DETALLE:

   A) Patrones de visita obligatoria:
      - \"visita obligatoria\", \"visita previa obligatoria\"
      - \"visita técnica obligatoria\", \"se requiere visita\"
      - \"deberá realizar visita\", \"visita al lugar\", \"inspección previa\"

   B) Ubicación de la visita:
      - Dirección exacta, edificio, referencias
      - Busca en secciones: \"Visita Técnica\", \"Lugar de Visita\", \"Inspección\"

   C) Fecha y horario:
      - Fechas específicas: \"25 de noviembre\", \"2025-11-25\"
      - Horarios: \"de 10:00 a 16:00 hs\"

   D) Coordinación:
      - \"coordinar previamente\", \"comunicarse con\"
      - \"contactar para agendar\", \"solicitar visita\"

   E) Contactos:
      - Nombre de persona/departamento
      - Teléfono (con extensiones: \"+598 1825 int 01200\")
      - Correo electrónico
      - Busca en: \"Contacto\", \"Informes\", \"Coordinación\"

4) FORMULARIOS REQUERIDOS para presentación:
   - Nombre exacto del formulario (ej: \"Formulario A - Propuesta Económica\")
   - ¿Es obligatorio u opcional?
   - Ubicación en el pliego (ej: \"Anexo II\", \"Capítulo 5\")

   IMPORTANTE: Busca frases como:
   - \"deberá presentar\"
   - \"se adjunta formulario\"
   - \"completar anexo\"
   - \"declaración jurada\"
   - \"planilla de cotización\"

RESPONDE JSON con SOLO los campos que encuentres (omite los demás):
{
  \"materiales\": [\"aluminio\"],
  \"ubicacion_obra\": \"string o null\",
  \"requiere_visita\": true|false,
  \"ubicacion_visita\": \"string o null\",
  \"fecha_visita\": \"YYYY-MM-DD o null\",
  \"coordina_visita\": true|false,
  \"contacto_nombre\": \"string o null\",
  \"contacto_tel\": \"string o null\",
  \"contacto_mail\": \"string o null\",
  \"formularios\": [
    {\"nombre\": \"Formulario X\", \"obligatorio\": true, \"seccion\": \"Anexo 1\"}
  ]
}

Fragmento:
${chunk_texto}"

    OLLAMA_BODY=$(jq -n \
        --arg model "$OLLAMA_MODEL" \
        --arg prompt "$PROMPT_CHUNK" \
        '{
            model: $model,
            format: "json",
            temperature: 0,
            system: "Eres un analizador especializado en licitaciones. SOLO respondes con JSON válido.",
            prompt: $prompt,
            stream: false
        }')

    OLLAMA_RESPONSE=$(curl -s -X POST "$OLLAMA_URL" \
        -H "Content-Type: application/json" \
        -d "$OLLAMA_BODY" \
        --max-time 600 || echo "")

    echo "$OLLAMA_RESPONSE" | jq -r '.response // empty' 2>/dev/null || echo ""
}

# Sintetizar resultados de todos los chunks
sintetizar_chunks() {
    chunks_json="$1"
    titulo_llamado="$2"

    PROMPT_SINTESIS="Eres un analizador de licitaciones del rubro aluminio.

Tienes los siguientes fragmentos analizados del pliego \"${titulo_llamado}\".

Fragmentos:
${chunks_json}

COMBINA toda la información en el esquema JSON COMPLETO.

CRITERIOS DE RELEVANCIA Y CONFIANZA para empresa de aluminio:

RELEVANTE (es_relevante=true):
- Aluminio, aberturas, ventanas, puertas de aluminio, fachadas, barandas, cerramientos, DVH → confianza 80-95%
- Mamparas con estructura metálica, vidrios para cerramientos → confianza 70-85%

PARCIALMENTE RELEVANTE (es_relevante=true, pero menor confianza):
- Mamparas divisorias, vidrios templados sin aluminio, estructuras metálicas → confianza 50-70%

NO RELEVANTE (es_relevante=false):
- Solo vidrio sin estructura de aluminio (ej: limpieza de vidrios) → confianza 20-40%
- Mantenimiento sin provisión de materiales → confianza 15-35%
- Pintura, electricidad, plomería, limpieza, alimentos, sin relación con aluminio → confianza 0-20%

REGLA CLAVE: Si el llamado NO requiere provisión o instalación de aluminio/aberturas, es_relevante DEBE ser false.

DETECCIÓN DE VISITA OBLIGATORIA (CRÍTICO):
Busca estos patrones en CUALQUIER fragmento:
- \"visita obligatoria\"
- \"visita previa obligatoria\"
- \"visita técnica obligatoria\"
- \"se requiere visita\"
- \"deberá realizar visita\"
- \"visita al lugar\"
- \"inspección previa\"

Si encuentras alguno, requiere_visita DEBE ser true.

CUANDO requiere_visita=true, DEBES extraer TODA esta información:

A) UBICACIÓN DE LA VISITA:
   - Busca dirección exacta, edificio, referencias
   - Puede estar en secciones: \"Visita Técnica\", \"Lugar de Visita\", \"Inspección\", \"Ubicación\"
   - Si no hay dirección específica de visita, usa la ubicación de obra
   - SIEMPRE debe haber una ubicacion_visita si requiere_visita=true

B) COORDINACIÓN DE VISITA:
   - coordina_visita=true si dice: \"coordinar previamente\", \"comunicarse con\", \"contactar para agendar\", \"solicitar visita\"
   - coordina_visita=false si hay fecha/horario fijo establecido

C) FECHA Y HORARIO:
   - Busca fechas específicas (ej: \"25 de noviembre de 2025\", \"2025-11-25\")
   - Si NO hay fecha fija y debe coordinarse: fecha_visita_especifica=null
   - Si HAY fecha fija: fecha_visita_especifica=\"YYYY-MM-DD\"

D) CONTACTOS PARA VISITA:
   - Busca nombre de persona/departamento responsable
   - Teléfono (puede tener extensiones: \"+598 1825 int 01200\")
   - Correo electrónico
   - Estos contactos pueden estar en: \"Contacto\", \"Informes\", \"Coordinación\", al final del pliego

REGLA DE COHERENCIA:
- Si requiere_visita=true pero NO encuentras ubicacion_visita → Usa ubicacion_obra como ubicacion_visita
- Si requiere_visita=true y tienes contacto (tel/mail) pero NO fecha → coordina_visita=true
- Si requiere_visita=false → ubicacion_visita=null, fecha_visita_especifica=null, coordina_visita=false, contactos=null

REGLAS DE FORMATO:
1. descripcion_llamado: Resumen ESPECÍFICO y DESCRIPTIVO del llamado en ≤150 caracteres. DEBE incluir: tipo de trabajo + material principal + ubicación si la hay. Ejemplo: \"Provisión e instalación de ventanas de aluminio DVH para liceo en Salto\". NUNCA uses frases genéricas. NUNCA vacío.
2. resumen_trabajo: Describe DETALLADAMENTE qué trabajo hay que realizar: cantidades, especificaciones técnicas (vidrios, medidas, colores), plazos, lugar de instalación, requisitos especiales. Mínimo 2-3 oraciones. NUNCA vacío.
3. es_relevante: true o false (NUNCA null)
4. confianza: número entre 0 y 100 (NUNCA null)
5. requiere_visita: true o false (NUNCA null)
6. coordina_visita: true si debe coordinarse por teléfono/correo sin fecha fija, false si hay fecha o no requiere visita (NUNCA null)
7. fecha_visita_especifica: formato 2025-11-25 o null si debe coordinarse
8. razon: Explicación clara y específica de por qué es o no relevante, mencionando materiales encontrados. NUNCA vacío.
9. contacto_visita_correo: SOLO el email, sin URLs ni texto adicional.
10. materiales_detectados: SOLO los materiales que REALMENTE aparecen, no agregues genéricos.

ESQUEMA JSON (usa valores REALES del llamado, NUNCA copies estos ejemplos):
{
  \"descripcion_llamado\": \"[resumen ESPECÍFICO en ≤150 chars]\",
  \"es_relevante\": true,
  \"confianza\": 85,
  \"razon\": \"[explicación clara y específica]\",
  \"materiales_detectados\": [\"[solo materiales que aparecen]\"],
  \"resumen_trabajo\": \"[descripción DETALLADA del trabajo]\",
  \"ubicacion_obra\": \"[dirección del pliego o null]\",
  \"requiere_visita\": true,
  \"ubicacion_visita\": \"[dirección de visita del pliego o null]\",
  \"fecha_visita_especifica\": \"2025-11-25 o null\",
  \"coordina_visita\": true,
  \"contacto_visita_nombre\": \"[nombre del contacto o null]\",
  \"contacto_visita_telefono\": \"[teléfono del contacto o null]\",
  \"contacto_visita_correo\": \"[email del contacto o null]\",
  \"formularios_requeridos\": [
    {\"nombre\": \"[nombre del formulario]\", \"obligatorio\": true, \"seccion\": \"[ubicación en pliego]\"}
  ]
}

CRITERIOS ADICIONALES:
- Unifica materiales (elimina duplicados)
- Si varios fragmentos mencionan ubicación, consolida en una sola
- Lista TODOS los formularios encontrados SIN DUPLICAR
- NORMALIZA formularios: convierte a Title Case (ej: \"Anexo I\")"

    OLLAMA_BODY=$(jq -n \
        --arg model "$OLLAMA_MODEL" \
        --arg prompt "$PROMPT_SINTESIS" \
        '{
            model: $model,
            format: "json",
            temperature: 0,
            system: "Eres un analizador especializado en licitaciones. SOLO respondes con JSON válido.",
            prompt: $prompt,
            stream: false
        }')

    OLLAMA_RESPONSE=$(curl -s -X POST "$OLLAMA_URL" \
        -H "Content-Type: application/json" \
        -d "$OLLAMA_BODY" \
        --max-time 600 || echo "")

    echo "$OLLAMA_RESPONSE" | jq -r '.response // empty' 2>/dev/null || echo ""
}

log "========================================"
log "Iniciando procesamiento batch de análisis IA"
log "========================================"

# ============================================
# 1) OBTENER ARCHIVOS PENDIENTES DE ANALIZAR
# ============================================
log "Consultando archivos pendientes..."

QUERY="
SELECT
  aa.llamado_id,
  aa.nombre AS archivo_analizado,
  aa.tipo,
  aa.archivo_url,
  l.titulo,
  l.fecha_apertura
FROM archivos_adjuntos AS aa
INNER JOIN llamados AS l
  ON aa.llamado_id = l.id
LEFT JOIN analisis_ia AS ai
  ON ai.llamado_id = aa.llamado_id
  AND ai.archivo_analizado = aa.nombre
WHERE
  ai.id IS NULL
  AND l.estado = 'activo'
  AND (
    aa.tipo IN ('pdf','doc','docx','rtf','txt','xlsx','xls','zip','rar')
    OR aa.nombre ILIKE '%.odt'
    OR aa.nombre ILIKE '%.ods'
    OR aa.nombre ILIKE '%.txt'
    OR aa.nombre ILIKE '%.html'
  )
  AND aa.archivo_url IS NOT NULL
ORDER BY
  l.fecha_apertura ASC,
  aa.llamado_id ASC
LIMIT 50;
"

# Ejecutar query y guardar en archivo temporal
ARCHIVOS_JSON=$(PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -A -F'|' -c "$QUERY")

if [ -z "$ARCHIVOS_JSON" ]; then
    log "✓ No hay archivos pendientes para analizar"
    echo '{"mensaje":"No hay archivos pendientes","total":0,"exitosos":0,"errores":0}'
    exit 0
fi

# Contar archivos
TOTAL=$(echo "$ARCHIVOS_JSON" | wc -l)
log "✓ Encontrados $TOTAL archivos para procesar"

# ============================================
# 2) PROCESAR CADA ARCHIVO
# ============================================
INDEX=0

while IFS='|' read -r llamado_id archivo_analizado tipo archivo_url titulo fecha_apertura; do
    INDEX=$((INDEX + 1))
    log ""
    log "[$INDEX/$TOTAL] Procesando: $archivo_analizado (llamado $llamado_id)"

    # Variables para este archivo
    EXITO=false
    ERROR_MSG=""
    TEXTO_EXTRAIDO=""

    # ========================================
    # 2.1) DESCARGAR ARCHIVO
    # ========================================
    log "  → Descargando archivo..."

    if wget -q --timeout=60 \
        --header="Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" \
        --header="Accept-Language: es-UY,es;q=0.9,en;q=0.8" \
        --header="Referer: https://www.comprasestatales.gub.uy/" \
        --user-agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0" \
        -O "$TMP_DIR/$archivo_analizado" \
        "$archivo_url"; then

        log "  ✓ Archivo descargado"

        # Verificar que el archivo existe y tiene contenido
        if [ ! -f "$TMP_DIR/$archivo_analizado" ]; then
            ERROR_MSG="Archivo no existe después de la descarga"
            log "  ✗ $ERROR_MSG"
            log "  [DEBUG] Ruta esperada: $TMP_DIR/$archivo_analizado"
        elif [ ! -s "$TMP_DIR/$archivo_analizado" ]; then
            ERROR_MSG="Archivo descargado está vacío (0 bytes)"
            log "  ✗ $ERROR_MSG"
            log "  [DEBUG] Tamaño: $(ls -lh "$TMP_DIR/$archivo_analizado" 2>&1 || echo 'N/A')"
        else
            FILE_SIZE=$(stat -f%z "$TMP_DIR/$archivo_analizado" 2>/dev/null || stat -c%s "$TMP_DIR/$archivo_analizado" 2>/dev/null || echo "0")
            log "  [DEBUG] Archivo descargado: $FILE_SIZE bytes"

            # ========================================
            # 2.2) EXTRAER TEXTO
            # ========================================

            # Verificar si es un archivo HTML de Intendencia de Montevideo
            if echo "$archivo_analizado" | grep -qi '\.html$'; then
                log "  → Procesando HTML de Intendencia de Montevideo..."

                if EXTRACT_OUTPUT=$(sh "$IM_EXTRACT_SCRIPT" "$TMP_DIR/$archivo_analizado" "$llamado_id" 2>&1); then
                    log "  ✓ HTML de IM procesado"

                    # Limpiar caracteres de control
                    EXTRACT_CLEAN=$(echo "$EXTRACT_OUTPUT" | tr -d '\000-\037' | tr -d '\177')

                    # Parsear salida JSON
                    TEXTO_EXTRAIDO=$(echo "$EXTRACT_CLEAN" | jq -r '.texto_extraido // empty')

                    # Insertar items en items_llamado
                    ITEMS_COUNT=$(echo "$EXTRACT_CLEAN" | jq -r '.items | length')
                    if [ "$ITEMS_COUNT" -gt 0 ]; then
                        log "  → Insertando $ITEMS_COUNT items..."

                        # Guardar items en archivo temporal para evitar subshell con pipe
                        TMP_ITEMS_FILE="/tmp/items_insert_$$"
                        echo "$EXTRACT_CLEAN" | jq -r '.items[].texto' > "$TMP_ITEMS_FILE"

                        ITEMS_INSERTED=0
                        while IFS= read -r item_texto; do
                            if [ -n "$item_texto" ]; then
                                item_escaped=$(escape_sql "$item_texto")
                                INSERT_ERROR=$(PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c \
                                    "INSERT INTO items_llamado (id_llamado, texto) VALUES ('$llamado_id', '$item_escaped');" 2>&1)
                                if [ $? -eq 0 ]; then
                                    ITEMS_INSERTED=$((ITEMS_INSERTED + 1))
                                else
                                    log "    ⚠ Error insertando item: $item_texto"
                                    log "    ⚠ SQL: $INSERT_ERROR"
                                fi
                            fi
                        done < "$TMP_ITEMS_FILE"

                        rm -f "$TMP_ITEMS_FILE"
                        log "  ✓ Items insertados ($ITEMS_INSERTED de $ITEMS_COUNT)"
                    fi

                    # Insertar adjuntos en archivos_adjuntos
                    ADJUNTOS_COUNT=$(echo "$EXTRACT_CLEAN" | jq -r '.adjuntos | length')
                    if [ "$ADJUNTOS_COUNT" -gt 0 ]; then
                        log "  → Insertando $ADJUNTOS_COUNT adjuntos..."
                        echo "$EXTRACT_CLEAN" | jq -c '.adjuntos[]' | while IFS= read -r adjunto; do
                            adj_nombre=$(echo "$adjunto" | jq -r '.nombre')
                            adj_tipo=$(echo "$adjunto" | jq -r '.tipo')
                            adj_url=$(echo "$adjunto" | jq -r '.archivo_url')
                            adj_label=$(echo "$adjunto" | jq -r '.label')

                            adj_nombre_esc=$(escape_sql "$adj_nombre")
                            adj_label_esc=$(escape_sql "$adj_label")

                            PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c \
                                "INSERT INTO archivos_adjuntos (llamado_id, nombre, tipo, archivo_url, label)
                                 VALUES ('$llamado_id', '$adj_nombre_esc', '$adj_tipo', '$adj_url', '$adj_label_esc')
                                 ON CONFLICT (llamado_id, archivo_url) DO NOTHING;" \
                                > /dev/null 2>&1 || true
                        done
                        log "  ✓ Adjuntos insertados"
                    fi

                    if [ -z "$TEXTO_EXTRAIDO" ]; then
                        ERROR_MSG="extract_im_html.sh no retornó texto"
                        log "  ✗ $ERROR_MSG"
                    fi
                else
                    ERROR_MSG="Error procesando HTML de IM"
                    log "  ✗ $ERROR_MSG"
                fi
            else
                # Archivo normal (PDF, etc.)
                log "  → Extrayendo texto..."

                # Capturar stdout y stderr por separado para debugging
                EXTRACT_OUTPUT=$(sh "$EXTRACT_SCRIPT" "$archivo_analizado" "$llamado_id" 2>&1)
                EXTRACT_EXITCODE=$?

                log "  [DEBUG] Extract exit code: $EXTRACT_EXITCODE"
                log "  [DEBUG] Extract output length: $(echo "$EXTRACT_OUTPUT" | wc -c)"

                if [ "$EXTRACT_EXITCODE" -eq 0 ]; then
                    log "  ✓ Texto extraído (exit code 0)"

                    # Limpiar caracteres de control antes de parsear con jq
                    EXTRACT_CLEAN=$(echo "$EXTRACT_OUTPUT" | tr -d '\000-\037' | tr -d '\177')

                    # DEBUG: Guardar output raw
                    if [ "$DEBUG" = "true" ]; then
                        echo "$EXTRACT_CLEAN" > "/tmp/debug_extract_${llamado_id}.json"
                        log "  [DEBUG] Guardado en /tmp/debug_extract_${llamado_id}.json"
                    fi

                    # Parsear salida JSON del script
                    TEXTO_EXTRAIDO=$(echo "$EXTRACT_CLEAN" | jq -r '.texto_extraido // empty' 2>&1)

                    log "  [DEBUG] texto_extraido length: $(echo "$TEXTO_EXTRAIDO" | wc -c)"

                    if [ -z "$TEXTO_EXTRAIDO" ]; then
                        ERROR_MSG="extract_text.sh no retornó texto"
                        log "  ✗ $ERROR_MSG"
                        log "  [DEBUG] JSON output: $(echo "$EXTRACT_CLEAN" | head -c 500)"
                    fi
                else
                    ERROR_MSG="Error extrayendo texto (exit code: $EXTRACT_EXITCODE)"
                    log "  ✗ $ERROR_MSG"
                    log "  [DEBUG] Error output: $(echo "$EXTRACT_OUTPUT" | head -c 500)"
                fi
            fi
        fi

        # ========================================
        # 2.3) ANÁLISIS CON IA (si hay texto)
        # ========================================
        if [ -n "$TEXTO_EXTRAIDO" ]; then
            # Obtener contexto completo del llamado
            log "  → Obteniendo contexto del llamado (aclaraciones, items)..."
            CONTEXTO_LLAMADO=$(obtener_contexto_llamado "$llamado_id")

            # Combinar texto extraído con contexto
            TEXTO_COMPLETO="=== TÍTULO DEL LLAMADO ===
$titulo

=== CONTENIDO DEL ARCHIVO: $archivo_analizado ===
$TEXTO_EXTRAIDO
$CONTEXTO_LLAMADO"

            # ========================================
            # 2.4) LLAMAR A OLLAMA (con chunking si es necesario)
            # ========================================
            TEXTO_LENGTH=$(echo "$TEXTO_COMPLETO" | wc -c)

            if [ "$TEXTO_LENGTH" -le "$MAX_CHARS" ]; then
                # CASO 1: Documento pequeño - análisis directo
                log "  → Analizando con IA (documento completo: $TEXTO_LENGTH chars)..."

                PROMPT="Analiza este llamado de licitación y extrae información estructurada.

IMPORTANTE - ANALIZA TODAS LAS FUENTES POR IGUAL:
Debes analizar con la MISMA importancia:
1. El TÍTULO del llamado (contiene info clave como \"visita obligatoria\", tipo de obra, etc.)
2. La DESCRIPCIÓN del llamado
3. El contenido del ARCHIVO ADJUNTO (pliego/PDF)
4. Los ITEMS/PRODUCTOS solicitados
5. Las ACLARACIONES oficiales

NO bases tu análisis solo en el PDF. El título y descripción pueden tener información crítica.

CRITERIOS DE RELEVANCIA Y CONFIANZA para empresa de aluminio:

RELEVANTE (es_relevante=true):
- Aluminio, aberturas, ventanas, puertas de aluminio, fachadas, barandas, cerramientos, DVH → confianza 80-95%
- Mamparas con estructura metálica, vidrios para cerramientos → confianza 70-85%

PARCIALMENTE RELEVANTE (es_relevante=true, pero menor confianza):
- Mamparas divisorias, vidrios templados sin aluminio, estructuras metálicas → confianza 50-70%

NO RELEVANTE (es_relevante=false):
- Solo vidrio sin estructura de aluminio (ej: limpieza de vidrios) → confianza 20-40%
- Mantenimiento sin provisión de materiales → confianza 15-35%
- Pintura, electricidad, plomería, limpieza, alimentos, sin relación con aluminio → confianza 0-20%

REGLA CLAVE: Si el llamado NO requiere provisión o instalación de aluminio/aberturas, es_relevante DEBE ser false.

DETECCIÓN DE VISITA OBLIGATORIA (CRÍTICO):
Busca estos patrones en CUALQUIER parte del contenido (título, descripción, pliego):
- \"visita obligatoria\"
- \"visita previa obligatoria\"
- \"visita técnica obligatoria\"
- \"se requiere visita\"
- \"deberá realizar visita\"
- \"visita al lugar\"
- \"inspección previa\"

Si encuentras alguno, requiere_visita DEBE ser true.

CUANDO requiere_visita=true, DEBES extraer TODA esta información:

A) UBICACIÓN DE LA VISITA:
   - Busca dirección exacta, edificio, referencias
   - Puede estar en secciones: \"Visita Técnica\", \"Lugar de Visita\", \"Inspección\", \"Ubicación\"
   - Si no hay dirección específica de visita, usa la ubicación de obra
   - SIEMPRE debe haber una ubicacion_visita si requiere_visita=true

B) COORDINACIÓN DE VISITA:
   - coordina_visita=true si dice: \"coordinar previamente\", \"comunicarse con\", \"contactar para agendar\", \"solicitar visita\"
   - coordina_visita=false si hay fecha/horario fijo establecido

C) FECHA Y HORARIO:
   - Busca fechas específicas (ej: \"25 de noviembre de 2025\", \"2025-11-25\")
   - Si NO hay fecha fija y debe coordinarse: fecha_visita_especifica=null
   - Si HAY fecha fija: fecha_visita_especifica=\"YYYY-MM-DD\"

D) CONTACTOS PARA VISITA:
   - Busca nombre de persona/departamento responsable
   - Teléfono (puede tener extensiones: \"+598 1825 int 01200\")
   - Correo electrónico
   - Estos contactos pueden estar en: \"Contacto\", \"Informes\", \"Coordinación\", al final del pliego

REGLA DE COHERENCIA:
- Si requiere_visita=true pero NO encuentras ubicacion_visita → Usa ubicacion_obra como ubicacion_visita
- Si requiere_visita=true y tienes contacto (tel/mail) pero NO fecha → coordina_visita=true
- Si requiere_visita=false → ubicacion_visita=null, fecha_visita_especifica=null, coordina_visita=false, contactos=null

REGLAS DE FORMATO:
1. descripcion_llamado: Resumen ESPECÍFICO y DESCRIPTIVO del llamado en ≤150 caracteres. DEBE incluir: tipo de trabajo + material principal + ubicación si la hay. Ejemplo: \"Provisión e instalación de ventanas de aluminio DVH para liceo en Salto\". NUNCA uses frases genéricas como \"Licitación para...\" o \"Adquisición de materiales\". NUNCA vacío.
2. resumen_trabajo: Describe DETALLADAMENTE qué trabajo hay que realizar, incluyendo: cantidades aproximadas si se mencionan, especificaciones técnicas (tipos de vidrio, medidas, colores), plazos de entrega, lugar de instalación, y cualquier requisito especial. Mínimo 2-3 oraciones completas. NUNCA vacío.
3. es_relevante: true o false (NUNCA null)
4. confianza: número entre 0 y 100 (NUNCA null)
5. requiere_visita: true o false (NUNCA null)
6. ubicacion_visita: Si requiere_visita=true, DEBE tener valor (dirección). Si requiere_visita=false, DEBE ser null.
7. coordina_visita: true si debe coordinarse por teléfono/correo sin fecha fija, false si hay fecha específica o no requiere visita (NUNCA null)
8. fecha_visita_especifica: formato 2025-11-25 o null si debe coordinarse o no requiere visita
9. contacto_visita_*: Si requiere_visita=true Y coordina_visita=true, DEBEN tener valores. Si no requiere visita, todos null.
10. razon: Explicación clara y específica de por qué es o no relevante, mencionando los materiales encontrados o la ausencia de ellos. NUNCA vacío.
11. contacto_visita_correo: SOLO el email (ej: \"contacto@ejemplo.gub.uy\"), sin URLs ni texto adicional.
12. materiales_detectados: SOLO los materiales que REALMENTE aparecen en el llamado, no agregues materiales genéricos.

ESQUEMA JSON (usa valores REALES del llamado, NUNCA copies estos ejemplos):
{
  \"descripcion_llamado\": \"[resumen del llamado en ≤150 chars]\",
  \"es_relevante\": true,
  \"confianza\": 85,
  \"razon\": \"[explicación clara de por qué es o no relevante]\",
  \"materiales_detectados\": [\"[solo materiales que aparecen en el llamado]\"],
  \"resumen_trabajo\": \"[descripción del trabajo a realizar]\",
  \"ubicacion_obra\": \"[dirección del pliego o null]\",
  \"requiere_visita\": true,
  \"ubicacion_visita\": \"[dirección de visita del pliego o null]\",
  \"fecha_visita_especifica\": \"2025-11-25 o null\",
  \"coordina_visita\": true,
  \"contacto_visita_nombre\": \"[nombre del contacto o null]\",
  \"contacto_visita_telefono\": \"[teléfono del contacto o null]\",
  \"contacto_visita_correo\": \"[email del contacto o null]\",
  \"formularios_requeridos\": [
    {\"nombre\": \"[nombre del formulario]\", \"obligatorio\": true, \"seccion\": \"[ubicación en pliego]\"}
  ]
}

Contenido completo del llamado:
$TEXTO_COMPLETO"

                OLLAMA_BODY=$(jq -n \
                    --arg model "$OLLAMA_MODEL" \
                    --arg prompt "$PROMPT" \
                    '{
                        model: $model,
                        format: "json",
                        temperature: 0,
                        system: "Eres un analizador especializado en licitaciones del rubro aluminio. SOLO respondes con JSON válido.",
                        prompt: $prompt,
                        stream: false
                    }')

                OLLAMA_RESPONSE=$(curl -s -X POST "$OLLAMA_URL" \
                    -H "Content-Type: application/json" \
                    -d "$OLLAMA_BODY" \
                    --max-time 600 || echo "")

                OLLAMA_JSON=$(echo "$OLLAMA_RESPONSE" | jq -r '.response // empty' 2>/dev/null || echo "")

            else
                # CASO 2: Documento grande - análisis por chunks
                # Calcular número real de chunks considerando overlap
                EFFECTIVE_CHUNK_SIZE=$((CHUNK_SIZE - CHUNK_OVERLAP))
                NUM_CHUNKS=$(( (TEXTO_LENGTH - CHUNK_SIZE + EFFECTIVE_CHUNK_SIZE - 1) / EFFECTIVE_CHUNK_SIZE + 1 ))

                log "  → Documento grande detectado ($TEXTO_LENGTH chars)"
                log "  → Procesando en chunks (estimado: ~$NUM_CHUNKS)..."

                CHUNKS_RESULTADOS=""
                CHUNK_INDEX=0
                OFFSET=0

                while [ "$OFFSET" -lt "$TEXTO_LENGTH" ]; do
                    CHUNK_INDEX=$((CHUNK_INDEX + 1))
                    CHUNK_TEXTO=$(echo "$TEXTO_COMPLETO" | tail -c +$((OFFSET + 1)) | head -c "$CHUNK_SIZE")

                    log "  → Analizando chunk $CHUNK_INDEX..."

                    CHUNK_JSON=$(analizar_chunk "$CHUNK_TEXTO" "$CHUNK_INDEX" "?")

                    if [ -n "$CHUNK_JSON" ]; then
                        if [ -z "$CHUNKS_RESULTADOS" ]; then
                            CHUNKS_RESULTADOS="$CHUNK_JSON"
                        else
                            CHUNKS_RESULTADOS="$CHUNKS_RESULTADOS,
$CHUNK_JSON"
                        fi

                        # DEBUG: Guardar chunk si está activado
                        if [ "$DEBUG" = "true" ]; then
                            echo "$CHUNK_JSON" > "/tmp/debug_chunk_${llamado_id}_${CHUNK_INDEX}.json"
                        fi
                    fi

                    OFFSET=$((OFFSET + CHUNK_SIZE - CHUNK_OVERLAP))
                done

                log "  → Sintetizando análisis final..."
                OLLAMA_JSON=$(sintetizar_chunks "[$CHUNKS_RESULTADOS]" "$titulo")
            fi

            # Validar que obtuvimos respuesta
            if [ -z "$OLLAMA_JSON" ]; then
                ERROR_MSG="Ollama no retornó respuesta válida"
                log "  ✗ $ERROR_MSG"
            else
                log "  ✓ Análisis completado"

                # Parsear campos del JSON de Ollama
                descripcion=$(echo "$OLLAMA_JSON" | jq -r '.descripcion_llamado // null')
                es_relevante=$(echo "$OLLAMA_JSON" | jq -r '.es_relevante // null')
                confianza=$(echo "$OLLAMA_JSON" | jq -r '.confianza // null')
                razon=$(echo "$OLLAMA_JSON" | jq -r '.razon // null')
                materiales=$(echo "$OLLAMA_JSON" | jq -c '.materiales_detectados // []')
                resumen=$(echo "$OLLAMA_JSON" | jq -r '.resumen_trabajo // null')
                ubicacion_obra=$(echo "$OLLAMA_JSON" | jq -r '.ubicacion_obra // null')
                requiere_visita=$(echo "$OLLAMA_JSON" | jq -r '.requiere_visita // null')
                ubicacion_visita=$(echo "$OLLAMA_JSON" | jq -r '.ubicacion_visita // null')
                fecha_visita=$(echo "$OLLAMA_JSON" | jq -r '.fecha_visita_especifica // null')
                coordina_visita=$(echo "$OLLAMA_JSON" | jq -r '.coordina_visita // null')
                contacto_nombre=$(echo "$OLLAMA_JSON" | jq -r '.contacto_visita_nombre // null')
                contacto_tel=$(echo "$OLLAMA_JSON" | jq -r '.contacto_visita_telefono // null')
                contacto_mail=$(echo "$OLLAMA_JSON" | jq -r '.contacto_visita_correo // null')
                formularios_json=$(echo "$OLLAMA_JSON" | jq -c '.formularios_requeridos // []')

                # ========================================
                # POST-PROCESAMIENTO: Normalizar valores
                # ========================================

                # Fix 1: Inferir es_relevante de confianza si es null
                if [ "$es_relevante" = "null" ] || [ -z "$es_relevante" ]; then
                    # Asegurar que confianza sea un número
                    if [ "$confianza" = "null" ] || [ -z "$confianza" ]; then
                        confianza=0
                    fi
                    # Inferir: >= 50 es relevante, < 50 no es relevante
                    if [ "$confianza" -ge 50 ] 2>/dev/null; then
                        es_relevante="true"
                    else
                        es_relevante="false"
                    fi
                fi

                # Fix 2: Normalizar requiere_visita si es null
                if [ "$requiere_visita" = "null" ] || [ -z "$requiere_visita" ]; then
                    requiere_visita="false"
                fi

                # Fix 3: Normalizar coordina_visita si es null
                if [ "$coordina_visita" = "null" ] || [ -z "$coordina_visita" ]; then
                    coordina_visita="false"
                fi

                # Fix 4: Limpiar fecha_visita de comillas extras y normalizar
                # Quitar comillas simples extras: '2025-11-25' -> 2025-11-25
                fecha_visita=$(echo "$fecha_visita" | sed "s/^'//; s/'$//")
                # Normalizar variantes de null
                if [ "$fecha_visita" = "null" ] || [ "$fecha_visita" = "NULL" ] || [ -z "$fecha_visita" ]; then
                    fecha_visita="null"
                fi
                # Guardar valor limpio para JSON (antes de agregar comillas SQL)
                fecha_visita_json="$fecha_visita"

                # ========================================
                # POST-PROCESAMIENTO: Validar coherencia de VISITA
                # ========================================

                # REGLA 1: Si requiere_visita=true pero ubicacion_visita está vacía
                # → Usar ubicacion_obra como fallback
                if [ "$requiere_visita" = "true" ]; then
                    if [ "$ubicacion_visita" = "null" ] || [ -z "$ubicacion_visita" ]; then
                        if [ "$ubicacion_obra" != "null" ] && [ -n "$ubicacion_obra" ]; then
                            log "  [POST-PROC] ubicacion_visita vacía, usando ubicacion_obra"
                            ubicacion_visita="$ubicacion_obra"
                        else
                            log "  [WARN] requiere_visita=true pero no hay ubicación"
                        fi
                    fi

                    # REGLA 2: Si tiene contactos pero no tiene fecha_visita
                    # → Inferir que debe coordinarse
                    if [ "$fecha_visita" = "null" ] || [ -z "$fecha_visita" ]; then
                        if [ "$contacto_tel" != "null" ] || [ "$contacto_mail" != "null" ]; then
                            if [ "$coordina_visita" != "true" ]; then
                                log "  [POST-PROC] Tiene contactos sin fecha → coordina_visita=true"
                                coordina_visita="true"
                            fi
                        fi
                    fi

                    # REGLA 3: Si tiene fecha específica, no debe coordinar
                    if [ "$fecha_visita" != "null" ] && [ -n "$fecha_visita" ]; then
                        if [ "$coordina_visita" = "true" ]; then
                            log "  [POST-PROC] Tiene fecha específica → coordina_visita=false"
                            coordina_visita="false"
                        fi
                    fi
                else
                    # REGLA 4: Si NO requiere visita, limpiar todos los campos de visita
                    if [ "$ubicacion_visita" != "null" ] || [ "$fecha_visita" != "null" ] || [ "$coordina_visita" = "true" ]; then
                        log "  [POST-PROC] requiere_visita=false → Limpiando datos de visita"
                        ubicacion_visita="null"
                        fecha_visita="null"
                        fecha_visita_json="null"
                        coordina_visita="false"
                        contacto_nombre="null"
                        contacto_tel="null"
                        contacto_mail="null"
                    fi
                fi

                # ========================================
                # 2.5) INSERTAR EN BD
                # ========================================
                log "  → Guardando en base de datos..."

                # Preparar valores escapados
                llamado_id_esc=$(escape_sql "$llamado_id")
                archivo_esc=$(escape_sql "$archivo_analizado")
                desc_esc=$(escape_sql "$descripcion")
                razon_esc=$(escape_sql "$razon")
                materiales_esc=$(escape_sql "$materiales")
                resumen_esc=$(escape_sql "$resumen")
                ubicacion_obra_esc=$(escape_sql "$ubicacion_obra")
                ubicacion_visita_esc=$(escape_sql "$ubicacion_visita")
                contacto_nombre_esc=$(escape_sql "$contacto_nombre")
                contacto_tel_esc=$(escape_sql "$contacto_tel")
                contacto_mail_esc=$(escape_sql "$contacto_mail")

                # Convertir nulls de jq a NULL de SQL
                [ "$descripcion" = "null" ] && desc_esc="NULL" || desc_esc="'$desc_esc'"
                [ "$razon" = "null" ] && razon_esc="NULL" || razon_esc="'$razon_esc'"
                [ "$resumen" = "null" ] && resumen_esc="NULL" || resumen_esc="'$resumen_esc'"
                [ "$ubicacion_obra" = "null" ] && ubicacion_obra_esc="NULL" || ubicacion_obra_esc="'$ubicacion_obra_esc'"
                [ "$ubicacion_visita" = "null" ] && ubicacion_visita_esc="NULL" || ubicacion_visita_esc="'$ubicacion_visita_esc'"
                [ "$fecha_visita" = "null" ] && fecha_visita="NULL" || fecha_visita="'$fecha_visita'"
                [ "$contacto_nombre" = "null" ] && contacto_nombre_esc="NULL" || contacto_nombre_esc="'$contacto_nombre_esc'"
                [ "$contacto_tel" = "null" ] && contacto_tel_esc="NULL" || contacto_tel_esc="'$contacto_tel_esc'"
                [ "$contacto_mail" = "null" ] && contacto_mail_esc="NULL" || contacto_mail_esc="'$contacto_mail_esc'"

                # Escapar JSON de formularios para SQL
                formularios_esc=$(escape_sql "$formularios_json")

                INSERT_QUERY="
INSERT INTO analisis_ia (
  llamado_id, archivo_analizado,
  descripcion_llamado, es_relevante, confianza, razon,
  materiales_detectados, resumen_trabajo,
  ubicacion_obra, requiere_visita, ubicacion_visita,
  fecha_visita_especifica, coordina_visita,
  contacto_visita_nombre, contacto_visita_telefono, contacto_visita_correo,
  formularios_requeridos,
  analizado_en
)
VALUES (
  '$llamado_id_esc',
  '$archivo_esc',
  $desc_esc,
  $es_relevante,
  $confianza,
  $razon_esc,
  '$materiales_esc'::jsonb,
  $resumen_esc,
  $ubicacion_obra_esc,
  $requiere_visita,
  $ubicacion_visita_esc,
  $fecha_visita,
  $coordina_visita,
  $contacto_nombre_esc,
  $contacto_tel_esc,
  $contacto_mail_esc,
  '$formularios_esc'::jsonb,
  NOW()
)
ON CONFLICT (llamado_id, archivo_analizado)
DO UPDATE SET
  descripcion_llamado = EXCLUDED.descripcion_llamado,
  es_relevante = EXCLUDED.es_relevante,
  confianza = EXCLUDED.confianza,
  razon = EXCLUDED.razon,
  materiales_detectados = EXCLUDED.materiales_detectados,
  resumen_trabajo = EXCLUDED.resumen_trabajo,
  ubicacion_obra = EXCLUDED.ubicacion_obra,
  requiere_visita = EXCLUDED.requiere_visita,
  ubicacion_visita = EXCLUDED.ubicacion_visita,
  fecha_visita_especifica = EXCLUDED.fecha_visita_especifica,
  coordina_visita = EXCLUDED.coordina_visita,
  contacto_visita_nombre = EXCLUDED.contacto_visita_nombre,
  contacto_visita_telefono = EXCLUDED.contacto_visita_telefono,
  contacto_visita_correo = EXCLUDED.contacto_visita_correo,
  formularios_requeridos = EXCLUDED.formularios_requeridos,
  analizado_en = NOW();
"

                if PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "$INSERT_QUERY" > /dev/null 2>&1; then
                    log "  ✓ Guardado en BD"
                    EXITO=true
                    EXITOSOS=$((EXITOSOS + 1))
                    # Agregar resultado exitoso con TODOS los campos del análisis
                    resultado_ok=$(jq -n \
                        --arg llamado_id "$llamado_id" \
                        --arg archivo "$archivo_analizado" \
                        --argjson es_relevante "$es_relevante" \
                        --argjson confianza "$confianza" \
                        --arg descripcion "$descripcion" \
                        --arg razon "$razon" \
                        --argjson materiales "$materiales" \
                        --arg resumen "$resumen" \
                        --arg ubicacion_obra "$ubicacion_obra" \
                        --argjson requiere_visita "$requiere_visita" \
                        --arg ubicacion_visita "$ubicacion_visita" \
                        --arg fecha_visita "$fecha_visita_json" \
                        --argjson coordina_visita "$coordina_visita" \
                        --arg contacto_nombre "$contacto_nombre" \
                        --arg contacto_tel "$contacto_tel" \
                        --arg contacto_mail "$contacto_mail" \
                        --argjson formularios "$formularios_json" \
                        '{
                            llamado_id: $llamado_id,
                            archivo: $archivo,
                            es_relevante: $es_relevante,
                            confianza: $confianza,
                            descripcion_llamado: (if $descripcion == "null" then null else $descripcion end),
                            razon: (if $razon == "null" then null else $razon end),
                            materiales_detectados: $materiales,
                            resumen_trabajo: (if $resumen == "null" then null else $resumen end),
                            ubicacion_obra: (if $ubicacion_obra == "null" then null else $ubicacion_obra end),
                            requiere_visita: $requiere_visita,
                            ubicacion_visita: (if $ubicacion_visita == "null" then null else $ubicacion_visita end),
                            fecha_visita_especifica: (if $fecha_visita == "null" then null else $fecha_visita end),
                            coordina_visita: $coordina_visita,
                            contacto_visita_nombre: (if $contacto_nombre == "null" then null else $contacto_nombre end),
                            contacto_visita_telefono: (if $contacto_tel == "null" then null else $contacto_tel end),
                            contacto_visita_correo: (if $contacto_mail == "null" then null else $contacto_mail end),
                            formularios_requeridos: $formularios
                        }')
                    if [ -z "$RESULTADOS_OK" ]; then
                        RESULTADOS_OK="$resultado_ok"
                    else
                        RESULTADOS_OK="$RESULTADOS_OK,$resultado_ok"
                    fi
                else
                    ERROR_MSG="Error al insertar en BD"
                    log "  ✗ $ERROR_MSG"
                fi
            fi
        fi

        # ========================================
        # 2.6) ELIMINAR ARCHIVO TEMPORAL
        # ========================================
        rm -f "$TMP_DIR/$archivo_analizado" 2>/dev/null || true

    else
        ERROR_MSG="Error al descargar archivo"
        log "  ✗ $ERROR_MSG"
    fi

    # Registrar error si no fue exitoso
    if [ "$EXITO" = false ]; then
        ERRORES=$((ERRORES + 1))
        ERROR_MSG_ESC=$(escape_json "$ERROR_MSG")
        # Agregar resultado con error
        resultado_error="{\"llamado_id\":\"$llamado_id\",\"archivo\":\"$archivo_analizado\",\"error\":\"$ERROR_MSG_ESC\"}"
        if [ -z "$RESULTADOS_ERROR" ]; then
            RESULTADOS_ERROR="$resultado_error"
        else
            RESULTADOS_ERROR="$RESULTADOS_ERROR,$resultado_error"
        fi
    fi

done << EOF
$ARCHIVOS_JSON
EOF

# ============================================
# 3) ANÁLISIS FALLBACK PARA LLAMADOS SIN ARCHIVOS EXTRAÍBLES
# ============================================
log ""
log "========================================"
log "Verificando llamados sin análisis..."
log "========================================"

# Buscar llamados activos que tienen archivos adjuntos pero NO tienen análisis
LLAMADOS_SIN_ANALISIS_QUERY="
SELECT DISTINCT
  aa.llamado_id,
  l.titulo,
  l.descripcion,
  l.fecha_apertura
FROM archivos_adjuntos aa
INNER JOIN llamados l ON aa.llamado_id = l.id
LEFT JOIN analisis_ia ai ON ai.llamado_id = aa.llamado_id
WHERE l.estado = 'activo'
  AND ai.id IS NULL
ORDER BY l.fecha_apertura ASC
LIMIT 10;
"

LLAMADOS_SIN_ANALISIS=$(PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -A -F'|' -c "$LLAMADOS_SIN_ANALISIS_QUERY" 2>/dev/null || echo "")

if [ -n "$LLAMADOS_SIN_ANALISIS" ]; then
    LLAMADOS_COUNT=$(echo "$LLAMADOS_SIN_ANALISIS" | wc -l)
    log "✓ Encontrados $LLAMADOS_COUNT llamados sin análisis, creando análisis fallback..."

    echo "$LLAMADOS_SIN_ANALISIS" | while IFS='|' read -r llamado_id titulo descripcion fecha_apertura; do
        log ""
        log "[FALLBACK] Procesando llamado $llamado_id: $titulo"

        # Obtener contexto adicional del llamado
        obtener_contexto_llamado "$llamado_id"

        # Construir texto para análisis basado en metadata
        TEXTO_FALLBACK="=== TÍTULO DEL LLAMADO ===
$titulo
$CONTEXTO_DESC
$CONTEXTO_ITEMS
$CONTEXTO_ACLARACIONES

NOTA: Este análisis se realiza sobre los metadatos del llamado porque los archivos adjuntos no pudieron ser extraídos."

        log "  → Analizando metadatos con IA..."

        # Preparar prompt para análisis fallback
        PROMPT_FALLBACK="Eres un analizador de licitaciones del rubro aluminio/vidrio/aberturas para Uruguay.

Analiza esta licitación basándote SOLO en título, descripción, items y aclaraciones (los archivos PDF no estaban disponibles).

$TEXTO_FALLBACK

RESPONDE EN JSON con este formato exacto:
{
  \"descripcion_llamado\": \"Breve descripción del trabajo\",
  \"es_relevante\": true o false,
  \"confianza\": 0.XX (0.0 a 1.0, usa confianza BAJA 0.3-0.5 porque faltan archivos),
  \"razon\": \"Por qué es/no es relevante\",
  \"materiales_detectados\": [\"material1\", \"material2\"],
  \"resumen_trabajo\": \"Resumen del trabajo solicitado\",
  \"ubicacion_obra\": \"Ubicación si se menciona\",
  \"requiere_visita\": false,
  \"ubicacion_visita\": null,
  \"fecha_visita_especifica\": null,
  \"coordina_visita\": false,
  \"contacto_visita_nombre\": null,
  \"contacto_visita_telefono\": null,
  \"contacto_visita_correo\": null,
  \"formularios_requeridos\": []
}

IMPORTANTE: Usa confianza BAJA (0.3-0.5) porque este análisis se basa solo en metadatos, sin acceso a pliegos."

        OLLAMA_BODY=$(jq -n \
            --arg model "$OLLAMA_MODEL" \
            --arg prompt "$PROMPT_FALLBACK" \
            '{
                model: $model,
                format: "json",
                temperature: 0,
                system: "Eres un analizador especializado en licitaciones. SOLO respondes con JSON válido.",
                prompt: $prompt,
                stream: false
            }')

        OLLAMA_RESPONSE=$(curl -s -X POST "$OLLAMA_URL" \
            -H "Content-Type: application/json" \
            -d "$OLLAMA_BODY" \
            --max-time 300 2>/dev/null || echo "")

        if [ -z "$OLLAMA_RESPONSE" ]; then
            log "  ✗ Error al contactar con Ollama"
            continue
        fi

        ANALISIS_JSON=$(echo "$OLLAMA_RESPONSE" | jq -r '.response // empty' 2>/dev/null || echo "")

        if [ -z "$ANALISIS_JSON" ]; then
            log "  ✗ Ollama no retornó respuesta válida"
            continue
        fi

        # Extraer campos del análisis
        descripcion=$(echo "$ANALISIS_JSON" | jq -r '.descripcion_llamado // "null"')
        es_relevante=$(echo "$ANALISIS_JSON" | jq -r '.es_relevante // false')
        confianza=$(echo "$ANALISIS_JSON" | jq -r '.confianza // 0.3')
        razon=$(echo "$ANALISIS_JSON" | jq -r '.razon // "null"')
        materiales=$(echo "$ANALISIS_JSON" | jq -c '.materiales_detectados // []')
        resumen=$(echo "$ANALISIS_JSON" | jq -r '.resumen_trabajo // "null"')
        ubicacion_obra=$(echo "$ANALISIS_JSON" | jq -r '.ubicacion_obra // "null"')
        requiere_visita=$(echo "$ANALISIS_JSON" | jq -r '.requiere_visita // false')

        log "  → es_relevante: $es_relevante | confianza: $confianza"

        # Preparar valores para inserción
        llamado_id_esc=$(escape_sql "$llamado_id")
        desc_esc=$(escape_sql "$descripcion")
        razon_esc=$(escape_sql "$razon")
        materiales_esc=$(escape_sql "$materiales")
        resumen_esc=$(escape_sql "$resumen")
        ubicacion_obra_esc=$(escape_sql "$ubicacion_obra")

        # Convertir nulls
        [ "$descripcion" = "null" ] && desc_esc="NULL" || desc_esc="'$desc_esc'"
        [ "$razon" = "null" ] && razon_esc="NULL" || razon_esc="'$razon_esc'"
        [ "$resumen" = "null" ] && resumen_esc="NULL" || resumen_esc="'$resumen_esc'"
        [ "$ubicacion_obra" = "null" ] && ubicacion_obra_esc="NULL" || ubicacion_obra_esc="'$ubicacion_obra_esc'"

        # Insertar análisis fallback
        INSERT_FALLBACK="
INSERT INTO analisis_ia (
  llamado_id,
  archivo_analizado,
  descripcion_llamado,
  es_relevante,
  confianza,
  razon,
  materiales_detectados,
  resumen_trabajo,
  ubicacion_obra,
  requiere_visita,
  ubicacion_visita,
  fecha_visita_especifica,
  coordina_visita,
  contacto_visita_nombre,
  contacto_visita_telefono,
  contacto_visita_correo,
  formularios_requeridos,
  analizado_en
)
VALUES (
  '$llamado_id_esc',
  'METADATA_FALLBACK',
  $desc_esc,
  $es_relevante,
  $confianza,
  $razon_esc,
  '$materiales_esc'::jsonb,
  $resumen_esc,
  $ubicacion_obra_esc,
  $requiere_visita,
  NULL,
  NULL,
  false,
  NULL,
  NULL,
  NULL,
  '[]'::jsonb,
  NOW()
)
ON CONFLICT (llamado_id, archivo_analizado)
DO UPDATE SET
  descripcion_llamado = EXCLUDED.descripcion_llamado,
  es_relevante = EXCLUDED.es_relevante,
  confianza = EXCLUDED.confianza,
  razon = EXCLUDED.razon,
  materiales_detectados = EXCLUDED.materiales_detectados,
  resumen_trabajo = EXCLUDED.resumen_trabajo,
  ubicacion_obra = EXCLUDED.ubicacion_obra,
  requiere_visita = EXCLUDED.requiere_visita,
  analizado_en = NOW();
"

        if PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "$INSERT_FALLBACK" > /dev/null 2>&1; then
            log "  ✓ Análisis fallback guardado en BD"
            EXITOSOS=$((EXITOSOS + 1))
        else
            log "  ✗ Error al guardar análisis fallback"
            ERRORES=$((ERRORES + 1))
        fi
    done
else
    log "✓ Todos los llamados activos tienen análisis"
fi

# ============================================
# 4) RETORNAR RESUMEN FINAL
# ============================================
log ""
log "========================================"
log "Procesamiento completado"
log "Total: $TOTAL | Exitosos: $EXITOSOS | Errores: $ERRORES"
log "========================================"

# Construir arrays JSON (compatible con sh)
if [ -n "$RESULTADOS_OK" ]; then
    OK_ARRAY="[$RESULTADOS_OK]"
else
    OK_ARRAY="[]"
fi

if [ -n "$RESULTADOS_ERROR" ]; then
    ERROR_ARRAY="[$RESULTADOS_ERROR]"
else
    ERROR_ARRAY="[]"
fi

# Retornar JSON final
cat <<EOF
{
  "mensaje": "Procesamiento completado: $EXITOSOS exitosos, $ERRORES errores",
  "total_archivos": $TOTAL,
  "exitosos": $EXITOSOS,
  "con_errores": $ERRORES,
  "resultados_ok": $OK_ARRAY,
  "resultados_error": $ERROR_ARRAY,
  "fecha_proceso": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF