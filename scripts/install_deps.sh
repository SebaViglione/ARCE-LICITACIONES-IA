#!/bin/sh
# ==========================================================
# 🧩 install_deps.sh
# Instala dependencias del sistema para Puppeteer/Chromium
# y herramientas de extracción de texto (pdftotext, etc.)
# ==========================================================

set -e

echo "📦 Instalando dependencias del sistema para Puppeteer y extracción de texto..."

# Detectar Alpine
if grep -qi "alpine" /etc/os-release 2>/dev/null; then
  echo "🔹 Detectado Alpine Linux"
  apk update

  # Dependencias para Chromium headless / Puppeteer (según doc de n8n / Puppeteer)
  apk add \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    chromium

  # Herramientas para extracción de texto
  apk add \
    poppler-utils \
    antiword \
    tesseract-ocr \
    tesseract-ocr-data-eng || true

  # Pandoc puede o no estar disponible según repositorios
  apk add pandoc || true

# Fedora / RHEL
elif [ -f /etc/fedora-release ] || [ -f /etc/redhat-release ]; then
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

  sudo dnf install -y \
    poppler-utils \
    antiword \
    pandoc \
    tesseract

# Debian / Ubuntu
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

  sudo apt-get install -y \
    poppler-utils \
    antiword \
    pandoc \
    tesseract-ocr

else
  echo "⚠️ Distribución no reconocida. Instalar manualmente dependencias de Chromium headless y herramientas de extracción."
fi

echo "✅ Dependencias del sistema instaladas correctamente."

