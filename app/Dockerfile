# syntax=docker/dockerfile:1.7
# ---------- Etapa 1: compilar TypeScript ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---------- Etapa 2: runtime ----------
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    DATA_DIR=/data \
    PORT=3000 \
    TZ=America/Montevideo

# Chromium para Puppeteer + herramientas de extracción de texto (pdftotext, pandoc, antiword, tesseract, unzip)
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      fonts-liberation fonts-dejavu-core \
      poppler-utils \
      pandoc \
      antiword \
      tesseract-ocr tesseract-ocr-spa \
      unzip \
      ca-certificates \
      curl \
      tzdata \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY migrations ./migrations
COPY public ./public
COPY rubros ./rubros

RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -fsS http://localhost:3000/api/health || exit 1

CMD ["node", "dist/index.js"]
