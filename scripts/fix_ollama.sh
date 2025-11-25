#!/bin/bash
echo "=== Limpiando Ollama ==="

echo "1. Deteniendo servicio systemd..."
sudo systemctl stop ollama 2>/dev/null || true

echo "2. Matando procesos en puerto 11434..."
# Encontrar PID del proceso usando el puerto
PID=$(sudo lsof -t -i:11434)
if [ -n "$PID" ]; then
    echo "   Matando proceso $PID..."
    sudo kill -9 $PID
else
    echo "   No se encontraron procesos en el puerto 11434."
fi

echo "3. Verificando que el puerto esté libre..."
if sudo lsof -i:11434; then
    echo "   ❌ El puerto sigue ocupado. Algo salió mal."
    exit 1
else
    echo "   ✓ Puerto 11434 libre."
fi

echo ""
echo "=== Iniciando Ollama ==="
echo "Ejecutando 'ollama serve' en background..."
nohup ollama serve > /tmp/ollama.log 2>&1 &
sleep 5

echo "Verificando estado..."
if curl -s http://localhost:11434 | grep -q "Ollama is running"; then
    echo "✅ OLLAMA ESTÁ CORRIENDO CORRECTAMENTE"
    echo "Ya puedes ejecutar el workflow en n8n."
else
    echo "❌ Error al iniciar Ollama. Revisa /tmp/ollama.log"
    cat /tmp/ollama.log
fi
