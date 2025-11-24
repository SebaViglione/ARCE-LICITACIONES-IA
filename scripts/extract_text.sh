#!/bin/sh
# ================================================================
# Script: extract_text.sh
# Descripción: Extrae texto de archivos adjuntos de licitaciones ARCE
# Uso: ./extract_text.sh "nombre_archivo.ext" "llamado_id"
# ================================================================

# --- Parámetros ---
NOMBRE_ARCHIVO="$1"
LLAMADO_ID="$2"

# --- Validación de parámetros ---
if [ -z "$NOMBRE_ARCHIVO" ] || [ -z "$LLAMADO_ID" ]; then
  echo '{"error": "Faltan parámetros: nombre_archivo y llamado_id son requeridos"}' >&2
  exit 1
fi

# --- Directorios base ---
BASE_DIR="/home/n8n/ARCE-LICITACIONES-IA/tmp"
ARCHIVO="$BASE_DIR/$NOMBRE_ARCHIVO"

# Intentar ruta alternativa (por compatibilidad futura)
if [ ! -f "$ARCHIVO" ]; then
  ALT_PATH="$BASE_DIR/${NOMBRE_ARCHIVO}"
  if [ -f "$ALT_PATH" ]; then
    ARCHIVO="$ALT_PATH"
  fi
fi

# --- Verificar existencia del archivo ---
if [ ! -f "$ARCHIVO" ]; then
  echo "{\"error\": \"Archivo no encontrado: $ARCHIVO\", \"llamado_id\": \"$LLAMADO_ID\", \"archivo_analizado\": \"$NOMBRE_ARCHIVO\"}"
  exit 1
fi

# --- Detección de extensión ---
EXT=$(printf '%s\n' "${NOMBRE_ARCHIVO##*.}" | tr '[:upper:]' '[:lower:]')

# --- Verificación de herramientas (solo avisos, no rompen ejecución) ---
command -v pdftotext >/dev/null 2>&1 || echo "[WARN] pdftotext no instalado" >&2
command -v antiword  >/dev/null 2>&1 || echo "[WARN] antiword no instalado" >&2
command -v pandoc    >/dev/null 2>&1 || echo "[WARN] pandoc no instalado" >&2
command -v tesseract >/dev/null 2>&1 || echo "[WARN] tesseract no instalado" >&2
command -v unzip     >/dev/null 2>&1 || echo "[WARN] unzip no instalado" >&2

# --- Función principal de extracción ---
extraer_texto() {
  extension="$1"
  texto=""
  TMPDIR=""
  archivos_internos=""

  case "$extension" in
    # ----------------------------------------------------------
    pdf)
      texto=$(pdftotext "$ARCHIVO" - 2>/dev/null || true)

      # Si casi no hay texto, intento OCR con tesseract
      if [ -z "$texto" ] || [ "$(printf '%s' "$texto" | wc -c | tr -d ' ')" -lt 50 ]; then
        texto=$(tesseract "$ARCHIVO" - -l spa 2>/dev/null || true)
      fi

      if [ -z "$texto" ]; then
        printf '%s\n' "ERROR_PDF_NO_EXTRAIBLE"
        return 1
      fi
      ;;

    # ----------------------------------------------------------
    doc)
      texto=$(antiword "$ARCHIVO" 2>/dev/null || true)
      if [ -z "$texto" ]; then
        texto=$(pandoc "$ARCHIVO" -t plain 2>/dev/null || true)
      fi
      if [ -z "$texto" ]; then
        printf '%s\n' "ERROR_DOC_NO_EXTRAIBLE"
        return 1
      fi
      ;;

    # ----------------------------------------------------------
    docx|rtf)
      # SOLO pandoc para DOCX/RTF
      texto=$(pandoc "$ARCHIVO" -t plain 2>/dev/null || true)

      if [ -z "$texto" ]; then
        printf '%s\n' "ERROR_DOCX_NO_EXTRAIBLE"
        return 1
      fi
      ;;

    # ----------------------------------------------------------
    odt)
      texto=$(pandoc "$ARCHIVO" -t plain 2>/dev/null || true)
      if [ -z "$texto" ]; then
        printf '%s\n' "ERROR_ODT_NO_EXTRAIBLE"
        return 1
      fi
      ;;

    # ----------------------------------------------------------
    ods|xls|xlsx)
      texto=$(pandoc "$ARCHIVO" -t plain 2>/dev/null || true)
      if [ -z "$texto" ]; then
        printf '%s\n' "ERROR_EXCEL_NO_EXTRAIBLE"
        return 1
      fi
      ;;

    # ----------------------------------------------------------
    txt)
      texto=$(cat "$ARCHIVO" 2>/dev/null || true)
      ;;

    # ----------------------------------------------------------
    zip)
      TMPDIR="/home/n8n/ARCE-LICITACIONES-IA/tmp/arce/extract_${LLAMADO_ID}_$$"
      mkdir -p "$TMPDIR"

      unzip -q "$ARCHIVO" -d "$TMPDIR" 2>/dev/null || true

      archivos_internos=$(find "$TMPDIR" -type f \( -iname '*.pdf' -o -iname '*.doc' -o -iname '*.docx' -o -iname '*.odt' -o -iname '*.txt' -o -iname '*.xls' -o -iname '*.xlsx' \) 2>/dev/null)

      if [ -n "$archivos_internos" ]; then
        (
          for archivo_interno in $archivos_internos; do
            ext_interno=$(printf '%s\n' "${archivo_interno##*.}" | tr '[:upper:]' '[:lower:]')
            case "$ext_interno" in
              pdf)       pdftotext "$archivo_interno" - 2>/dev/null || true ;;
              doc)       antiword "$archivo_interno" 2>/dev/null || true ;;
              docx|odt)  pandoc "$archivo_interno" -t plain 2>/dev/null || true ;;
              xls|xlsx)  pandoc "$archivo_interno" -t plain 2>/dev/null || true ;;
              txt)       cat "$archivo_interno" 2>/dev/null || true ;;
            esac
            printf '\n--- Fin archivo: %s ---\n\n' "$(basename "$archivo_interno")"
          done
        ) > "/tmp/zip_content_$$"
        texto=$(cat "/tmp/zip_content_$$" 2>/dev/null || true)
        rm -f "/tmp/zip_content_$$"
      fi

      rm -rf "$TMPDIR"

      if [ -z "$texto" ]; then
        printf '%s\n' "ERROR_ZIP_SIN_CONTENIDO_EXTRAIBLE"
        return 1
      fi
      ;;

    # ----------------------------------------------------------
    jpg|jpeg|png|tiff|tif|bmp)
      texto=$(tesseract "$ARCHIVO" - -l spa 2>/dev/null || true)
      if [ -z "$texto" ]; then
        printf '%s\n' "ERROR_OCR_FALLO"
        return 1
      fi
      ;;

    # ----------------------------------------------------------
    rar|7z|tar|gz)
      printf '%s\n' "ERROR_FORMATO_COMPRIMIDO_NO_SOPORTADO"
      return 1
      ;;

    # ----------------------------------------------------------
    *)
      printf '%s\n' "ERROR_FORMATO_DESCONOCIDO"
      return 1
      ;;
  esac

  printf '%s\n' "$texto"
  return 0
}

# --- Ejecución ---
TEXTO_EXTRAIDO=$(extraer_texto "$EXT")
EXITCODE=$?

# --- Manejo de errores / códigos especiales ---
ERROR_MSG="null"

case "$TEXTO_EXTRAIDO" in
  ERROR_*)
    ERROR_MSG="\"$TEXTO_EXTRAIDO\""
    TEXTO_EXTRAIDO=""
    ;;
  *)
    if [ "$EXITCODE" -ne 0 ]; then
      if [ -z "$TEXTO_EXTRAIDO" ]; then
        ERROR_MSG="\"ERROR_EXTRACCION_DESCONOCIDA\""
      else
        ERROR_MSG="\"ERROR_EXTRACCION_CODIGO_${EXITCODE}\""
      fi
      TEXTO_EXTRAIDO=""
    fi
    ;;
esac

# --- Limpieza de texto para JSON (mínima, sin tocar letras) ---
TEXTO_LIMPIO=$(
  printf '%s' "$TEXTO_EXTRAIDO" \
    | sed 's/\\/\\\\/g; s/"/\\"/g' \
    | tr '\n' ' ' \
    | tr -s ' '
)

len=$(printf '%s' "$TEXTO_LIMPIO" | wc -c | tr -d ' ')

# --- Limitar longitud (por seguridad) ---
if [ "$len" -gt 50000 ]; then
  TEXTO_LIMPIO=$(printf '%s' "$TEXTO_LIMPIO" | cut -c1-50000)
  TEXTO_LIMPIO="${TEXTO_LIMPIO}... [TEXTO TRUNCADO]"
  len=50000
fi

# --- Salida JSON final ---
cat <<EOF
{
  "llamado_id": "$LLAMADO_ID",
  "archivo_analizado": "$NOMBRE_ARCHIVO",
  "tipo_archivo": "$EXT",
  "texto_extraido": "$TEXTO_LIMPIO",
  "longitud_texto": $len,
  "errores_extraccion": $ERROR_MSG
}
EOF

exit 0

