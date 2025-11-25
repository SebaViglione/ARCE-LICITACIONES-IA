# Dashboard Web - Setup

## Problema Solucionado

El dashboard no cargaba datos porque faltaba la vista `v_llamados_dashboard` en la base de datos.

## Solución Implementada

Se creó la vista `v_llamados_dashboard` que:
- Combina datos de las tablas `llamados`, `analisis_ia`, `archivos_adjuntos`
- Selecciona el mejor análisis IA para cada llamado (mayor confianza)
- Cuenta el número de archivos adjuntos por llamado
- Filtra solo llamados activos

## Inicialización de la Vista

### Opción 1: Script Automático

```bash
./database/init_views.sh
```

### Opción 2: Manual

```bash
docker exec -i n8n_postgres psql -U n8n -d n8n < database/create_dashboard_view.sql
```

## Verificar que Funciona

1. **Verificar la vista en la BD:**
```bash
docker exec n8n_postgres psql -U n8n -d n8n -c "SELECT COUNT(*) FROM v_llamados_dashboard;"
```

2. **Probar la API:**
```bash
curl http://localhost:3000/api/llamados | jq '. | length'
```

3. **Abrir el dashboard en el navegador:**
```
http://localhost:3000
```

## Estructura del Dashboard

### Backend (server.js)
- `GET /api/llamados` - Lista de llamados con análisis IA
- `GET /api/llamados/:id` - Detalle de un llamado
- `POST /api/feedback` - Guardar feedback humano

### Frontend (public/)
- `index.html` - Estructura HTML
- `app.js` - Lógica del frontend
- `styles.css` - Estilos

## Campos Disponibles en v_llamados_dashboard

### Información Básica
- `llamado_id`, `titulo`, `descripcion`
- `fecha_publicacion`, `hora_publicacion`
- `fecha_apertura`, `hora_apertura`
- `url_detalle`, `estado`, `urgencia`
- `dias_restantes`, `prioridad_score`

### Análisis IA
- `es_relevante`, `confianza`, `razon`
- `resumen_trabajo`
- `ai_descripcion` (título generado por IA)
- `materiales_detectados` (JSON array)

### Ubicación y Visita
- `ubicacion_obra`
- `requiere_visita`, `ubicacion_visita`
- `fecha_visita_especifica`, `coordina_visita`
- `contacto_visita_nombre`, `contacto_visita_telefono`, `contacto_visita_correo`

### Formularios
- `formularios_requeridos` (JSON array con nombre, obligatorio, sección)

### Metadatos
- `total_archivos` (conteo de adjuntos)
- `analizado_en` (timestamp del análisis)

## Reiniciar Servicios

```bash
# Reiniciar solo el dashboard
docker-compose restart dashboard

# Reiniciar todos los servicios
docker-compose restart
```

## Troubleshooting

### Error: "relation v_llamados_dashboard does not exist"
**Solución:** Ejecutar el script de inicialización
```bash
./database/init_views.sh
```

### Dashboard no carga datos
**Verificar:**
1. ¿Postgres está corriendo? `docker-compose ps postgres`
2. ¿La vista existe? `docker exec n8n_postgres psql -U n8n -d n8n -c "\dv"`
3. ¿Hay llamados en la BD? `docker exec n8n_postgres psql -U n8n -d n8n -c "SELECT COUNT(*) FROM llamados;"`

### Datos desactualizados
Las vistas en PostgreSQL son consultas virtuales que siempre muestran datos actuales. No es necesario "refrescarlas".
