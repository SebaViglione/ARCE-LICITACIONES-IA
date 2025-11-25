# ARCE Licitaciones IA

Sistema automatizado de monitoreo y análisis de licitaciones estatales uruguayas (ARCE) para el rubro aluminio, usando IA local con Ollama.

## Descripción

El sistema monitorea automáticamente el portal de Compras Estatales de Uruguay, descarga los pliegos de licitación, los analiza con IA para determinar relevancia para empresas de aluminio/vidrio/aberturas, y presenta los resultados en un dashboard interactivo.

## Características Principales

- **Scraping automático**: Monitoreo continuo del RSS de ARCE
- **Extracción inteligente**: Soporte multi-formato (PDF, DOC, DOCX, XLS, ZIP, etc.)
- **Análisis con IA**: Modelo Llama 3.1 personalizado para el rubro aluminio
- **Chunking automático**: Procesamiento de documentos grandes
- **Análisis fallback**: Análisis basado en metadatos cuando los archivos no son extraíbles
- **Dashboard web**: Interfaz amigable con filtros y búsqueda
- **Detección de visitas técnicas**: Extracción automática de fechas, ubicaciones y contactos

## Arquitectura

```
                                 ARCE-LICITACIONES-IA

┌──────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│  ┌─────────────┐         ┌─────────────┐         ┌─────────────┐             │
│  │   ARCE Web  │         │     N8N     │         │ PostgreSQL  │             │
│  │   (RSS +    │───────▶│  Workflow   │───────▶│   Base de   │             │
│  │   Scraper)  │         │ Orquestador │         │    Datos    │             │
│  └─────────────┘         └─────────────┘         └──────┬──────┘             │
│                                                         │                    │
│                  ┌───────────────────────────────┬──────┴─────────┐          │
│                  │                               │                │          │
│                  ▼                               ▼                ▼          │
│           ┌───────────────┐            ┌────────────────┐  ┌─────────────┐   │
│           │ Procesamiento │            │   Dashboard    │  │  Ollama IA  │   │
│           │      IA       │─────────▶ │   Web (UI)     │◀│ Llama 3.1   │   │
│           │ Shell Scripts │            │  Express.js    │  │     8b      │   │
│           └───────────────┘            └────────────────┘  └─────────────┘   │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘

Flujo de datos:
1. N8N consulta RSS de ARCE cada 15 minutos
2. Scraper extrae detalles de licitaciones nuevas
3. Datos se guardan en PostgreSQL
4. Procesamiento IA analiza archivos con Ollama
5. Dashboard muestra resultados en tiempo real
```

## Estructura del Proyecto

```
ARCE-LICITACIONES-IA/
├── src/                      # Código fuente
│   ├── scraper/             # Web scraper (Puppeteer)
│   │   ├── scrape_arce.js
│   │   ├── package.json
│   │   └── README.md
│   ├── dashboard/           # Dashboard web
│   │   ├── server.js        # Backend Express
│   │   ├── public/          # Frontend
│   │   ├── Dockerfile
│   │   └── README.md
│   ├── n8n/                 # N8N workflows y config
│   │   ├── Dockerfile
│   │   ├── workflows/
│   │   └── README.md
│   ├── processing/          # Scripts de procesamiento IA
│   │   ├── procesar_analisis_batch.sh
│   │   ├── extract_text.sh
│   │   ├── extract_im_html.sh
│   │   └── README-ANALISIS-BATCH.md
│   └── .data/              # Datos runtime (ignorado en git)
│       └── tmp/
├── database/                # Schemas y migraciones SQL
│   ├── scheme.sql
│   ├── create_dashboard_view.sql
│   ├── init_views.sh
│   └── README.md
├── scripts/                 # Scripts de utilidad
│   ├── restart_containers.sh
│   ├── fix_ollama.sh
│   └── diagnose_volumes.sh
├── docker-compose.yml       # Orquestación de contenedores
├── .env.example            # Plantilla de variables de entorno
├── .gitignore
├── LICENSE
└── README.md               # Este archivo
```

## Quick Start

### Prerrequisitos

- Docker y Docker Compose
- Ollama con modelo `llama3.1:8b`
- 8GB RAM mínimo
- 20GB espacio en disco

### 1. Clonar y configurar

```bash
git clone https://github.com/sebaviglione/ARCE-LICITACIONES-IA.git
cd ARCE-LICITACIONES-IA
cp .env.example .env
# Editar .env con tus configuraciones
```

### 2. Iniciar servicios

```bash
docker-compose up -d
```

Esto iniciará:
- PostgreSQL (puerto 5432)
- N8N (puerto 5678)
- Dashboard (puerto 3000)

### 3. Inicializar base de datos

```bash
# Crear tablas y vistas
docker exec -i n8n_postgres psql -U n8n -d n8n < database/scheme.sql
sh database/init_views.sh
```

### 4. Configurar Ollama

Asegúrate de que Ollama esté corriendo con el modelo `llama3.1:8b`:

```bash
# Verificar Ollama
curl http://172.17.0.1:11434/api/tags

# Si no está el modelo
ollama pull llama3.1:8b
```

### 5. Acceder a las interfaces

- **Dashboard**: http://localhost:3000
- **N8N**: http://localhost:5678
- **PostgreSQL**: localhost:5432

## Uso

### Procesamiento Manual de Archivos Pendientes

```bash
# Ejecutar análisis de archivos pendientes
docker exec n8n_app sh /home/n8n/ARCE-LICITACIONES-IA/processing/procesar_analisis_batch.sh
```

### Workflow Automático

El workflow de N8N se ejecuta automáticamente cada 15 minutos:

1. **RSS Trigger**: Lee el feed RSS de ARCE
2. **Scraper**: Extrae detalles de nuevos llamados
3. **Deduplicación**: Verifica si ya existe en la BD
4. **Guardado**: Inserta en PostgreSQL
5. **Análisis IA**: Procesa archivos y analiza relevancia

### Consultar Datos

```bash
# Ver llamados recientes
docker exec n8n_postgres psql -U n8n -d n8n -c "SELECT id, titulo, estado FROM llamados ORDER BY fecha_publicacion DESC LIMIT 10;"

# Ver análisis IA
docker exec n8n_postgres psql -U n8n -d n8n -c "SELECT llamado_id, es_relevante, confianza, razon FROM analisis_ia WHERE es_relevante = true;"
```

## Módulos

### Scraper ([src/scraper/README.md](src/scraper/README.md))

Web scraper con Puppeteer que extrae:
- Título, descripción, fechas
- Archivos adjuntos (pliegos, formularios)
- Items y aclaraciones

### Dashboard ([src/dashboard/README.md](src/dashboard/README.md))

Interfaz web con:
- Vista grilla/lista
- Filtros por relevancia y estado
- Búsqueda full-text
- Modal de detalles con archivos
- Sistema de feedback

### Procesamiento IA ([src/processing/README-ANALISIS-BATCH.md](src/processing/README-ANALISIS-BATCH.md))

Scripts de análisis que:
- Extraen texto de múltiples formatos
- Procesan documentos grandes con chunking
- Analizan con Ollama (Llama 3.1)
- Crean análisis fallback para archivos no extraíbles

### N8N Workflows ([src/n8n/README.md](src/n8n/README.md))

Workflows de automatización:
- Monitoreo RSS cada 15 minutos
- Orquestación del scraping
- Trigger de análisis IA

### Base de Datos ([database/README.md](database/README.md))

Schema PostgreSQL con:
- Tablas normalizadas
- Vistas optimizadas para el dashboard
- Triggers automáticos
- Full-text search en español

## Variables de Entorno

```env
# PostgreSQL
POSTGRES_USER=n8n
POSTGRES_PASSWORD=n8n_secure_password_2024
POSTGRES_DB=n8n

# N8N
N8N_HOST=localhost
N8N_PORT=5678
N8N_PROTOCOL=http
WEBHOOK_URL=http://localhost:5678/

# Ollama
OLLAMA_HOST=http://172.17.0.1:11434

# Timezone
GENERIC_TIMEZONE=America/Montevideo
TZ=America/Montevideo
```

## Ejemplo de Análisis IA

```json
{
  "descripcion_llamado": "Suministro e instalación de ventanas de aluminio con DVH",
  "es_relevante": true,
  "confianza": 0.95,
  "razon": "Proyecto de carpintería de aluminio con 45 ventanas y DVH",
  "materiales_detectados": ["aluminio", "DVH", "vidrio"],
  "resumen_trabajo": "Instalación de aberturas en edificio institucional",
  "ubicacion_obra": "Montevideo, Ciudad Vieja",
  "requiere_visita": true,
  "ubicacion_visita": "Rincón 528",
  "fecha_visita_especifica": "2025-12-15",
  "coordina_visita": false,
  "contacto_visita_nombre": "Arq. García",
  "contacto_visita_telefono": "+598 2915 1234",
  "contacto_visita_correo": "garcia@ejemplo.gub.uy",
  "formularios_requeridos": [
    {"nombre": "Anexo I - Cotización", "obligatorio": true, "seccion": "Anexo I"},
    {"nombre": "Declaración Jurada", "obligatorio": true, "seccion": "Anexo II"}
  ]
}
```

## Troubleshooting

### Dashboard no muestra datos

```bash
# Verificar vista existe
sh database/init_views.sh

# Ver logs
docker logs n8n_dashboard
```

### Análisis IA no funciona

```bash
# Verificar Ollama
curl http://172.17.0.1:11434/api/tags

# Ver logs de N8N
docker logs n8n_app

# Ejecutar análisis manualmente
docker exec n8n_app sh /home/n8n/ARCE-LICITACIONES-IA/processing/procesar_analisis_batch.sh
```

### Extracción de PDF falla

```bash
# Verificar dependencias instaladas en el contenedor
docker exec n8n_app which pdftotext tesseract pandoc

# Ver logs detallados
docker exec n8n_app sh /home/n8n/ARCE-LICITACIONES-IA/processing/test_extract.sh <archivo.pdf>
```

## Tech Stack

- **IA**: Ollama (Llama 3.1:8b)
- **Orquestación**: N8N workflows
- **Base de datos**: PostgreSQL 16
- **Backend**: Node.js + Express
- **Frontend**: Vanilla JS + CSS
- **Scraping**: Puppeteer
- **Extracción texto**: pdftotext, pandoc, tesseract OCR, antiword
- **Infraestructura**: Docker + Docker Compose

## Desarrollo

### Contribuir

1. Fork el repositorio
2. Crea una rama feature (`git checkout -b feature/nueva-funcionalidad`)
3. Commit tus cambios (`git commit -am 'Agrega nueva funcionalidad'`)
4. Push a la rama (`git push origin feature/nueva-funcionalidad`)
5. Abre un Pull Request

### Testing

```bash
# Test scraper
cd src/scraper
npm test

# Test dashboard
cd src/dashboard
npm test

# Test extracción
sh src/processing/test_extract.sh archivo.pdf
```

## Roadmap

- [ ] Notificaciones por email de licitaciones relevantes
- [ ] Exportación a Excel/CSV
- [ ] API REST pública
- [ ] Modelo de IA fine-tuned específico para licitaciones
- [ ] Soporte para otros rubros (construcción, IT, etc.)
- [ ] App móvil
- [ ] Integración con calendarios (iCal/Google Calendar)

## Licencia

Apache 2.0 - Ver [LICENSE](LICENSE)

## Autor

**Sebastián Viglione**

- [LinkedIn](https://linkedin.com/in/sebaviglione)
- [GitHub](https://github.com/sebaviglione)

## Agradecimientos

- Portal ARCE de Uruguay por proveer los datos públicos
- Comunidad de Ollama
- Equipo de N8N

---

**Nota**: Este sistema está diseñado para uso legítimo de scraping de datos públicos del portal ARCE. Respeta las políticas de uso del sitio web y no abuses de los servicios.
