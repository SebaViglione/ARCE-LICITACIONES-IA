# Dashboard Licitaciones IA

Dashboard web para visualización y gestión de licitaciones analizadas por IA.

## Descripción

Aplicación web que muestra las licitaciones del portal ARCE con su análisis de relevancia por IA. Permite filtrar, ordenar, ver detalles y dar feedback humano sobre cada licitación.

## Características

- Vista grilla y lista
- Filtros por estado de seguimiento y relevancia
- Ordenamiento por urgencia, confianza IA, fecha o título
- Búsqueda por texto en título y descripción
- Modal de detalle con archivos adjuntos y aclaraciones
- Formulario de feedback humano (relevancia real, estado, comentarios)
- Panel de resumen con métricas

## Requisitos

- Node.js 18+
- PostgreSQL con el esquema del proyecto
- Vista `v_llamados_dashboard` creada

## Instalación

### 1. Configurar variables de entorno

```bash
cp .env.example .env
```

Editar `.env` con las credenciales de PostgreSQL:

```env
PGHOST=localhost
PGPORT=5432
PGDATABASE=n8n
PGUSER=n8n
PGPASSWORD=tu_password
PORT=3000
```

### 2. Instalar dependencias

```bash
npm install
```

### 3. Ejecutar

```bash
node server.js
```

Dashboard disponible en `http://localhost:3000`

## Deployment con Docker

### Build y Run

```bash
docker build -t dashboard-licitaciones .

docker run -d \
  --name dashboard-licitaciones \
  -p 3000:3000 \
  --env-file .env \
  dashboard-licitaciones
```

### Docker Compose

```yaml
services:
  dashboard:
    build: .
    ports:
      - "3000:3000"
    environment:
      - PGHOST=postgres
      - PGPORT=5432
      - PGDATABASE=n8n
      - PGUSER=n8n
      - PGPASSWORD=${POSTGRES_PASSWORD}
    depends_on:
      - postgres
    restart: unless-stopped
```

## Estructura

```
Dashboard Licitaciones IA/
├── public/
│   ├── index.html      # Frontend HTML
│   ├── app.js          # Lógica JavaScript
│   └── styles.css      # Estilos CSS
├── server.js           # API Express
├── package.json        # Dependencias
├── .env.example        # Template de configuración
├── Dockerfile          # Imagen Docker
└── .dockerignore       # Exclusiones Docker
```

## API Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/llamados` | Lista llamados activos con análisis IA |
| GET | `/api/llamados/:id` | Detalle con adjuntos y aclaraciones |
| POST | `/api/feedback` | Guardar feedback humano |

### GET /api/llamados

Retorna lista de licitaciones activas con su mejor análisis IA y feedback.

```json
[
  {
    "llamado_id": "1295069",
    "titulo": "Concurso de Precios 30/2025...",
    "dias_restantes": 8,
    "es_relevante": true,
    "confianza": 92,
    "total_archivos": 3,
    "es_relevante_real": true,
    "estado_seguimiento": "en_progreso"
  }
]
```

### GET /api/llamados/:id

Retorna detalle de una licitación con archivos y aclaraciones.

```json
{
  "llamado": { /* datos completos */ },
  "adjuntos": [
    { "nombre": "pliego.pdf", "archivo_url": "http://..." }
  ],
  "aclaraciones": [
    { "fecha": "2025-11-19", "texto": "Se agregaron planos" }
  ]
}
```

### POST /api/feedback

Guarda feedback humano sobre una licitación.

```json
{
  "llamado_id": "1295069",
  "es_relevante_real": true,
  "estado_seguimiento": "en_progreso",
  "comentario": "Contactar mañana"
}
```

## Dependencias

- `express` - Servidor web
- `pg` - Cliente PostgreSQL
- `cors` - Manejo de CORS
- `dotenv` - Variables de entorno

## Base de datos requerida

- Vista `v_llamados_dashboard`
- Tablas: `archivos_adjuntos`, `aclaraciones`, `feedback_usuario`

Ver [database/README.md](../database/README.md) para el esquema completo.

## Personalización

### Colores

Editar variables CSS en `public/styles.css`:

```css
:root {
  --bg-primary: #0f1419;
  --accent-primary: #10b981;
}
```

### Puerto

Cambiar en `.env`:

```env
PORT=8080
```

## Troubleshooting

### Error conexión PostgreSQL
- Verificar que PostgreSQL está corriendo
- Verificar credenciales en `.env`
- Verificar que la vista `v_llamados_dashboard` existe

### No muestra datos
- Verificar que hay datos en `llamados` con `estado = 'activo'`
- Revisar logs del servidor

### Error módulo no encontrado
```bash
npm install
```
