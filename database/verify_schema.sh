#!/bin/bash
# Script para verificar e importar el esquema corregido

echo "=== Verificando esquema de base de datos ==="
echo ""

echo "1. Importando scheme.sql al contenedor PostgreSQL..."
sudo cat /home/seba/dev/ARCE-LICITACIONES-IA/database/scheme.sql | sudo docker exec -i n8n_postgres psql -U n8n -d n8n

echo ""
echo "2. Verificando que las funciones existan..."
sudo docker exec -i n8n_postgres psql -U n8n -d n8n -c "\df calcular_prioridad"
sudo docker exec -i n8n_postgres psql -U n8n -d n8n -c "\df actualizar_prioridad_trigger"

echo ""
echo "3. Probando el trigger con datos de prueba..."
sudo docker exec -i n8n_postgres psql -U n8n -d n8n << 'EOF'
-- Insertar un llamado de prueba
INSERT INTO llamados (id, titulo, descripcion, dias_restantes, urgencia, estado)
VALUES ('TEST001', 'Test Llamado', 'Test description', 5, 'próximo', 'activo')
ON CONFLICT (id) DO NOTHING;

-- Insertar análisis IA (debería activar el trigger)
INSERT INTO analisis_ia (llamado_id, archivo_analizado, es_relevante, confianza, requiere_visita)
VALUES ('TEST001', 'test.pdf', true, 85, true)
ON CONFLICT (llamado_id, archivo_analizado) DO UPDATE 
SET confianza = 85, requiere_visita = true;

-- Verificar que prioridad_score se calculó
SELECT id, titulo, prioridad_score, dias_restantes FROM llamados WHERE id = 'TEST001';

-- Limpiar
DELETE FROM llamados WHERE id = 'TEST001';
EOF

echo ""
echo "=== Verificación completada ==="
