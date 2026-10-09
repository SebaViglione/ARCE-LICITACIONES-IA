FROM node:20-alpine

WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar solo dependencias de producción
RUN npm install --omit=dev

# Copiar resto del código
COPY . .

# Puerto por defecto
EXPOSE 3000

# Comando de inicio
CMD ["node", "server.js"]
