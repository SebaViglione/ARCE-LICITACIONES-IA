#!/bin/bash
# Script para inicializar vistas de la base de datos

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "[$(date)] Inicializando vistas de la base de datos..."

# Esperar a que postgres esté listo
until docker exec n8n_postgres pg_isready -U n8n > /dev/null 2>&1; do
  echo "[$(date)] Esperando a que PostgreSQL esté listo..."
  sleep 2
done

echo "[$(date)] PostgreSQL está listo. Creando vistas..."

# Ejecutar script de creación de vistas
docker exec -i n8n_postgres psql -U n8n -d n8n < "$SCRIPT_DIR/create_dashboard_view.sql"

echo "[$(date)] Vistas creadas exitosamente"
