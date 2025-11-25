# Dashboard Licitaciones ARCE

Interfaz web para visualizar y gestionar las licitaciones analizadas por el sistema.

## Características

- **Vista Grilla/Lista**: Dos modos de visualización
- **Filtros**: Por relevancia, estado, fecha
- **Ordenamiento**: Por urgencia, confianza, fecha, título
- **Búsqueda**: Full-text en título y descripción
- **Modal de Detalle**: Información completa con archivos y aclaraciones
- **Feedback**: Sistema de retroalimentación humana

## Tecnologías

- **Backend**: Node.js + Express.js
- **Frontend**: Vanilla JavaScript + CSS
- **Base de Datos**: PostgreSQL 16
- **Contenedor**: Docker

## Instalación

### Local

```bash
cd src/dashboard
npm install
cp .env.example .env
# Editar .env con credenciales de PostgreSQL
npm start
```

### Docker

```bash
docker build -t dashboard-licitaciones ./src/dashboard
docker run -d --name dashboard \
  -p 3000:3000 \
  --env-file .env \
  dashboard-licitaciones
```

## Variables de Entorno

```env
PGHOST=localhost      # Host de PostgreSQL
PGPORT=5432          # Puerto de PostgreSQL  
PGDATABASE=n8n       # Nombre de la base de datos
PGUSER=n8n           # Usuario de PostgreSQL
PGPASSWORD=password  # Contraseña
PORT=3000            # Puerto del dashboard
```

## API Endpoints

### GET /api/llamados

Lista todos los llamados activos con análisis IA.

**Query Parameters:**
- `search` (string): Búsqueda full-text
- `relevante` (boolean): Filtrar por relevancia
- `estado` (string): Filtrar por estado
- `orderBy` (string): Campo de ordenamiento
- `orderDir` (asc|desc): Dirección de ordenamiento

**Respuesta:**
```json
[
  {
    "llamado_id": "1234567",
    "titulo": "Licitación...",
    "descripcion": "...",
    "es_relevante": true,
    "confianza": 0.95,
    "razon": "Incluye aluminio y DVH",
    "materiales_detectados": ["aluminio", "DVH"],
    "requiere_visita": true,
    "ubicacion_visita": "Montevideo",
    "fecha_apertura": "2025-02-20",
    "dias_restantes": 15,
    "urgencia": "media",
    "total_archivos": 3
  }
]
```

### GET /api/llamados/:id

Obtiene detalles completos de un llamado específico.

**Respuesta:**
```json
{
  "llamado": { /* datos básicos */ },
  "archivos": [
    {
      "nombre": "pliego.pdf",
      "url": "https://...",
      "tipo": "pdf"
    }
  ],
  "aclaraciones": [
    {
      "fecha": "2025-01-20",
      "hora": "10:30",
      "texto": "Se aclara que..."
    }
  ],
  "items": [
    {
      "codigo": "12345",
      "descripcion": "Ventanas de aluminio",
      "cantidad": 50
    }
  ]
}
```

### POST /api/feedback

Guarda feedback humano sobre un análisis.

**Body:**
```json
{
  "llamado_id": "1234567",
  "es_relevante_real": true,
  "comentario": "El análisis es correcto",
  "usuario": "operador1"
}
```

## Estructura del Proyecto

```
src/dashboard/
├── server.js              # Servidor Express
├── public/
│   ├── index.html        # HTML principal
│   ├── app.js            # Lógica frontend
│   ├── styles.css        # Estilos
│   └── favicon.ico       # Icono
├── package.json
├── Dockerfile
└── .env.example
```

## Desarrollo

### Modo Watch

```bash
npm install -D nodemon
npx nodemon server.js
```

### Debug

```bash
DEBUG=* node server.js
```

## Personalización

### Cambiar colores

Editar `public/styles.css`:

```css
:root {
  --color-primary: #2563eb;  /* Azul principal */
  --color-success: #10b981;  /* Verde (relevante) */
  --color-danger: #ef4444;   /* Rojo (no relevante) */
}
```

### Añadir filtros

1. Añadir campo en la query de `server.js`
2. Añadir control HTML en `index.html`  
3. Añadir lógica en `app.js`

## Troubleshooting

### Error: "relation v_llamados_dashboard does not exist"

Ejecutar script de inicialización de vistas:

```bash
sh database/init_views.sh
```

### Dashboard no carga datos

1. Verificar conexión a PostgreSQL:
```bash
psql -h localhost -U n8n -d n8n -c "SELECT COUNT(*) FROM llamados;"
```

2. Ver logs del servidor:
```bash
docker logs n8n_dashboard
```

3. Verificar vista existe:
```bash
psql -h localhost -U n8n -d n8n -c "\d v_llamados_dashboard"
```

## Testing

```bash
# Test API endpoints
curl http://localhost:3000/api/llamados | jq .

# Test con filtros
curl "http://localhost:3000/api/llamados?relevante=true&orderBy=confianza&orderDir=desc" | jq .

# Test llamado específico
curl http://localhost:3000/api/llamados/1234567 | jq .
```

## Deployment

### Producción

```bash
# Build optimizado
docker build -t dashboard-licitaciones:latest ./src/dashboard

# Run con restart policy
docker run -d \
  --name dashboard \
  --restart unless-stopped \
  -p 3000:3000 \
  --env-file .env \
  dashboard-licitaciones:latest
```

### Nginx Reverse Proxy

```nginx
server {
    listen 80;
    server_name licitaciones.example.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## Licencia

Apache 2.0 - Ver [LICENSE](../../LICENSE)
