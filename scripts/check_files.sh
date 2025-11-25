#!/bin/bash
echo "=== Verificación detallada del directorio arce-scraper ==="
echo ""

echo "Archivos en el HOST (/home/seba/dev/ARCE-LICITACIONES-IA/arce-scraper/):"
ls -lah /home/seba/dev/ARCE-LICITACIONES-IA/arce-scraper/

echo ""
echo "Archivos en el CONTENEDOR (/home/n8n/ARCE-LICITACIONES-IA/arce-scraper/):"
sudo docker exec n8n_app ls -lah /home/n8n/ARCE-LICITACIONES-IA/arce-scraper/

echo ""
echo "Comparando archivos específicos:"
echo "  Host:"
file /home/seba/dev/ARCE-LICITACIONES-IA/arce-scraper/scrape_arce.js

echo ""
echo "  Contenedor:"
sudo docker exec n8n_app sh -c 'if [ -f /home/n8n/ARCE-LICITACIONES-IA/arce-scraper/scrape_arce.js ]; then file /home/n8n/ARCE-LICITACIONES-IA/arce-scraper/scrape_arce.js; else echo "Archivo NO encontrado"; fi'

echo ""
echo "Verificando permisos y propietario en el host:"
stat /home/seba/dev/ARCE-LICITACIONES-IA/arce-scraper/scrape_arce.js

echo ""
echo "Verificando si hay archivos ocultos o con nombres similares en el contenedor:"
sudo docker exec n8n_app find /home/n8n/ARCE-LICITACIONES-IA/arce-scraper/ -type f -name "*scrape*"

echo ""
echo "=== Fin de la verificación ==="
