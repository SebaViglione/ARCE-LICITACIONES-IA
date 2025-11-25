#!/bin/bash
# Script para reiniciar los contenedores y verificar los volúmenes montados

echo "=== Reiniciando contenedores con nuevos volúmenes ==="
echo ""

echo "1. Deteniendo contenedores..."
sudo docker-compose down

echo ""
echo "2. Iniciando contenedores con nuevas configuraciones..."
sudo docker-compose up -d

echo ""
echo "3. Esperando que los contenedores estén listos..."
sleep 10

echo ""
echo "4. Verificando que los archivos estén accesibles en el contenedor n8n..."
echo ""
echo "   Verificando arce-scraper:"
sudo docker exec n8n_app ls -la /home/n8n/ARCE-LICITACIONES-IA/arce-scraper/

echo ""
echo "   Verificando scripts:"
sudo docker exec n8n_app ls -la /home/n8n/ARCE-LICITACIONES-IA/scripts/

echo ""
echo "   Verificando database:"
sudo docker exec n8n_app ls -la /home/n8n/ARCE-LICITACIONES-IA/database/

echo ""
echo "5. Probando que el scraper sea ejecutable..."
sudo docker exec n8n_app node /home/n8n/ARCE-LICITACIONES-IA/arce-scraper/scrape_arce.js 2>&1 | head -5

echo ""
echo "=== Verificación completada ==="
echo ""
echo "Los contenedores están listos. Ahora puedes:"
echo "  - Acceder a n8n en: http://localhost:5678"
echo "  - Acceder al dashboard en: http://localhost:3000"
echo "  - Ejecutar el workflow de n8n para verificar que funcione"
