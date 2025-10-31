#!/bin/bash
# ═══════════════════════════════════════════════════════════
# 🔍 TEST RÁPIDO - IA Arce Licitaciones (Fedora → Host Windows)
# Ejecuta una consulta a Ollama remoto (GPU) y devuelve JSON limpio
# ═══════════════════════════════════════════════════════════

MODEL="${MODEL:-arce-licitaciones}"
HOST_IP="192.168.56.1"          # IP del host Windows (VirtualBox Host-Only)
PORT="11434"                    # Puerto del servidor Ollama
REMOTE_URL="http://$HOST_IP:$PORT/api/generate"
LOCAL_URL="http://127.0.0.1:$PORT/api/generate"
RESULTS_DIR="$HOME/ollama-dev/results"
SYSTEM_PROMPT_FILE="$HOME/ollama-dev/prompts/system-prompt.txt"
OUTPUT_FILE="$RESULTS_DIR/quick-output.json"

# Crear carpeta de resultados si no existe
mkdir -p "$RESULTS_DIR"

# Verificar argumento
if [ -z "$1" ]; then
    echo "Uso: $0 \"texto a analizar\""
    exit 1
fi

INPUT_TEXT="$1"

# Verificar prompt del sistema
if [ ! -f "$SYSTEM_PROMPT_FILE" ]; then
    echo "❌ No se encontró el archivo de prompt en: $SYSTEM_PROMPT_FILE"
    exit 1
fi
SYSTEM_PROMPT=$(<"$SYSTEM_PROMPT_FILE")

# Detectar si Ollama remoto (Windows) está disponible
if curl -s --connect-timeout 2 "$REMOTE_URL" > /dev/null; then
    OLLAMA_URL="$REMOTE_URL"
    echo "🌐 Usando Ollama remoto en $HOST_IP"
else
    OLLAMA_URL="$LOCAL_URL"
    echo "💻 Usando Ollama local"
fi

# Armar prompt completo y escaparlo para JSON
FORMATTED_PROMPT=$(printf "%s\n\nTEXTO A ANALIZAR:\n%s" "$SYSTEM_PROMPT" "$INPUT_TEXT" | jq -Rs .)

START=$(date +%s)
echo "🧪 Analizando..."

# 🚀 Petición a Ollama (sin streaming)
RESPONSE=$(curl -s -X POST "$OLLAMA_URL" \
  -H "Content-Type: application/json" \
  -d "{
        \"model\": \"$MODEL\",
        \"prompt\": $FORMATTED_PROMPT,
        \"format\": \"json\",
        \"stream\": false
      }")

END=$(date +%s)
DURATION=$((END - START))

# ═══════════════════════════════════════════════════════════
# 🧩 PROCESAMIENTO DE RESPUESTA
# Extrae el JSON anidado de .response y lo guarda limpio
# ═══════════════════════════════════════════════════════════

if echo "$RESPONSE" | jq -e '.response' >/dev/null 2>&1; then
    # Extraer campo .response y parsearlo
    INNER_JSON=$(echo "$RESPONSE" | jq -r '.response' | jq . 2>/dev/null)
    if [ $? -eq 0 ]; then
        echo "✅ Respuesta IA procesada correctamente"
        echo "$INNER_JSON" > "$OUTPUT_FILE"
    else
        echo "⚠️  Respuesta sin formato JSON válido, guardando crudo"
        echo "$RESPONSE" > "$OUTPUT_FILE"
    fi
else
    echo "⚠️  No se detectó campo 'response', guardando crudo"
    echo "$RESPONSE" > "$OUTPUT_FILE"
fi

# ═══════════════════════════════════════════════════════════
# 📊 RESUMEN FINAL
# ═══════════════════════════════════════════════════════════
echo ""
echo "⏱️  Tiempo: ${DURATION}s"
echo "🗂️  Resultado guardado en $OUTPUT_FILE"

