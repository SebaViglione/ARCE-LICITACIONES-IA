# Módulo de mercado: referencia técnica

Histórico de compras estatales de ARCE normalizado para responder qué se compra, a qué precio, quién gana y quién compra. El contexto y las decisiones están en [CAMBIO-DE-ENFOQUE.md](CAMBIO-DE-ENFOQUE.md). Este documento es la referencia para quien escriba el scraper, consulte la API o toque las estadísticas.

## 1. Flujo

```
scraper ─► POST /api/ingesta/llamados (lotes de hasta 500, token) ─► mercado.crudos ─► tablas normalizadas ─► refresco de vistas (1 min después del último lote; también 03:30 todos los días y POST /api/mercado/refrescar)
                                                                                                                                       │
dashboard /mercado ◄── GET /api/mercado/{resumen, productos, productos/:id, proveedores, proveedores/:id, organismos, categorias, oportunidades, buscar, estado} ◄── vistas materializadas
```

Configuración (`.env`):

| Variable | Default | Para qué |
|---|---|---|
| `INGESTA_TOKEN` | vacío | Obligatorio para `/api/ingesta/*` (`Authorization: Bearer …` o `X-Ingesta-Token`). Vacío → 503. Mínimo 16 caracteres; `openssl rand -hex 32` |
| `INGESTA_MAX_MB` | `50` | Tamaño máximo del cuerpo de un lote |
| `MERCADO_REFRESCO_CRON` | `30 3 * * *` | Refresco nocturno de las vistas |
| `MERCADO_REFRESCO_ENABLED` | `true` | Apaga el cron de refresco (no la ingesta) |
| `MERCADO_REFRESCO_DEBOUNCE_MS` | `60000` | Espera tras el último lote antes de refrescar |

## 2. Contrato de ingesta

El JSON Schema de entrada de cada endpoint se publica en `GET /api/ingesta/esquema` (sin token). Fuente de verdad: `app/src/mercado/esquema.ts`.

### 2.1 `POST /api/ingesta/llamados`

```json
{
  "fuente": "scraper-arce",
  "llamados": [
    {
      "arce_id": "1234567",
      "tipo_compra": "Licitación Abreviada",
      "numero": "12/2025",
      "anio": 2025,
      "organismo": { "inciso": "Intendencia de Montevideo", "unidad_ejecutora": "Desarrollo Urbano", "codigo_inciso": "97", "codigo_unidad": "1" },
      "objeto": "Suministro de ventanas de aluminio para escuelas",
      "estado": "Adjudicado",
      "fecha_publicacion": "2025-02-01",
      "fecha_apertura": "2025-02-20T11:00:00-03:00",
      "fecha_adjudicacion": "2025-03-10",
      "moneda": "$",
      "url": "https://www.comprasestatales.gub.uy/consultas/detalle/id/1234567",
      "items": [
        {
          "nro_item": 1,
          "articulo": { "codigo": "10101", "nombre": "VENTANA DE ALUMINIO", "categoria": { "familia": "Construcción", "subfamilia": "Aberturas" }, "unidad": "UNIDAD" },
          "descripcion": "Ventana corrediza 1,20 x 1,10 con DVH",
          "cantidad": 10,
          "unidad": "UNIDAD",
          "variante": "corrediza",
          "ofertas": [
            { "proveedor": { "rut": "211234560012", "nombre": "Aluminios del Sur S.A." }, "precio_unitario": "18.000,00", "moneda": "$", "impuestos_incluidos": false, "cantidad": 10 },
            { "proveedor": { "nombre": "Aberturas Rodríguez" }, "precio_unitario": 20000, "moneda": "$" }
          ],
          "adjudicaciones": [
            { "proveedor": { "rut": "211234560012", "nombre": "Aluminios del Sur S.A." }, "cantidad": 10, "precio_unitario": 18000, "moneda": "$", "impuestos_incluidos": false, "tasa_impuestos": 0.22, "monto_total": 180000, "monto_total_con_impuestos": 219600, "fecha": "2025-03-10", "resolucion": "Res. 123/2025" }
          ]
        }
      ]
    }
  ]
}
```

Reglas:

- **Obligatorio**: `arce_id`; en cada ítem `nro_item` (único dentro del llamado); en cada oferta o adjudicación `proveedor.nombre`. Todo lo demás es opcional y puede venir `null`, vacío o faltar.
- **Un llamado es un snapshot** de su página de detalle. Reenviarlo con el mismo `arce_id` reemplaza sus ítems, ofertas y adjudicaciones. Si el contenido es idéntico al último recibido (hash), no se toca nada y cuenta como `sin_cambios`.
- **Formatos tolerados**: números como `18000`, `"18.000,00"`, `"$ 18.000"`, `"1,250,000"`; fechas `AAAA-MM-DD`, `dd/mm/aaaa`, ISO con hora; monedas `$`, `U$S`, `UYU`, `USD`, `UI`, `UR`, `€`, "Pesos Uruguayos", "Dólares USA"; unidades como las escribe el portal ("UNIDAD", "KG", "Kilogramos", "METRO CUADRADO", "Lts").
- **Impuestos**: el portal suele publicar el precio unitario sin impuestos; mandar `impuestos_incluidos: false` (el default). Si el precio incluye impuestos, mandar `true` y, si se conoce, `tasa_impuestos` (0.22 para IVA 22 %). Sin tasa, ese precio queda fuera de las estadísticas de precio.
- **Proveedores**: el RUT (12 dígitos) es el identificador; sin RUT se identifica por nombre normalizado y se fusiona cuando aparece el RUT.
- **Artículos**: el código del catálogo de ARCE es el identificador; sin código, nombre normalizado. Sin `articulo`, el ítem cuenta en montos pero no en el ranking de productos.
- **Lote**: hasta 500 llamados; respuesta `{ lote_id, recibidos, insertados, actualizados, sin_cambios, rechazados: [{ indice, clave, error }], duracion_ms }`. Un llamado inválido se rechaza solo; el resto del lote se procesa. 422 si se rechazaron todos.

### 2.2 Otros endpoints de ingesta (todos con token)

| Endpoint | Cuerpo | Para qué |
|---|---|---|
| `POST /api/ingesta/cotizaciones` | `{ cotizaciones: [{ moneda, fecha, valor_uyu, fuente? }] }` | Pesos por unidad de USD / UI / UR / EUR por día (BCU). Se usa la última cotización anterior a la fecha de adjudicación, con 45 días de tolerancia |
| `POST /api/ingesta/articulos` | `{ articulos: [{ codigo, nombre, categoria?, unidad? }] }` | Catálogo oficial de ARCE (familia > subfamilia > clase) |
| `POST /api/ingesta/proveedores` | `{ proveedores: [{ rut, nombre, pais? }] }` | RUPE u otra fuente de proveedores |
| `POST /api/ingesta/reprocesar` | `{ desde_lote?, limite? }` | Vuelve a normalizar desde los crudos (tras cambiar reglas de normalización) |
| `DELETE /api/ingesta/fuente/:fuente?confirmar=:fuente` | — | Borra todo lo que vino de una fuente (por ejemplo `demo-sintetico`) |
| `GET /api/ingesta/lotes?limit=20` | — | Historial de lotes (sin token) |

### 2.3 Qué extraer de ARCE

Para quien escriba el scraper, el mapeo esperado desde la página de detalle de un llamado del portal:

| En el portal | Campo del contrato |
|---|---|
| `id` de la URL de detalle | `arce_id` |
| Inciso / Unidad Ejecutora | `organismo.inciso` / `organismo.unidad_ejecutora` |
| Tipo de compra, Número, Año | `tipo_compra`, `numero`, `anio` |
| Objeto del llamado | `objeto` |
| Estado | `estado` (texto tal cual; se normaliza a publicado / en_evaluacion / adjudicado / desierto / anulado / sin_efecto) |
| Fecha de publicación, apertura, adjudicación | `fecha_publicacion`, `fecha_apertura`, `fecha_adjudicacion` |
| Tabla de ítems: Nro, Cód. artículo, Artículo, Cantidad, Unidad, Variante, Presentación, Detalle | `items[]` con `articulo.codigo`, `articulo.nombre`, `cantidad`, `unidad`, `variante`, `presentacion`, `detalle` |
| Cuadro comparativo de ofertas (si está publicado): proveedor, RUT, precio unitario, moneda, cantidad, plazo | `items[].ofertas[]` |
| Resolución de adjudicación: ítem, proveedor, RUT, cantidad, precio unitario, moneda, total sin / con impuestos | `items[].adjudicaciones[]` |

Los datos abiertos de ARCE (catalogodatos.gub.uy) traen gran parte de esto en CSV; el mismo contrato sirve para cargarlos.

## 3. Modelo de datos (esquema `mercado`)

| Tabla | Clave | Contenido |
|---|---|---|
| `lotes` | id | Un lote recibido: tipo, fuente, conteos, errores, duración |
| `crudos` | id; índice (tipo, clave, hash) | Payload original de cada llamado, con hash sha256 del JSON canónico, `procesado_en` y `error` |
| `refrescos` | id | Historial de refrescos de vistas (origen, duración por vista, error) |
| `categorias` | id; único (padre_id, nombre) | Jerarquía familia > subfamilia > clase; `raiz_id` apunta a la familia |
| `articulos` | id; `codigo` único; nombre normalizado único si no hay código | Productos del catálogo |
| `proveedores` | id; `rut` único; nombre normalizado único si no hay RUT | Oferentes y adjudicatarios |
| `organismos` | id; `clave` = "INCISO\|UNIDAD" normalizada | Compradores |
| `cotizaciones` | (moneda, fecha) | Pesos por unidad de moneda |
| `llamados` | id; `arce_id` único | Llamado con estado normalizado y `tipo_compra_grupo` |
| `items` | id; único (llamado_id, nro_item) | Ítem con `articulo_id` (puede ser nulo) y `unidad_normalizada` |
| `ofertas` | id; único (item_id, proveedor_id, nro_oferta) | Cuadro comparativo |
| `adjudicaciones` | id; único (item_id, proveedor_id, nro) | Lo adjudicado, con precio, moneda, base impositiva, totales y fecha |

Normalizaciones (`app/src/mercado/normalizar.ts`): texto sin acentos en mayúsculas; RUT a 12 dígitos; monedas a `UYU`/`USD`/`UI`/`UR`/`EUR`; unidades a un canon (`unidad`, `kg`, `g`, `ton`, `l`, `ml`, `m`, `m2`, `m3`, `hora`, `dia`, `mes`, `caja`, `paquete`, `rollo`, `bolsa`, `resma`, `par`, `docena`, `global`, `servicio`, …); estado y tipo de compra a grupos fijos.

## 4. Estadísticas

Vistas materializadas, refrescadas en este orden (`app/src/mercado/estadisticas.ts`):

| Vista | Grano | Qué tiene |
|---|---|---|
| `mv_hechos` | adjudicación | Fecha (`COALESCE(adjudicación, llamado.fecha_adjudicacion, apertura, publicación)`), organismo, artículo, categoría, unidad, proveedor, tipo de compra, cantidad, `precio_base` (sin impuestos), `precio_base_uyu`, `monto_uyu`, `cotizacion`, `base_conocida`, `con_cotizacion`. **Excluye** llamados anulados/sin efecto y adjudicaciones sin fecha |
| `mv_ofertas` | oferta | Igual que arriba para el cuadro comparativo, más `gano` y `oferentes` por ítem |
| `mv_mes` | mes | Adjudicaciones, llamados, organismos, proveedores, artículos, monto |
| `mv_producto_mes` | artículo × unidad × mes | Conteos, cantidad, monto, precio mediano / mín / máx |
| `mv_proveedor_mes` | proveedor × mes | Conteos y monto |
| `mv_producto_ofertas_anio` | artículo × unidad × año | Ítems con cuadro, oferentes promedio, precio ganador mediano, precio perdedor mediano, descuento mediano |
| `mv_productos` | artículo | Totales, unidad principal, ventanas 12 m / 24 m / 12 m previos relativas a la última fecha con datos, precio mediano y p25/p75 (12 m), HHI y líder (24 m), cobertura de precio, componentes e **índice de oportunidad**, variación interanual de monto y de precio |
| `mv_proveedores` | proveedor | Totales, ventanas, producto principal, ofertas presentadas / ganadas y tasa de éxito |

### Índice de oportunidad

Solo productos con ≥ 3 adjudicaciones en los últimos 24 meses de datos. Cada componente va de 0 a 1:

- `comp_volumen`: rango percentil del monto en 24 m entre esos productos.
- `comp_recurrencia`: rango percentil de la cantidad de llamados en 24 m.
- `comp_amplitud`: rango percentil de la cantidad de organismos compradores en 24 m.
- `comp_apertura`: `1 − HHI`, con HHI = suma de las cuotas al cuadrado del monto por proveedor en 24 m (1 = un solo ganador, → 0 = muy repartido).

`indice = 100 × (0,35·volumen + 0,20·recurrencia + 0,20·amplitud + 0,25·apertura)`. Los pesos están en `mv_productos` (migración 004) y se cambian editando esa línea y refrescando.

### Consultas con rango

Los endpoints de ranking (`productos`, `proveedores`, `organismos`, `categorias`) aceptan `desde` y `hasta` en `AAAA-MM` y agregan `mv_hechos` en ese rango (conteos distintos exactos, medianas con `percentile_cont`). Sin rango, todo el histórico. Los campos de ventana (12 m, 24 m, líder, HHI, índice) salen de `mv_productos` / `mv_proveedores` y no dependen del rango.

## 5. API de consulta (`/api/mercado`, sin token)

| Ruta | Parámetros | Devuelve |
|---|---|---|
| `GET /resumen` | — | Conteos globales, cobertura, rango de fechas, serie mensual, monedas, estados, tipos de compra, último lote y último refresco |
| `GET /productos` | `desde, hasta, q, categoria, orden (monto\|adjudicaciones\|organismos\|oportunidad\|crecimiento\|precio), limit, offset` | `{ total, filas }` ranking de artículos con líder, HHI, índice y tendencia |
| `GET /productos/:id` | `desde, hasta` | Ficha: totales del rango, percentiles de precio, serie mensual, proveedores con cuota, organismos con cuota, tipos de compra, últimas 25 adjudicaciones, competencia por año, unidades |
| `GET /proveedores` | `desde, hasta, q, articulo, orden (monto\|adjudicaciones\|articulos\|organismos\|exito\|crecimiento), limit, offset` | Ranking de proveedores |
| `GET /proveedores/:id` | `desde, hasta` | Ficha: totales, serie mensual, productos con cuota, organismos con cuota, competidores (quiénes ganan sus productos), últimas adjudicaciones, tipos de compra |
| `GET /organismos` | `desde, hasta, q, limit, offset` | Ranking de compradores con sus 3 productos principales |
| `GET /categorias` | `desde, hasta` | Familias con monto y conteos (para el filtro) |
| `GET /oportunidades` | `limit, categoria` | Top por índice de oportunidad con componentes |
| `GET /buscar` | `q` | Artículos, proveedores y organismos que coinciden |
| `GET /estado` | — | Refresco en curso, últimos refrescos y lotes |
| `POST /refrescar` | `{ concurrente?: boolean }` | Dispara un refresco (202) |

## 6. Operación

```bash
npm run mercado:demo                        # datos sintéticos por la API (necesita INGESTA_TOKEN y la app corriendo)
npm run mercado:demo -- --archivo demo.json # solo escribe el JSON de ejemplo
npm run mercado:demo -- --limpiar           # borra la fuente demo-sintetico
npm run mercado:refrescar                   # refresco manual sin levantar la API (-- --bloqueante para la carga inicial)
npm run test:db                             # tests incluyendo la integración contra Postgres (TEST_DATABASE_URL o DATABASE_URL)
```

- **Carga inicial masiva**: mandar los lotes con la app corriendo; el refresco con debounce se dispara solo al final. Si son millones de filas, conviene `MERCADO_REFRESCO_ENABLED=false` durante la carga y después `npm run mercado:refrescar -- --bloqueante` (el modo `CONCURRENTLY` es más lento porque calcula diferencias).
- **Cambios en las reglas de normalización**: editar `normalizar.ts`, correr `POST /api/ingesta/reprocesar` y esperar el refresco.
- **Salud**: `GET /api/mercado/estado` y la sección "Salud de los datos" del panorama del dashboard (cobertura de precio y monto, ítems sin artículo, adjudicaciones excluidas, lotes rechazados).

## 7. Pendientes

Ver la sección 5 de [CAMBIO-DE-ENFOQUE.md](CAMBIO-DE-ENFOQUE.md): el scraper del histórico, cotizaciones reales del BCU, el catálogo oficial de artículos, la clasificación de ítems sin código (posible uso de IA con salida estructurada), la calibración del índice con datos reales y la medición de escala.
