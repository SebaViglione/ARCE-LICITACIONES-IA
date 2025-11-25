FROM n8nio/n8n:latest

USER root

# Instalar Chromium, PostgreSQL client, herramientas de extracción de texto y dependencias necesarias
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    postgresql-client \
    curl \
    jq \
    poppler-utils \
    pandoc \
    antiword \
    tesseract-ocr \
    tesseract-ocr-data-spa \
    unzip

# Instalar Puppeteer globalmente (sin bajar Chromium adicional)
RUN npm install -g puppeteer

# Configurar Puppeteer para usar el Chromium del sistema
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

USER node

