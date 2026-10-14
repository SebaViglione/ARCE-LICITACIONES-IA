# De filtrar licitaciones de aluminio a leer todo el mercado de compras estatales

> Documento de contexto para quien retome el proyecto (humano o asistente de IA). Cuenta de dónde venía el sistema, por qué cambió de objetivo el 14 de octubre de 2026, qué se construyó para el nuevo objetivo y qué falta. Para la referencia técnica del módulo nuevo ver [MERCADO.md](MERCADO.md); para la arquitectura general, [ARQUITECTURA.md](ARQUITECTURA.md).

## 1. El problema original

ARCE (Agencia Reguladora de Compras Estatales, Uruguay) publica en [comprasestatales.gub.uy](https://www.comprasestatales.gub.uy) todos los llamados a licitación del Estado: cientos por día, de todos los rubros. Una empresa de aberturas de aluminio necesitaba saber cuáles le servían sin leerlos uno por uno.

La primera versión del proyecto resolvió eso: un servicio Node/TypeScript lee el RSS del portal cada 15 minutos, filtra por palabras clave del rubro, scrapea el detalle, descarga los pliegos (PDF, Word, ZIP, con OCR si hace falta) y le pide a un modelo de lenguaje (Ollama local o la API de Anthropic) un análisis con esquema fijo: si es del rubro y con qué confianza, qué piden, dónde, si hay visita técnica obligatoria, qué formularios presentar. Un dashboard de triage muestra los llamados ordenados por plazo y guarda la decisión humana, con la que se mide la precisión del modelo. Esa parte sigue funcionando tal cual (`app/src/pipeline`, la ruta `/` del dashboard).

## 2. El cambio de enfoque

La dirección de la empresa planteó otra pregunta, más grande: **no solo "qué licitación me sirve hoy" sino "qué conviene vender, a qué precio, y contra quién"**. Para responderla no alcanza con el RSS de los últimos 60 días ni con un rubro: hay que tener **todo el histórico de ARCE**, con lo que se adjudicó, a quién y a qué precio, de cualquier producto del mercado.

Eso cambia la naturaleza del sistema:

| | Antes | Ahora |
|---|---|---|
| Objeto | Llamados abiertos de un rubro | Todas las adjudicaciones históricas, todos los rubros |
| Pregunta | ¿Es para nosotros? | ¿Qué se vende, a qué precio, quién gana, quién compra? |
| Dato clave | El pliego (texto) | La adjudicación (producto, cantidad, precio, proveedor, organismo, fecha) |
| Rol de la IA | Leer pliegos | Ninguno por ahora (son datos estructurados); posible más adelante para clasificar ítems sin código |
| Fuente | RSS + scraping propio | Un scraper externo que todavía no existe, mandando lotes por API |
| Salida | Bandeja de triage | Estadísticas de mercado: rankings, precios, cuotas, competencia |

Dos restricciones definieron el diseño:

1. **No scrapear nada ahora.** El scraping masivo del portal va a ser un servicio aparte, que se dejará corriendo después. Este repositorio tiene que estar **listo para recibirlo**: apenas lleguen datos, las estadísticas tienen que salir solas, sin trabajo manual.
2. **Datos que no sean ruido.** El valor está en comparar precios y volúmenes de forma honesta: misma unidad, misma moneda, misma base impositiva, sin llamados anulados, sin duplicados.

## 3. Lo que se construyó

Un módulo nuevo, `app/src/mercado/`, con su propio esquema en PostgreSQL (`mercado`) y una sección nueva del dashboard (`/mercado`). Convive con el pipeline del rubro sin tocarlo.

### 3.1 Tres capas de datos

```
scraper externo ──POST /api/ingesta/llamados──►  crudos (JSON + hash)  ──►  tablas normalizadas  ──►  vistas materializadas  ──►  API /api/mercado  ──►  dashboard
                                                  idempotencia,              organismos, proveedores,     mv_hechos (1 fila por        rankings, fichas,
                                                  reproceso                  artículos, categorías,       adjudicación en UYU),        oportunidades
                                                                             llamados, ítems, ofertas,    productos, proveedores,
                                                                             adjudicaciones, cotizaciones  meses, competencia
```

- **Crudo**: cada llamado que llega se guarda tal cual con un hash de su contenido. El mismo contenido no se vuelve a procesar; uno que cambió (pasó de publicado a adjudicado) reemplaza a sus hijos dentro de una transacción. Si cambian las reglas de normalización, se reprocesa todo desde los crudos sin pedirle nada al scraper.
- **Normalizado**: proveedores identificados por RUT (y fusionados cuando aparece el RUT de uno que antes vino solo con nombre), artículos por código del catálogo de ARCE (o nombre normalizado si no hay código), organismos por inciso + unidad ejecutora, monedas y unidades de medida llevadas a un canon, estados y tipos de compra agrupados.
- **Estadísticas**: ocho vistas materializadas que se refrescan solas un minuto después del último lote (debounce), todas las noches y a pedido. La base es `mv_hechos`: una fila por adjudicación con fecha, con precio y monto en pesos uruguayos sin impuestos cuando la base es conocida. Sobre ella: serie mensual por producto (precio mediano, volumen), por proveedor, totales por mes, competencia (precio ganador vs. perdedor cuando hay cuadro comparativo) y los resúmenes por producto y por proveedor con ventanas de 12 y 24 meses.

### 3.2 Las respuestas que da

- **Qué vender**: un índice de oportunidad (0-100) por producto sobre los últimos 24 meses de datos, que combina volumen (35 %), frecuencia de llamados (20 %), cantidad de organismos compradores (20 %) y apertura competitiva, medida como 1 − HHI del monto entre proveedores (25 %). Es una heurística explícita y documentada, no una caja negra: el dashboard muestra los cuatro componentes de cada producto.
- **A qué precio**: por producto y unidad, la distribución del precio unitario ganador (p10, p25, mediana, p75, p90), la tendencia mensual y la variación interanual. Donde el portal publicó el cuadro comparativo, cuánto más barata fue la oferta ganadora que las perdedoras.
- **Quién gana**: ranking de proveedores por monto, con producto principal, cantidad de compradores, cuota por producto y tasa de éxito (ofertas ganadas / presentadas). Para cada proveedor, contra quién compite (quiénes ganan sus mismos productos).
- **Quién compra**: ranking de organismos con lo que más compran.

### 3.3 Reglas anti-ruido (las decisiones que importan)

- Se excluyen de las estadísticas los llamados anulados o dejados sin efecto y las adjudicaciones sin ninguna fecha.
- El precio solo se compara dentro de la misma unidad de medida normalizada (kg con kg, resma con resma).
- Todo se expresa en pesos uruguayos sin impuestos. Las monedas extranjeras (USD, UI, UR, EUR) se convierten con la cotización vigente al día de la adjudicación (tabla `cotizaciones`, que también se carga por API). Sin cotización, la fila cuenta para los conteos pero no para montos ni precios.
- Si un precio viene con impuestos incluidos y sin tasa conocida, no entra en las estadísticas de precio (sí en volúmenes, marcado como base desconocida).
- Medianas y percentiles en vez de promedios, para que un precio mal cargado no arrastre la estadística.
- El dashboard muestra la cobertura de cada regla (qué porcentaje tiene precio comparable, cuántas filas quedaron afuera y por qué), para que nadie lea un número sin saber de dónde sale.

### 3.4 Lo que ve el usuario

Una segunda sección del dashboard React, con el mismo lenguaje visual que la bandeja de triage: filtros de período (presets de 12/24/60 meses relativos al último dato, o un rango de meses), categoría y búsqueda; indicadores del período; a la izquierda cuatro pestañas (Qué vender, Productos, Competidores, Compradores); a la derecha el panorama del mercado o la ficha del producto o proveedor elegido, con gráficos de una sola serie (precio mediano mensual, monto mensual, cuotas con etiquetas directas). Mientras no haya datos, la pantalla explica cómo alimentar el sistema y muestra si algún lote fue rechazado.

### 3.5 Cómo se probó sin scrapear

Un generador de **datos sintéticos** (`npm run mercado:demo`) produce tres años de compras verosímiles (35 productos de 9 familias, 42 proveedores, 28 organismos, precios con inflación, dólar y UI con cotización semanal, cuadros comparativos en el 45 % de los ítems) y los manda por la misma API que usará el scraper, con la fuente `demo-sintetico` para poder borrarlos de un comando. Sirve de prueba de punta a punta, de ejemplo de cliente del contrato y de demo del tablero. Un test de integración crea una base temporal, migra, ingesta, refresca y verifica las conversiones (impuestos, cotización, HHI, precio ganador vs. perdedor).

## 4. Decisiones y por qué

- **Contrato tolerante, estructura estricta.** El scraper puede mandar números con coma, fechas dd/mm/aaaa, el símbolo de la moneda tal como aparece en el portal, y textos vacíos; la API los normaliza. Pero un ítem sin número, una adjudicación sin proveedor o un número de ítem repetido se rechazan con el detalle del error, por llamado, sin tirar el lote.
- **Snapshot completo por llamado.** En vez de endpoints separados para ítems, ofertas y adjudicaciones, un llamado viaja entero y reemplaza a sus hijos. Es más simple para el scraper (manda lo que ve en la página) y hace la ingesta idempotente.
- **Vistas materializadas, no consultas en vivo.** Con millones de adjudicaciones, los rankings tienen que precalcularse. Las vistas se refrescan `CONCURRENTLY` para no bloquear el dashboard; para la carga inicial masiva hay un modo bloqueante más rápido.
- **El índice de oportunidad es una fórmula visible, no un modelo.** Los pesos están en el SQL y en la documentación; cambiarlos es editar una línea. Primero hay que ver datos reales antes de sofisticarlo.
- **Un token para la ingesta.** `INGESTA_TOKEN` en el entorno; sin él, la ingesta responde 503 y el resto del sistema funciona igual. Nada de credenciales en el código.
- **La IA queda en pausa en este módulo.** Los datos de adjudicación son estructurados; el valor hoy está en normalizarlos bien. Queda abierto usar un modelo para mapear ítems de texto libre al catálogo (ver pendientes).

## 5. Qué falta (y por dónde seguir)

1. **El scraper del histórico.** Es el trabajo grande pendiente y vive fuera de este repositorio. Tiene que recorrer el portal (o sus datos abiertos) y mandar lotes a `POST /api/ingesta/llamados` siguiendo el contrato de `GET /api/ingesta/esquema`. En [MERCADO.md](MERCADO.md) hay una guía de qué extraer de cada página de ARCE y cómo mapearlo.
2. **Cotizaciones reales** de USD, UI y UR (BCU) a `POST /api/ingesta/cotizaciones`, una por día, para convertir bien el histórico.
3. **El catálogo de artículos de ARCE** (código, nombre, familia) a `POST /api/ingesta/articulos`, para que la jerarquía de categorías sea la oficial.
4. **Ítems sin código de catálogo.** Si una parte del histórico viene solo con descripción libre, conviene un paso de clasificación (reglas o IA con salida estructurada) que los asigne a un artículo; el esquema ya lo permite (`items.articulo_id` nulo).
5. **Calibrar el índice de oportunidad** con datos reales y con el criterio comercial de la empresa (por ejemplo, ponderar más los organismos a los que ya se les vende).
6. **Escala.** Con el histórico completo (varios millones de filas) hay que medir el refresco y, si hace falta, particionar `mv_hechos` por año o mover los rankings de rango arbitrario a agregados anuales.

## 6. Cómo verlo funcionando en cinco minutos

```bash
cp .env.example .env                       # poner POSTGRES_PASSWORD y un INGESTA_TOKEN (openssl rand -hex 32)
docker compose up --build -d               # postgres + app; aplica las migraciones
cd app && npm install && npm run mercado:demo   # tres años de datos sintéticos por la API de ingesta
xdg-open http://localhost:3000/mercado     # un minuto después (o botón "Recalcular estadísticas")
```

## 7. Mapa del código del módulo

```
app/migrations/004_mercado.sql     esquema mercado: tablas, función de cotización, 8 vistas materializadas
app/src/mercado/esquema.ts         contrato de ingesta (zod) y JSON Schema publicado
app/src/mercado/normalizar.ts      RUT, nombres, monedas, unidades, estados, tipos de compra, números y fechas flexibles, hash
app/src/mercado/ingesta.ts         crudos + upserts transaccionales, reproceso, borrado por fuente
app/src/mercado/estadisticas.ts    refresco de vistas (debounce, cola, historial)
app/src/mercado/consultas.ts       SQL de resumen, productos, proveedores, organismos, categorías, oportunidades, búsqueda
app/src/mercado/rutas.ts           Express: /api/ingesta/* (token) y /api/mercado/*
app/src/mercado/demo.ts            generador de datos sintéticos / cliente de ejemplo
app/test/mercado_*.test.ts         unitarios (normalización, contrato) e integración (base temporal real)
app/web/src/mercado/               Mercado, BarraMercado, Listas, FichaProducto, FichaProveedor, Panorama, VacioMercado, Graficos
```
