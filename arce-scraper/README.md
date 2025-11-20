# ARCE Scraper

Script de web scraping para extraer información detallada de licitaciones desde el portal de Compras Estatales de Uruguay.

## Descripción

El scraper utiliza Puppeteer para navegar al detalle de cada licitación y extraer:
- Aclaraciones publicadas
- Archivos adjuntos (pliegos, anexos, planos)
- Ítems del llamado

## Uso

```bash
node scrape_arce.js <URL_DETALLE> [ID_LLAMADO]
```

### Parámetros

| Parámetro | Requerido | Descripción |
|-----------|-----------|-------------|
| `URL_DETALLE` | Sí | URL completa del detalle del llamado |
| `ID_LLAMADO` | No | ID para identificar el llamado en la salida |

### Ejemplo

```bash
node scrape_arce.js "https://www.comprasestatales.gub.uy/consultas/detalle/id/1295069" "1295069"
```

## Salida JSON

El script imprime un objeto JSON a stdout con la siguiente estructura:

```json
{
  "id": "1295069",
  "departamento": "Montevideo",
  "division": "División Arquitectura",
  "servicio": "Intendencia de Montevideo",
  "numero_llamado": "145/2025",
  "tipo_compra": "Licitación Abreviada",
  "aclaraciones": [
    {
      "fecha": "2025-11-19",
      "hora": "10:35",
      "texto": "Se agregaron planos actualizados del edificio",
      "archivo_url": "https://www.comprasestatales.gub.uy/files/aclaracion.pdf"
    }
  ],
  "archivos_adjuntos": [
    {
      "nombre": "pliego_145_2025.pdf",
      "tipo": "pdf",
      "archivo_url": "https://www.comprasestatales.gub.uy/files/pliego_145_2025.pdf",
      "label": "Pliego de condiciones particulares"
    },
    {
      "nombre": "anexo_tecnico.docx",
      "tipo": "docx",
      "archivo_url": "https://www.comprasestatales.gub.uy/files/anexo_tecnico.docx",
      "label": "Especificaciones técnicas"
    }
  ],
  "items_extraidos": [
    "Ventanas de aluminio con DVH",
    "Puertas de aluminio anodizado",
    "Mamparas divisorias"
  ]
}
```

### Campos

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | string | ID del llamado (pasado como parámetro) |
| `departamento` | string/null | Departamento del organismo |
| `division` | string/null | División del organismo |
| `servicio` | string/null | Servicio u organismo licitante |
| `numero_llamado` | string/null | Número de la compra |
| `tipo_compra` | string/null | Tipo de procedimiento |
| `aclaraciones` | array | Lista de aclaraciones publicadas |
| `archivos_adjuntos` | array | Lista de archivos descargables |
| `items_extraidos` | array | Ítems/renglones del llamado |

### Tipos de archivo soportados

El scraper detecta automáticamente el tipo de archivo por extensión:
- `pdf` - Documentos PDF
- `doc`, `docx` - Documentos Word
- `xls`, `xlsx` - Hojas de cálculo
- `zip`, `rar`, `7z` - Archivos comprimidos
- `png`, `jpg`, `jpeg` - Imágenes
- `html`, `txt` - Texto
- `otro` - Otros tipos

## Requisitos

### Node.js y npm

```bash
node -v  # >= 18.0.0
npm -v   # >= 8.0.0
```

### Dependencias

```bash
npm install
```

El `package.json` incluye:
```json
{
  "dependencies": {
    "puppeteer": "^21.0.0"
  },
  "type": "module"
}
```

### Dependencias del sistema (para Puppeteer)

```bash
# Fedora
sudo dnf install -y chromium nss atk cups-libs \
  gtk3 libXcomposite libXdamage libXrandr \
  mesa-libgbm pango alsa-lib

# Ubuntu/Debian
sudo apt install -y chromium-browser libnss3 libatk1.0-0 \
  libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
  libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
  libgbm1 libpango-1.0-0 libasound2
```

## Integración con N8N

El scraper está diseñado para ser llamado desde un nodo "Execute Command" en N8N:

```bash
node /home/n8n/ARCE-LICITACIONES-IA/arce-scraper/scrape_arce.js "{{ $json.url }}" "{{ $json.id }}"
```

La salida JSON se puede parsear directamente en el siguiente nodo del workflow.

## Características técnicas

### Optimizaciones de rendimiento
- Bloquea recursos innecesarios (imágenes, fuentes, CSS)
- User-agent personalizado para evitar bloqueos
- Timeout de 60 segundos para carga de página

### Manejo de errores
- Retorna JSON con campo `error` si falla
- Los campos no encontrados se establecen como `null`
- Arrays vacíos si no hay aclaraciones/adjuntos/ítems

### Limpieza de datos
- Normaliza espacios y caracteres HTML
- Convierte URLs relativas a absolutas
- Parsea fechas al formato `YYYY-MM-DD`
- Extrae horas al formato `HH:MM`

## Ejemplo de error

Si el scraper encuentra un error, la salida será:

```json
{
  "id": "1295069",
  "departamento": null,
  "division": null,
  "servicio": null,
  "numero_llamado": null,
  "tipo_compra": null,
  "error": "Navigation timeout of 60000 ms exceeded",
  "aclaraciones": [],
  "archivos_adjuntos": [],
  "items_extraidos": []
}
```

## Notas

- Los campos `departamento`, `division`, `servicio`, `numero_llamado` y `tipo_compra` pueden quedar en `null` ya que el portal no siempre expone esta información en el HTML.
- El scraper está optimizado para la estructura actual del portal de Compras Estatales. Si el portal cambia su estructura HTML, puede requerir ajustes.
- Se recomienda respetar intervalos entre requests para no sobrecargar el servidor.

## Archivos relacionados

- `scrape_arce.js` - Script principal
- `package.json` - Dependencias del proyecto
- Workflow N8N que consume este scraper
