#!/bin/bash

# Script de diagnóstico para extract_text.sh

echo "=== Test de extracción de texto ==="
echo ""

# Usar el único archivo disponible
TEST_FILE="pedido_1295799.pdf"
TEST_ID="1295799"

echo "1. Verificando archivo de prueba..."
if [ -f "/home/seba/dev/ARCE-LICITACIONES-IA/tmp/$TEST_FILE" ]; then
    echo "✓ Archivo encontrado en el host"
    ls -lh "/home/seba/dev/ARCE-LICITACIONES-IA/tmp/$TEST_FILE"
else
    echo "✗ Archivo NO encontrado en el host"
    exit 1
fi

echo ""
echo "2. Verificando que el archivo existe dentro del contenedor..."
docker exec n8n_app ls -lh "/tmp_arce/$TEST_FILE"

echo ""
echo "3. Verificando herramientas instaladas en el contenedor..."
echo "- pdftotext:"
docker exec n8n_app which pdftotext

echo "- pandoc:"
docker exec n8n_app which pandoc

echo "- jq:"
docker exec n8n_app which jq

echo ""
echo "4. Probando extracción con pdftotext directamente..."
docker exec n8n_app pdftotext "/tmp_arce/$TEST_FILE" - 2>&1 | head -20

echo ""
echo "5. Ejecutando extract_text.sh..."
docker exec n8n_app sh /home/n8n/ARCE-LICITACIONES-IA/scripts/extract_text.sh "$TEST_FILE" "$TEST_ID"

echo ""
echo "6. Parseando JSON de salida..."
OUTPUT=$(docker exec n8n_app sh /home/n8n/ARCE-LICITACIONES-IA/scripts/extract_text.sh "$TEST_FILE" "$TEST_ID")
echo "$OUTPUT" | jq '.'

echo ""
echo "7. Extrayendo campo texto_extraido..."
echo "$OUTPUT" | jq -r '.texto_extraido' | head -100

echo ""
echo "=== Fin del diagnóstico ==="
