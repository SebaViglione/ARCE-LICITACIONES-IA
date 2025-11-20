# ARCE Licitaciones IA

Sistema automatizado de monitoreo y análisis de licitaciones estatales uruguayas (ARCE) para el rubro aluminio, usando IA local con Ollama.

## Descripción

El sistema monitorea automáticamente el portal de Compras Estatales de Uruguay, descarga los pliegos de licitación, los analiza con IA para determinar relevancia para empresas de aluminio, y presenta los resultados en un dashboard interactivo.

## Qué hace

1. **Scraping automático** - N8N consulta el RSS de ARCE periódicamente
2. **Extracción de datos** - Scraper obtiene detalles, archivos y aclaraciones
3. **Deduplicación** - Detecta llamados ya procesados en PostgreSQL
4. **Análisis IA** - Modelo Llama 3.1 custom analiza relevancia para aluminio
5. **Dashboard** - Visualización web con filtros, ordenamiento y feedback

## Arquitectura

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────────┐
│   ARCE Web      │────▶│     N8N      │────▶│   PostgreSQL    │
│ (RSS + Scraper) │     │ (workflow)   │     │   (datos)       │
└─────────────────┘     └──────────────┘     └────────┬────────┘
                                                      │
                        ┌─────────────────────────────┼─────────────────────────────┐
                        │                             │                             │
                        ▼                             ▼                             ▼
               ┌─────────────────┐          ┌─────────────────┐          ┌─────────────────┐
               │ Análisis Batch  │          │    Dashboard    │          │   Ollama IA     │
               │ (procesar_*.sh) │─────────▶│   (Express.js)  │◀─────────│ (Llama 3.1)     │
               └─────────────────┘          └─────────────────┘          └─────────────────┘
```

## Estado del Proyecto

| Componente | Estado | Descripción |
|------------|--------|-------------|
| Workflow N8N | Funcional | Scraping RSS, extracción, guardado en BD |
| Modelo IA Ollama | Funcional | Prompt optimizado, respuesta JSON |
| Script Análisis Batch | Funcional | Chunking para documentos grandes |
| Dashboard Web | Funcional | Vista grilla/lista, filtros, feedback |
| Base de Datos | Funcional | Vistas, triggers, prioridad automática |

## Quick Start

### Prerrequisitos

- Docker y Docker Compose
- Ollama con modelo `arce-licitaciones:latest`
- Node.js 18+ (para dashboard)
- PostgreSQL 16

### 1. Configurar base de datos

```bash
psql -h localhost -U n8n -d n8n -f schema.sql
```

### 2. Crear modelo IA

```bash
ollama create arce-licitaciones -f models/modelfile-arce-v2
```

### 3. Instalar dependencias del sistema

```bash
# Fedora
sudo dnf install -y poppler-utils pandoc tesseract tesseract-langpack-spa antiword jq

# Ubuntu/Debian
sudo apt install -y poppler-utils pandoc tesseract-ocr tesseract-ocr-spa antiword jq
```

### 4. Ejecutar dashboard

```bash
cd "Dashboard Licitaciones IA"
cp .env.example .env
# Editar .env con credenciales de PostgreSQL
npm install
node server.js
```

Dashboard disponible en `http://localhost:3000`

### 5. Ejecutar análisis batch

```bash
chmod +x procesar_analisis_batch.sh
./procesar_analisis_batch.sh
```

## Estructura del Proyecto

```
N8N/
├── Dashboard Licitaciones IA/    # Aplicación web
│   ├── public/
│   │   ├── index.html
│   │   ├── app.js
│   │   └── styles.css
│   ├── server.js
│   ├── package.json
│   └── Dockerfile
├── procesar_analisis_batch.sh    # Script de análisis IA
├── schema.sql                    # Esquema de base de datos
├── README.md                     # Este archivo
├── README-DATABASE.md            # Documentación de BD
└── README-WORKFLOW-BASH.md       # Documentación del script batch
```

## Características

### Dashboard
- Vista grilla y lista
- Filtros por estado y relevancia
- Ordenamiento múltiple (urgencia, confianza, fecha, título)
- Búsqueda por texto
- Modal de detalle con archivos y aclaraciones
- Formulario de feedback humano

### Análisis IA
- Extracción multi-formato (PDF, DOC, DOCX, ODT, XLS, etc.)
- Chunking automático para documentos grandes
- Detección de materiales del rubro aluminio
- Extracción de información de visita técnica
- Identificación de formularios requeridos

### Base de Datos
- Búsqueda full-text en español
- Cálculo automático de prioridad (urgencia + confianza + visita)
- Triggers para mantener datos actualizados
- Vista consolidada para el dashboard

## Ejemplo de Respuesta IA

```json
{
  "descripcion_llamado": "Suministro e instalación de ventanas de aluminio con DVH",
  "es_relevante": true,
  "confianza": 95,
  "razon": "Proyecto de carpintería de aluminio con 45 ventanas y DVH",
  "materiales_detectados": ["aluminio", "DVH", "vidrio"],
  "resumen_trabajo": "Instalación de aberturas en edificio institucional",
  "ubicacion_obra": "Montevideo, Ciudad Vieja",
  "requiere_visita": true,
  "ubicacion_visita": "Rincón 528",
  "fecha_visita_especifica": "2025-11-25",
  "contacto_visita_nombre": "Arq. García",
  "contacto_visita_telefono": "2915 1234",
  "formularios_requeridos": [
    {"nombre": "Anexo I - Cotización", "obligatorio": true, "seccion": "Anexo I"},
    {"nombre": "Declaración Jurada", "obligatorio": true, "seccion": "Anexo II"}
  ]
}
```

## Configuración

### Variables de entorno (Dashboard)

```env
PGHOST=localhost
PGPORT=5432
PGDATABASE=n8n
PGUSER=n8n
PGPASSWORD=tu_password
PORT=3000
```

### Variables del script batch

Editar al inicio de `procesar_analisis_batch.sh`:

```bash
TMP_DIR="/home/n8n/ARCE-LICITACIONES-IA/tmp"
OLLAMA_URL="http://192.168.56.1:11434/api/generate"
OLLAMA_MODEL="arce-licitaciones:latest"
DB_HOST="postgres"
DB_NAME="n8n"
```

## Deployment con Docker

```bash
cd "Dashboard Licitaciones IA"
docker build -t dashboard-licitaciones .
docker run -d --name dashboard \
  -p 3000:3000 \
  --env-file .env \
  dashboard-licitaciones
```

## Tech Stack

- **IA**: Ollama (Llama 3.1:8b custom)
- **Orquestación**: N8N workflows
- **Base de datos**: PostgreSQL 16
- **Backend**: Node.js + Express
- **Frontend**: Vanilla JS + CSS
- **Extracción texto**: pdftotext, pandoc, tesseract OCR
- **Infraestructura**: Docker

## Documentación

- [README-DATABASE.md](README-DATABASE.md) - Esquema completo de PostgreSQL
- [README-WORKFLOW-BASH.md](README-WORKFLOW-BASH.md) - Script de análisis batch

## Licencia

MIT License

---

**Autor:** Sebastián Viglione
[LinkedIn](https://linkedin.com/in/sebaviglione) · [GitHub](https://github.com/sebaviglione)
