#!/bin/sh

# ============================================
# Script para procesar TODOS los archivos pendientes de análisis IA
# Sin loops de N8N - Ejecución directa en sh
# ============================================

set -eu

# Configuración
TMP_DIR="/home/n8n/ARCE-LICITACIONES-IA/tmp"
EXTRACT_SCRIPT="/home/n8n/ARCE-LICITACIONES-IA/scripts/extract_text.sh"
OLLAMA_URL="http://192.168.56.1:11434/api/generate"
OLLAMA_MODEL="arce-licitaciones:latest"
DB_HOST="postgres"
DB_PORT="5432"
DB_NAME="n8n"
DB_USER="n8n"
DB_PASS="n8n_secure_password_2024"

# Configuración de chunking
MAX_CHARS=10000       # Límite antes de activar chunking
CHUNK_SIZE=8000       # Tamaño de cada fragmento
CHUNK_OVERLAP=500     # Overlap entre chunks
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

3) VISITA TÉCNICA:
   - ¿Se requiere? ¿Dónde? ¿Cuándo? ¿Coordinación?
   - Contactos: nombre, teléfono, correo

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
        --max-time 600)

    echo "$OLLAMA_RESPONSE" | jq -r '.response // empty'
}

# Sintetizar resultados de todos los chunks
sintetizar_chunks() {
    chunks_json="$1"
    titulo_llamado="$2"

    PROMPT_SINTESIS="Eres un analizador de licitaciones del rubro aluminio.

Tienes los siguientes fragmentos analizados del pliego \"${titulo_llamado}\".

Fragmentos:
${chunks_json}

COMBINA toda la información en el esquema JSON COMPLETO:

{
  \"descripcion_llamado\": \"Resumen en ≤150 caracteres\",
  \"es_relevante\": true|false,
  \"confianza\": 0-100,
  \"razon\": \"Explicación de por qué es/no es relevante\",
  \"materiales_detectados\": [\"lista única sin duplicados\"],
  \"resumen_trabajo\": \"Descripción del trabajo requerido\",
  \"ubicacion_obra\": \"Ubicación consolidada\",
  \"requiere_visita\": true|false,
  \"ubicacion_visita\": \"Dirección de visita si aplica\",
  \"fecha_visita_especifica\": \"YYYY-MM-DD o null\",
  \"coordina_visita\": true|false,
  \"contacto_visita_nombre\": \"string o null\",
  \"contacto_visita_telefono\": \"string o null\",
  \"contacto_visita_correo\": \"string o null\",
  \"formularios_requeridos\": [
    {\"nombre\": \"...\", \"obligatorio\": true, \"seccion\": \"...\"}
  ]
}

REGLAS:
- Unifica materiales (elimina duplicados)
- Si varios fragmentos mencionan ubicación, consolida en una sola
- Lista TODOS los formularios encontrados SIN DUPLICAR
- NORMALIZA formularios: convierte a Title Case (ej: \"Anexo I\", no \"ANEXO I\" ni \"anexo i\")
- Si encuentras el mismo formulario con diferente capitalización, mantenlo solo una vez
- confianza NUNCA puede ser null (pon número entre 0-100)
- razon NUNCA puede estar vacío"

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
        --max-time 600)

    echo "$OLLAMA_RESPONSE" | jq -r '.response // empty'
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

        # ========================================
        # 2.2) EXTRAER TEXTO
        # ========================================
        log "  → Extrayendo texto..."

        if EXTRACT_OUTPUT=$(sh "$EXTRACT_SCRIPT" "$archivo_analizado" "$llamado_id" 2>&1); then
            log "  ✓ Texto extraído"

            # Limpiar caracteres de control antes de parsear con jq
            EXTRACT_CLEAN=$(echo "$EXTRACT_OUTPUT" | tr -d '\000-\037' | tr -d '\177')

            # Parsear salida JSON del script
            TEXTO_EXTRAIDO=$(echo "$EXTRACT_CLEAN" | jq -r '.texto_extraido // empty')

            if [ -z "$TEXTO_EXTRAIDO" ]; then
                ERROR_MSG="extract_text.sh no retornó texto"
                log "  ✗ $ERROR_MSG"
            else
                # ========================================
                # 2.3) LLAMAR A OLLAMA (con chunking si es necesario)
                # ========================================
                TEXTO_LENGTH=$(echo "$TEXTO_EXTRAIDO" | wc -c)

                if [ "$TEXTO_LENGTH" -le "$MAX_CHARS" ]; then
                    # CASO 1: Documento pequeño - análisis directo
                    log "  → Analizando con IA (documento pequeño: $TEXTO_LENGTH chars)..."

                    PROMPT="Analiza este pliego de licitación completo y extrae información según el esquema JSON.

Criterios de relevancia: aluminio, aberturas, ventanas, fachadas, barandas, cerramientos, DVH, estructuras metálicas, mamparas, vidrios.

EXTRAE:
1) Descripción resumida (≤150 caracteres)
2) ¿Es relevante para empresa de aluminio? (true/false)
3) Nivel de confianza 0-100
4) Razón de la relevancia/irrelevancia
5) Materiales detectados
6) Resumen del trabajo requerido
7) Ubicación de la obra
8) Información de visita técnica (si aplica)
9) Contactos
10) FORMULARIOS REQUERIDOS para presentación del presupuesto:
    - Busca: \"deberá presentar\", \"formulario\", \"anexo\", \"declaración jurada\", \"planilla\"
    - Nombre exacto, si es obligatorio, ubicación en pliego

Esquema JSON EXACTO:
{
  \"descripcion_llamado\": \"string(≤150)\",
  \"es_relevante\": true|false,
  \"confianza\": 0-100,
  \"razon\": \"string\",
  \"materiales_detectados\": [\"aluminio\"],
  \"resumen_trabajo\": \"string|null\",
  \"ubicacion_obra\": \"string|null\",
  \"requiere_visita\": true|false,
  \"ubicacion_visita\": \"string|null\",
  \"fecha_visita_especifica\": \"YYYY-MM-DD|null\",
  \"coordina_visita\": true|false,
  \"contacto_visita_nombre\": \"string|null\",
  \"contacto_visita_telefono\": \"string|null\",
  \"contacto_visita_correo\": \"string|null\",
  \"formularios_requeridos\": [
    {\"nombre\": \"string\", \"obligatorio\": true|false, \"seccion\": \"string\"}
  ]
}

Texto del pliego:
$TEXTO_EXTRAIDO"

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
                        --max-time 600)

                    OLLAMA_JSON=$(echo "$OLLAMA_RESPONSE" | jq -r '.response // empty')

                else
                    # CASO 2: Documento grande - análisis por chunks
                    NUM_CHUNKS=$(( (TEXTO_LENGTH + CHUNK_SIZE - 1) / CHUNK_SIZE ))
                    log "  → Documento grande detectado ($TEXTO_LENGTH chars)"
                    log "  → Procesando en $NUM_CHUNKS chunks..."

                    CHUNKS_RESULTADOS=""
                    CHUNK_INDEX=0
                    OFFSET=0

                    while [ "$OFFSET" -lt "$TEXTO_LENGTH" ]; do
                        CHUNK_INDEX=$((CHUNK_INDEX + 1))
                        CHUNK_TEXTO=$(echo "$TEXTO_EXTRAIDO" | tail -c +$((OFFSET + 1)) | head -c "$CHUNK_SIZE")

                        log "  → Analizando chunk $CHUNK_INDEX/$NUM_CHUNKS..."

                        CHUNK_JSON=$(analizar_chunk "$CHUNK_TEXTO" "$CHUNK_INDEX" "$NUM_CHUNKS")

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
                    # 2.4) INSERTAR EN BD
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
                            --arg fecha_visita "$fecha_visita" \
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
        else
            ERROR_MSG="Error al extraer texto: $EXTRACT_OUTPUT"
            log "  ✗ $ERROR_MSG"
        fi

        # ========================================
        # 2.5) ELIMINAR ARCHIVO TEMPORAL
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
# 3) RETORNAR RESUMEN FINAL
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

