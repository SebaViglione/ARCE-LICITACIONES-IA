# Workflow de Análisis IA con Script Bash

Sistema de análisis automático de pliegos de licitación usando Ollama como motor de IA local.

## Descripción

El script `procesar_analisis_batch.sh` procesa archivos adjuntos de licitaciones pendientes de análisis, extrae el texto, lo envía a Ollama para análisis con IA y guarda los resultados en PostgreSQL.

## Arquitectura

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────┐
│   PostgreSQL    │────▶│ procesar_batch   │────▶│   Ollama    │
│  (archivos      │     │     .sh          │     │  (análisis) │
│   pendientes)   │◀────│                  │◀────│             │
└─────────────────┘     └──────────────────┘     └─────────────┘
                               │
                               ▼
                        ┌──────────────┐
                        │ extract_text │
                        │     .sh      │
                        └──────────────┘
```

## Requisitos

### Software
- PostgreSQL con acceso desde el contenedor/host
- Ollama corriendo con modelo `arce-licitaciones:latest`
- Herramientas de línea de comandos: `jq`, `curl`, `wget`, `psql`
- Script `extract_text.sh` para extracción de texto de documentos

### Dependencias del script de extracción
- `pdftotext` (poppler-utils)
- `antiword` o `catdoc` (para .doc)
- `pandoc` (para .docx, .odt)
- `unzip` (para archivos comprimidos)
- `ssconvert` (gnumeric, para .xlsx/.xls/.ods)

## Configuración

Editar las variables al inicio del script:

```bash
# Directorios
TMP_DIR="/home/n8n/ARCE-LICITACIONES-IA/tmp"
EXTRACT_SCRIPT="/home/n8n/ARCE-LICITACIONES-IA/scripts/extract_text.sh"

# Ollama
OLLAMA_URL="http://192.168.56.1:11434/api/generate"
OLLAMA_MODEL="arce-licitaciones:latest"

# Base de datos PostgreSQL
DB_HOST="postgres"
DB_PORT="5432"
DB_NAME="n8n"
DB_USER="n8n"
DB_PASS="n8n_secure_password_2024"

# Chunking (para documentos grandes)
MAX_CHARS=10000       # Límite antes de activar chunking
CHUNK_SIZE=8000       # Tamaño de cada fragmento
CHUNK_OVERLAP=500     # Solapamiento entre chunks
DEBUG=false           # Guardar JSONs de debug
```

## Uso

### Ejecución manual

```bash
chmod +x procesar_analisis_batch.sh
./procesar_analisis_batch.sh
```

### Desde N8N

Usar un nodo "Execute Command" con:

```bash
/home/n8n/ARCE-LICITACIONES-IA/procesar_analisis_batch.sh
```

### Programación con cron

```bash
# Ejecutar cada hora
0 * * * * /home/n8n/ARCE-LICITACIONES-IA/procesar_analisis_batch.sh >> /var/log/analisis_ia.log 2>&1
```

## Flujo de procesamiento

1. **Consulta archivos pendientes**: Busca en `archivos_adjuntos` los que no tienen entrada en `analisis_ia`
2. **Descarga**: Obtiene el archivo desde `archivo_url` con wget
3. **Extracción de texto**: Usa `extract_text.sh` para convertir el documento a texto plano
4. **Análisis con Ollama**:
   - Documentos pequeños (< 10.000 chars): análisis directo
   - Documentos grandes: chunking con síntesis final
5. **Guardado en BD**: Inserta/actualiza en tabla `analisis_ia`
6. **Limpieza**: Elimina archivos temporales

## Campos analizados

El script extrae:

| Campo | Descripción |
|-------|-------------|
| `descripcion_llamado` | Resumen en ≤150 caracteres |
| `es_relevante` | true/false - ¿Es relevante para empresa de aluminio? |
| `confianza` | 0-100 - Nivel de certeza del análisis |
| `razon` | Explicación de la relevancia/irrelevancia |
| `materiales_detectados` | Array JSON de materiales encontrados |
| `resumen_trabajo` | Descripción del trabajo requerido |
| `ubicacion_obra` | Dirección/ubicación de la obra |
| `requiere_visita` | true/false |
| `ubicacion_visita` | Dónde es la visita técnica |
| `fecha_visita_especifica` | Fecha de la visita (YYYY-MM-DD) |
| `coordina_visita` | true/false - ¿Se debe coordinar? |
| `contacto_visita_nombre` | Nombre del contacto |
| `contacto_visita_telefono` | Teléfono del contacto |
| `contacto_visita_correo` | Email del contacto |
| `formularios_requeridos` | Array JSON de formularios a presentar |

## Salida JSON

El script retorna un JSON con el resumen de la ejecución:

```json
{
  "mensaje": "Procesamiento completado: 5 exitosos, 1 errores",
  "total_archivos": 6,
  "exitosos": 5,
  "con_errores": 1,
  "resultados_ok": [
    {
      "llamado_id": "1295069",
      "archivo": "pliego.pdf",
      "es_relevante": true,
      "confianza": 92,
      "descripcion_llamado": "Suministro de puertas de aluminio",
      "materiales_detectados": ["aluminio", "vidrio DVH"],
      "formularios_requeridos": [
        {"nombre": "Anexo I - Cotización", "obligatorio": true, "seccion": "Anexo I"}
      ]
    }
  ],
  "resultados_error": [
    {
      "llamado_id": "1295070",
      "archivo": "documento.pdf",
      "error": "Error al extraer texto"
    }
  ],
  "fecha_proceso": "2025-11-19T15:30:00Z"
}
```

## Sistema de Chunking

Para documentos grandes (> 10.000 caracteres), el script:

1. Divide el texto en fragmentos de 8.000 caracteres
2. Analiza cada chunk individualmente buscando:
   - Materiales
   - Ubicación
   - Información de visita técnica
   - Formularios requeridos
3. Sintetiza todos los análisis parciales en un JSON final unificado

Esto permite analizar pliegos de gran tamaño sin exceder los límites del modelo.

## Tablas de base de datos requeridas

### `archivos_adjuntos`
```sql
CREATE TABLE archivos_adjuntos (
  id SERIAL PRIMARY KEY,
  llamado_id VARCHAR NOT NULL,
  nombre VARCHAR NOT NULL,
  tipo VARCHAR,
  archivo_url VARCHAR
);
```

### `llamados`
```sql
CREATE TABLE llamados (
  id VARCHAR PRIMARY KEY,
  titulo VARCHAR,
  fecha_apertura DATE,
  estado VARCHAR
);
```

### `analisis_ia`
```sql
CREATE TABLE analisis_ia (
  id SERIAL PRIMARY KEY,
  llamado_id VARCHAR NOT NULL,
  archivo_analizado VARCHAR NOT NULL,
  descripcion_llamado TEXT,
  es_relevante BOOLEAN,
  confianza INTEGER,
  razon TEXT,
  materiales_detectados JSONB,
  resumen_trabajo TEXT,
  ubicacion_obra VARCHAR,
  requiere_visita BOOLEAN,
  ubicacion_visita VARCHAR,
  fecha_visita_especifica DATE,
  coordina_visita BOOLEAN,
  contacto_visita_nombre VARCHAR,
  contacto_visita_telefono VARCHAR,
  contacto_visita_correo VARCHAR,
  formularios_requeridos JSONB,
  analizado_en TIMESTAMP DEFAULT NOW(),
  UNIQUE(llamado_id, archivo_analizado)
);
```

## Logs

El script envía logs a stderr con formato:

```
[2025-11-19 15:30:00] Iniciando procesamiento batch de análisis IA
[2025-11-19 15:30:01] ✓ Encontrados 6 archivos para procesar
[2025-11-19 15:30:02] [1/6] Procesando: pliego.pdf (llamado 1295069)
[2025-11-19 15:30:02]   → Descargando archivo...
[2025-11-19 15:30:03]   ✓ Archivo descargado
[2025-11-19 15:30:03]   → Extrayendo texto...
[2025-11-19 15:30:04]   ✓ Texto extraído
[2025-11-19 15:30:04]   → Analizando con IA (documento pequeño: 5432 chars)...
[2025-11-19 15:30:15]   ✓ Análisis completado
[2025-11-19 15:30:15]   → Guardando en base de datos...
[2025-11-19 15:30:15]   ✓ Guardado en BD
```

## Troubleshooting

### Error: "Ollama no retornó respuesta válida"
- Verificar que Ollama esté corriendo: `curl http://192.168.56.1:11434/api/tags`
- Verificar que el modelo existe: `ollama list`
- Aumentar timeout en curl si el documento es muy grande

### Error: "Error al extraer texto"
- Verificar que `extract_text.sh` existe y es ejecutable
- Instalar dependencias faltantes (pdftotext, pandoc, etc.)
- Verificar permisos del directorio TMP_DIR

### Error: "Error al insertar en BD"
- Verificar credenciales de PostgreSQL
- Verificar que las tablas existen
- Revisar el log de PostgreSQL para más detalles

### Archivos no se procesan
- Verificar que `l.estado = 'activo'` en la tabla `llamados`
- Verificar que el tipo de archivo está en la lista permitida
- Verificar que `archivo_url` no es NULL

## Archivos relacionados

- `procesar_analisis_batch.sh` - Script principal
- `extract_text.sh` - Extractor de texto de documentos
- `cleanup_tmp.sh` - Limpieza de archivos temporales
- `install_dependencies.sh` - Instalación de dependencias

## Modelo de Ollama

El modelo `arce-licitaciones:latest` debe estar entrenado/configurado para:

- Identificar materiales del rubro aluminio
- Extraer información estructurada de pliegos
- Responder en formato JSON válido
- Identificar formularios requeridos para presentación

Puede basarse en modelos como `llama3` o `mistral` con un system prompt especializado.
