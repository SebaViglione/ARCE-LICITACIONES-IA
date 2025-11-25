#!/bin/bash

# Test simple de extract_text.sh

echo "Testing extract_text.sh with pedido_1295799.pdf..."
echo ""

docker exec n8n_app sh /home/n8n/ARCE-LICITACIONES-IA/scripts/extract_text.sh "pedido_1295799.pdf" "1295799"
