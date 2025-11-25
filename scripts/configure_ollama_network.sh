#!/bin/bash

# ============================================
# Script para configurar Ollama para escuchar en 0.0.0.0:11434
# Esto permite que los contenedores Docker puedan acceder a Ollama
# ============================================

set -e

echo "========================================="
echo "Configurando Ollama para acceso desde Docker"
echo "========================================="
echo ""

# Verificar si Ollama está instalado
if ! command -v ollama &> /dev/null; then
    echo "❌ ERROR: Ollama no está instalado"
    exit 1
fi

echo "✓ Ollama está instalado"
echo ""

# Detener Ollama si está corriendo
echo "→ Deteniendo Ollama..."
sudo systemctl stop ollama || true
sleep 2

# Crear directorio para override si no existe
echo "→ Creando configuración override..."
sudo mkdir -p /etc/systemd/system/ollama.service.d/

# Crear archivo override con la configuración correcta
sudo tee /etc/systemd/system/ollama.service.d/override.conf > /dev/null << 'EOF'
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
EOF

echo "✓ Archivo override creado"
echo ""

# Mostrar contenido del override
echo "→ Contenido del override.conf:"
sudo cat /etc/systemd/system/ollama.service.d/override.conf
echo ""

# Recargar configuración de systemd
echo "→ Recargando systemd daemon..."
sudo systemctl daemon-reload

# Iniciar Ollama
echo "→ Iniciando Ollama..."
sudo systemctl start ollama

# Esperar a que Ollama inicie completamente
echo "→ Esperando a que Ollama inicie..."
sleep 3

# Verificar que está corriendo
if sudo systemctl is-active --quiet ollama; then
    echo "✓ Ollama está corriendo"
else
    echo "❌ ERROR: Ollama no se pudo iniciar"
    echo ""
    echo "Logs de error:"
    sudo journalctl -u ollama -n 20 --no-pager
    exit 1
fi

echo ""

# Verificar en qué interfaz está escuchando
echo "→ Verificando interfaz de red..."
LISTEN_INFO=$(sudo ss -tlnp | grep 11434 || echo "NO_ENCONTRADO")

if echo "$LISTEN_INFO" | grep -q "0.0.0.0:11434"; then
    echo "✅ PERFECTO: Ollama está escuchando en 0.0.0.0:11434"
    echo ""
    echo "$LISTEN_INFO"
    echo ""
elif echo "$LISTEN_INFO" | grep -q "127.0.0.1:11434"; then
    echo "⚠️  ADVERTENCIA: Ollama sigue escuchando solo en 127.0.0.1:11434"
    echo ""
    echo "$LISTEN_INFO"
    echo ""
    echo "Esto puede deberse a que:"
    echo "1. La variable OLLAMA_HOST está definida en otro lugar"
    echo "2. Ollama tiene una configuración adicional que sobrescribe esto"
    echo ""
    echo "Posibles soluciones:"
    echo "1. Verificar: sudo systemctl cat ollama.service"
    echo "2. Verificar variables de entorno del proceso:"
    sudo cat /proc/$(pgrep ollama)/environ | tr '\0' '\n' | grep OLLAMA || echo "   No se encontró OLLAMA_HOST en variables del proceso"
    echo ""
    exit 1
else
    echo "❓ No se pudo determinar la interfaz de escucha"
    echo ""
    echo "$LISTEN_INFO"
    exit 1
fi

# Probar conexión desde localhost
echo "→ Probando conexión desde localhost..."
if curl -s http://localhost:11434/api/tags > /dev/null; then
    echo "✓ Ollama responde en localhost"
else
    echo "⚠️  Ollama no responde en localhost"
fi

echo ""

# Probar conexión desde el contenedor Docker
echo "→ Probando conexión desde contenedor n8n..."
if docker exec n8n_app curl -s --max-time 5 http://172.17.0.1:11434/api/tags > /dev/null 2>&1; then
    echo "✅ ÉXITO: El contenedor n8n puede conectarse a Ollama!"
    echo ""
    echo "Modelos disponibles:"
    docker exec n8n_app curl -s http://172.17.0.1:11434/api/tags | jq -r '.models[].name' 2>/dev/null || echo "  (no se pudo obtener la lista)"
else
    echo "❌ ERROR: El contenedor n8n NO puede conectarse a Ollama"
    echo ""
    echo "Diagnóstico adicional:"
    echo "1. IP del gateway Docker:"
    docker network inspect bridge | jq -r '.[0].IPAM.Config[0].Gateway' || echo "   No se pudo obtener"
    echo ""
    echo "2. Verificar firewall:"
    sudo firewall-cmd --list-all 2>/dev/null || echo "   Firewall no está activo o no es firewalld"
    exit 1
fi

echo ""
echo "========================================="
echo "✅ Configuración completada exitosamente"
echo "========================================="
echo ""
echo "Ahora puedes ejecutar el script de análisis IA:"
echo "  docker exec n8n_app sh /home/n8n/ARCE-LICITACIONES-IA/scripts/procesar_analisis_batch.sh"
echo ""
