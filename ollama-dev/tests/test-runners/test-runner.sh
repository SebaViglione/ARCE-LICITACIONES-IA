#!/bin/bash
# ═══════════════════════════════════════════════════════════
# 🧪 SISTEMA DE TESTING PARA PROMPTS DE OLLAMA (IA Arce Licitaciones)
# Fedora = Cliente / Host Windows = Cómputo GPU vía Ollama API
# ═══════════════════════════════════════════════════════════

# Configuración base
MODEL="${MODEL:-arce-licitaciones}"
HOST_IP="192.168.56.1"          # IP del host Windows (VirtualBox Host-Only)
PORT="11434"
REMOTE_URL="http://$HOST_IP:$PORT/api/generate"
LOCAL_URL="http://127.0.0.1:$PORT/api/generate"
SYSTEM_PROMPT_FILE="$HOME/ARCE-LICITACIONES-IA/ollama-dev/prompts/system-prompt.txt"
TEST_CASES_FILE="$HOME/ARCE-LICITACIONES-IA/ollama-dev/tests/test-cases/test-cases.json"
RESULTS_DIR="$HOME/ARCE-LICITACIONES-IA/ollama-dev/results"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RESULTS_FILE="$RESULTS_DIR/test_results_${TIMESTAMP}.json"

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

# Crear carpeta de resultados
mkdir -p "$RESULTS_DIR"

# Verificar dependencias
for dep in jq curl; do
    if ! command -v $dep &>/dev/null; then
        echo -e "${RED}❌ Falta dependencia: $dep${NC}"
        exit 1
    fi
done

# Detectar Ollama remoto
if curl -s --connect-timeout 2 "$REMOTE_URL" > /dev/null; then
    OLLAMA_URL="$REMOTE_URL"
    echo -e "${CYAN}🌐 Usando Ollama remoto en $HOST_IP${NC}"
else
    OLLAMA_URL="$LOCAL_URL"
    echo -e "${YELLOW}💻 Usando Ollama local${NC}"
fi

# Verificar archivos
if [ ! -f "$SYSTEM_PROMPT_FILE" ]; then
    echo -e "${RED}❌ No se encontró el archivo de prompt${NC}"
    exit 1
fi
if [ ! -f "$TEST_CASES_FILE" ]; then
    echo -e "${RED}❌ No se encontró el archivo de casos de prueba${NC}"
    exit 1
fi

SYSTEM_PROMPT=$(<"$SYSTEM_PROMPT_FILE")
NUM_TESTS=$(jq 'length' "$TEST_CASES_FILE")

clear
echo -e "${CYAN}${BOLD}"
echo "═══════════════════════════════════════════════════════════"
echo "    🧪 SISTEMA DE TESTING OLLAMA - LICITACIONES ARCE"
echo "═══════════════════════════════════════════════════════════"
echo -e "${NC}"
echo -e "${BLUE}Modelo:${NC} $MODEL"
echo -e "${BLUE}Prompt:${NC} $SYSTEM_PROMPT_FILE"
echo -e "${BLUE}Tests:${NC} $TEST_CASES_FILE"
echo -e "${BLUE}Resultados:${NC} $RESULTS_FILE"
echo -e "${MAGENTA}Total de tests:${NC} $NUM_TESTS"
echo ""

# Inicializar archivo JSON
echo "[" > "$RESULTS_FILE"

TOTAL=0
PASSED=0
FAILED=0

# ═══════════════════════════════════════════════════════════
# Función para ejecutar un test individual
# ═══════════════════════════════════════════════════════════
run_test() {
    local id="$1"
    local name="$2"
    local input="$3"
    local expected="$4"
    local full_prompt
    local output_json

    TOTAL=$((TOTAL + 1))

    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BOLD}🧩 Test #$id: $name${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    full_prompt=$(printf "%s\n\nTEXTO A ANALIZAR:\n%s" "$SYSTEM_PROMPT" "$input" | jq -Rs .)

    echo -e "${YELLOW}⏳ Enviando al modelo...${NC}"
    START=$(date +%s)
    RESPONSE=$(curl -s -X POST "$OLLAMA_URL" \
      -H "Content-Type: application/json" \
      -d "{
            \"model\": \"$MODEL\",
            \"prompt\": $full_prompt,
            \"format\": \"json\",
            \"stream\": false
          }")
    END=$(date +%s)
    DURATION=$((END - START))

    # Procesar respuesta
    if echo "$RESPONSE" | jq -e '.response' >/dev/null 2>&1; then
        output_json=$(echo "$RESPONSE" | jq -r '.response' | jq . 2>/dev/null)
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✅ Respuesta procesada correctamente${NC}"
        else
            echo -e "${YELLOW}⚠️  Respuesta no JSON, guardando crudo${NC}"
            output_json="$RESPONSE"
        fi
    else
        echo -e "${YELLOW}⚠️  Sin campo .response, guardando crudo${NC}"
        output_json="$RESPONSE"
    fi

    # Validaciones básicas
    local test_passed=true
    expected_relevante=$(echo "$expected" | jq -r '.es_relevante // empty')
    actual_relevante=$(echo "$output_json" | jq -r '.es_relevante // empty')
    if [ -n "$expected_relevante" ]; then
        if [ "$expected_relevante" == "$actual_relevante" ]; then
            echo -e "${GREEN}✓ es_relevante coincide${NC}"
        else
            echo -e "${RED}✗ es_relevante incorrecto (esperado: $expected_relevante, obtuvo: $actual_relevante)${NC}"
            test_passed=false
        fi
    fi

    if [ "$test_passed" = true ]; then
        echo -e "${GREEN}${BOLD}✓ TEST PASSED${NC}"
        PASSED=$((PASSED + 1))
    else
        echo -e "${RED}${BOLD}✗ TEST FAILED${NC}"
        FAILED=$((FAILED + 1))
    fi

    # Guardar resultado
    [ $id -gt 1 ] && echo "," >> "$RESULTS_FILE"
    cat >> "$RESULTS_FILE" << JSON
{
  "id": $id,
  "name": "$name",
  "input": $(echo "$input" | jq -Rs .),
  "expected": $expected,
  "result": $output_json,
  "duration_seconds": $DURATION,
  "passed": $test_passed
}
JSON
}

# ═══════════════════════════════════════════════════════════
# Ejecutar todos los tests
# ═══════════════════════════════════════════════════════════
for i in $(seq 0 $((NUM_TESTS - 1))); do
    id=$(jq -r ".[$i].id" "$TEST_CASES_FILE")
    name=$(jq -r ".[$i].name" "$TEST_CASES_FILE")
    input=$(jq -r ".[$i].input" "$TEST_CASES_FILE")
    expected=$(jq -c ".[$i].expected" "$TEST_CASES_FILE")
    run_test "$id" "$name" "$input" "$expected"
    sleep 1
done

# Cerrar archivo
echo "]" >> "$RESULTS_FILE"

# ═══════════════════════════════════════════════════════════
# 📊 RESUMEN FINAL
# ═══════════════════════════════════════════════════════════
echo -e "${CYAN}${BOLD}"
echo "═══════════════════════════════════════════════════════════"
echo "                     RESUMEN FINAL"
echo "═══════════════════════════════════════════════════════════"
echo -e "${NC}"
echo -e "${BLUE}Total de tests:${NC} $TOTAL"
echo -e "${GREEN}Aprobados:${NC} $PASSED"
echo -e "${RED}Fallidos:${NC} $FAILED"
SUCCESS_RATE=$((PASSED * 100 / TOTAL))
echo -e "${YELLOW}Éxito total:${NC} ${SUCCESS_RATE}%"
echo ""
echo -e "${BLUE}📁 Resultados guardados en:${NC} $RESULTS_FILE"
echo ""

