#!/bin/bash
# ==========================================================
# 🧩 install_deps.sh
# Instala dependencias del sistema para Puppeteer/Chromium
# ==========================================================

set -e

echo "📦 Instalando dependencias del sistema para Puppeteer..."

if [ -f /etc/fedora-release ] || [ -f /etc/redhat-release ]; then
  echo "🔹 Detectado sistema basado en Fedora / RHEL"
  sudo dnf install -y \
    atk \
    at-spi2-atk \
    cups-libs \
    xdg-utils \
    alsa-lib \
    gtk3 \
    libX11 \
    libX11-xcb \
    libXcomposite \
    libXcursor \
    libXdamage \
    libXext \
    libXi \
    libXtst \
    libnss3 \
    libXrandr \
    mesa-libgbm \
    pango \
    libdrm \
    libxkbcommon \
    gdk-pixbuf2 \
    at-spi2-core \
    nss \
    libxshmfence
elif [ -f /etc/debian_version ]; then
  echo "🔹 Detectado sistema basado en Debian / Ubuntu"
  sudo apt-get update
  sudo apt-get install -y \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libx11-6 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libgtk-3-0 \
    libasound2 \
    libnss3 \
    libxkbcommon0 \
    libxshmfence1
else
  echo "⚠️ Distribución no reconocida. Instalar manualmente dependencias de Chromium headless."
fi

echo "✅ Dependencias del sistema instaladas correctamente."

