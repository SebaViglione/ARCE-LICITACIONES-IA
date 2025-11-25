#!/bin/bash
# ============================================
# extract_im_html.sh
# Extrae datos estructurados de HTML de Intendencia de Montevideo
# ============================================
# Uso: sh extract_im_html.sh <archivo_html> <llamado_id>
# Salida: JSON con texto_extraido, items y adjuntos

# No usar set -e porque algunos comandos pueden fallar sin ser error fatal
# set -e

# Parámetros
HTML_FILE="$1"
LLAMADO_ID="$2"

# Validar parámetros
if [ -z "$HTML_FILE" ] || [ -z "$LLAMADO_ID" ]; then
    echo '{"error": "Faltan parámetros: archivo_html y llamado_id son requeridos"}'
    exit 1
fi

if [ ! -f "$HTML_FILE" ]; then
    echo '{"error": "Archivo no encontrado: '"$HTML_FILE"'"}'
    exit 1
fi

# Leer contenido del HTML
HTML_CONTENT=$(cat "$HTML_FILE")

# Función para extraer valor de input hidden
get_hidden_value() {
    local name="$1"
    echo "$HTML_CONTENT" | grep -o "name=\"$name\"[^>]*value=\"[^\"]*\"" | sed 's/.*value="\([^"]*\)".*/\1/' | head -1
}

# Función para decodificar entidades HTML básicas
decode_html() {
    echo "$1" | sed 's/&quot;/"/g; s/&amp;/\&/g; s/&lt;/</g; s/&gt;/>/g; s/&#39;/'"'"'/g'
}

# Verificar si es HTML de redirección (primer tipo)
if echo "$HTML_CONTENT" | grep -q 'Haga click aqui para acceder'; then
    # Extraer URL de redirección
    REDIRECT_URL=$(echo "$HTML_CONTENT" | grep -o 'HREF="[^"]*"' | sed 's/HREF="\([^"]*\)"/\1/' | head -1)

    if [ -n "$REDIRECT_URL" ]; then
        # Descargar la página real usando curl con seguimiento de redirecciones
        TMP_REAL_HTML="/tmp/im_real_${LLAMADO_ID}.html"

        if curl -sL --max-time 60 \
            -H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" \
            -H "Accept-Language: es-UY,es;q=0.9,en;q=0.8" \
            -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0" \
            -o "$TMP_REAL_HTML" \
            "$REDIRECT_URL"; then

            # Verificar que se descargó contenido
            if [ -s "$TMP_REAL_HTML" ]; then
                # Usar la página real
                HTML_CONTENT=$(cat "$TMP_REAL_HTML")
                rm -f "$TMP_REAL_HTML"
            else
                rm -f "$TMP_REAL_HTML"
                echo '{"error": "Página de redirección vacía: '"$REDIRECT_URL"'"}'
                exit 1
            fi
        else
            echo '{"error": "No se pudo descargar la página de redirección: '"$REDIRECT_URL"'"}'
            exit 1
        fi
    fi
fi

# Extraer datos de los campos hidden
DEPARTAMENTO=$(get_hidden_value "Departamento")
DIVISION=$(get_hidden_value "Division")
SERVICIO=$(get_hidden_value "Servicio")
DIRECCION=$(get_hidden_value "Direccion")
PROC_COMPRA=$(get_hidden_value "ProcCompra")
NRO_COMPRA=$(get_hidden_value "NroCompra")
FECHA=$(get_hidden_value "Fecha")
FECHA_DIA=$(get_hidden_value "Fecha_Dia")
FECHA_MES=$(get_hidden_value "Fecha_Mes")
FECHA_ANIO=$(get_hidden_value "Fecha_Anio")
FECHA_HORA=$(get_hidden_value "Fecha_Hora")
FECHA_MIN=$(get_hidden_value "Fecha_Min")
CANT_ITEMS=$(get_hidden_value "CantItems")
COMENTARIOS=$(get_hidden_value "Comentarios")

# Construir fecha formateada
if [ -n "$FECHA" ]; then
    FECHA_FORMATEADA="$FECHA"
elif [ -n "$FECHA_DIA" ] && [ -n "$FECHA_MES" ] && [ -n "$FECHA_ANIO" ]; then
    FECHA_FORMATEADA="${FECHA_DIA}/${FECHA_MES}/${FECHA_ANIO} ${FECHA_HORA}:${FECHA_MIN}"
else
    FECHA_FORMATEADA=""
fi

# Extraer items del HTML
# Buscar tablas con bgcolor="#C2EFFF" que contienen los items
ITEMS_JSON="[]"
ITEMS_TEXT=""

# Método robusto: extraer bloques de celdas cyan y procesar con awk
# El formato es: fila con cantidad, fila con artículo, fila con unidad
# Buscamos específicamente el patrón de la tabla de items

# Primero, extraer la sección entre ARTICULO y el final de la tabla de items
ITEMS_SECTION=$(echo "$HTML_CONTENT" | sed -n '/ARTICULO/,/Pliego sin costo/p' | head -200)
if [ -z "$ITEMS_SECTION" ]; then
    # Si no encontró "Pliego sin costo", intentar hasta </table>
    ITEMS_SECTION=$(echo "$HTML_CONTENT" | sed -n '/ARTICULO/,/<\/table>/p' | head -200)
fi

if [ -n "$ITEMS_SECTION" ]; then
    # Para manejar HTML multi-línea, primero colapsamos todo en una sola línea
    # Luego extraemos las celdas cyan con su contenido
    # El HTML tiene esta estructura:
    # <td ... bgcolor="#C2EFFF">...<b><font...>VALOR</font></b></td>

    # Colapsar líneas y extraer celdas cyan
    CELL_VALUES=$(echo "$ITEMS_SECTION" | \
        tr '\n' ' ' | \
        sed 's/<td/\n<td/g' | \
        grep 'bgcolor="#C2EFFF"' | \
        sed 's/.*<b><font[^>]*>\([^<]*\)<\/font><\/b>.*/\1/' | \
        grep -v "^$" | \
        grep -v "CANTIDAD" | \
        grep -v "ARTICULO" | \
        grep -v "UNIDAD" | \
        sed 's/^[ \t]*//;s/[ \t]*$//')

    # Procesar los valores: vienen en grupos de 2 (cantidad, artículo)
    # La unidad está en celdas sin bgcolor="#C2EFFF" así que se filtra automáticamente

    if [ -n "$CELL_VALUES" ]; then
        # Usar un archivo temporal para procesar
        TMP_ITEMS="/tmp/im_items_$$"
        echo "$CELL_VALUES" > "$TMP_ITEMS"

        # Leer y procesar en grupos de 2 (cantidad, artículo)
        # La unidad NO tiene bgcolor="#C2EFFF" así que no viene en CELL_VALUES
        ITEMS_TEXT=$(awk '
        BEGIN {
            count = 0
            result = ""
        }
        {
            count++
            if (count == 1) {
                cantidad = $0
            } else if (count == 2) {
                articulo = $0
                # Formar el item
                if (result == "") {
                    result = cantidad " - " articulo
                } else {
                    result = result " | " cantidad " - " articulo
                }
                count = 0
            }
        }
        END {
            print result
        }' "$TMP_ITEMS")

        rm -f "$TMP_ITEMS"
    fi
fi

# Si no se encontraron items con el método anterior, intentar enfoque alternativo
if [ -z "$ITEMS_TEXT" ]; then
    # Buscar patrón más simple: colapsar líneas y buscar celdas cyan
    ITEMS_TEXT=$(echo "$HTML_CONTENT" | \
        tr '\n' ' ' | \
        sed 's/<td/\n<td/g' | \
        grep 'bgcolor="#C2EFFF"' | \
        sed 's/.*<b><font[^>]*>\([^<]*\)<\/font><\/b>.*/\1/' | \
        grep -v "^[0-9]*$" | \
        grep -v "CANTIDAD" | \
        grep -v "ARTICULO" | \
        grep -v "UNIDAD" | \
        sed 's/^[ \t]*//;s/[ \t]*$//' | \
        head -10 | \
        tr '\n' '|' | \
        sed 's/|$//; s/|/ | /g')
fi

# Extraer adjuntos (pliegos y comentarios)
ADJUNTOS_JSON="[]"

if [ -n "$COMENTARIOS" ]; then
    # Parsear el campo Comentarios que tiene formato: ID#Titulo##, ID#Titulo##
    # Ejemplo: 5FDC94DE3025D80803258D37007AE517#Pliego del llamado ( 03/11/2025 )##

    ADJUNTOS_JSON=$(echo "$COMENTARIOS" | awk -F',' '
    BEGIN {
        result = "["
        first = 1
    }
    {
        for (i = 1; i <= NF; i++) {
            # Limpiar espacios
            gsub(/^[ \t]+|[ \t]+$/, "", $i)
            if ($i != "") {
                # Separar por #
                n = split($i, parts, "#")
                if (n >= 2 && parts[1] != "" && parts[2] != "") {
                    doc_id = parts[1]
                    doc_titulo = parts[2]

                    # Escapar comillas para JSON
                    gsub(/"/, "\\\"", doc_titulo)

                    doc_url = "http://www.montevideo.gub.uy/asl/sistemas/siab/Cartelera.nsf/0/" doc_id "?OpenDocument"

                    if (first) {
                        result = result "{\"nombre\": \"" doc_titulo "\", \"tipo\": \"text/html\", \"archivo_url\": \"" doc_url "\", \"label\": \"" doc_titulo "\"}"
                        first = 0
                    } else {
                        result = result ", {\"nombre\": \"" doc_titulo "\", \"tipo\": \"text/html\", \"archivo_url\": \"" doc_url "\", \"label\": \"" doc_titulo "\"}"
                    }
                }
            }
        }
    }
    END {
        print result "]"
    }')
fi

# Construir texto extraído para análisis IA
TEXTO_EXTRAIDO="$PROC_COMPRA $NRO_COMPRA"

if [ -n "$DEPARTAMENTO" ]; then
    TEXTO_EXTRAIDO="$TEXTO_EXTRAIDO - $DEPARTAMENTO"
fi

if [ -n "$DIVISION" ]; then
    TEXTO_EXTRAIDO="$TEXTO_EXTRAIDO - $DIVISION"
fi

if [ -n "$SERVICIO" ]; then
    TEXTO_EXTRAIDO="$TEXTO_EXTRAIDO - $SERVICIO"
fi

if [ -n "$DIRECCION" ]; then
    TEXTO_EXTRAIDO="$TEXTO_EXTRAIDO - Lugar de entrega: $DIRECCION"
fi

if [ -n "$FECHA_FORMATEADA" ]; then
    TEXTO_EXTRAIDO="$TEXTO_EXTRAIDO - Fecha Apertura: $FECHA_FORMATEADA"
fi

if [ -n "$ITEMS_TEXT" ]; then
    TEXTO_EXTRAIDO="$TEXTO_EXTRAIDO - Items: $ITEMS_TEXT"
fi

# Escapar caracteres especiales para JSON
TEXTO_EXTRAIDO_ESC=$(echo "$TEXTO_EXTRAIDO" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g' | tr '\n' ' ')
ITEMS_TEXT_ESC=$(echo "$ITEMS_TEXT" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g' | tr '\n' ' ')

# Construir JSON de items
if [ -n "$ITEMS_TEXT" ]; then
    # Dividir items por | y crear array JSON usando awk
    ITEMS_JSON=$(echo "$ITEMS_TEXT" | awk -F'|' '
    BEGIN {
        result = "["
        first = 1
    }
    {
        for (i = 1; i <= NF; i++) {
            # Limpiar espacios
            gsub(/^[ \t]+|[ \t]+$/, "", $i)
            if ($i != "") {
                # Escapar comillas y backslashes para JSON
                gsub(/\\/, "\\\\", $i)
                gsub(/"/, "\\\"", $i)

                if (first) {
                    result = result "{\"texto\": \"" $i "\"}"
                    first = 0
                } else {
                    result = result ", {\"texto\": \"" $i "\"}"
                }
            }
        }
    }
    END {
        print result "]"
    }')
fi

# Generar salida JSON
cat << EOF
{
  "texto_extraido": "$TEXTO_EXTRAIDO_ESC",
  "items": $ITEMS_JSON,
  "adjuntos": $ADJUNTOS_JSON,
  "metadata": {
    "proc_compra": "$PROC_COMPRA",
    "nro_compra": "$NRO_COMPRA",
    "fecha": "$FECHA_FORMATEADA",
    "departamento": "$DEPARTAMENTO",
    "division": "$DIVISION",
    "servicio": "$SERVICIO"
  }
}
EOF
