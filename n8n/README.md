# ⚙️ n8n Workflows – ARCE-LICITACIONES-IA

Carpeta destinada a los **flujos de automatización (ETL y análisis IA)** del sistema ARCE-LICITACIONES-IA.

---

## 📂 Contenido actual

### `arce_licitaciones_extraccion_v1.json`
**Descripción:**  
Primer workflow funcional del proyecto.  
Automatiza la **extracción, limpieza y carga** de licitaciones desde el portal ARCE hacia la base de datos PostgreSQL.

**Funciones principales:**
- Convierte el feed XML en JSON limpio.  
- Filtra licitaciones relevantes del rubro aluminio/construcción.  
- Descarta llamados vencidos o irrelevantes.  
- Ejecuta scraping de aclaraciones y adjuntos.  
- Inserta los resultados en tablas relacionales: `llamados`, `aclaraciones`, `archivos_adjuntos`.  

**Estado:**  
🟢 *Versión base funcional (en producción local)*  
⚙️ *Pendiente de integración con modelo Ollama para análisis semántico.*

---

## 🧱 Estructura esperada
- `arce_licitaciones_extraccion_v1.json` → Workflow de extracción y carga (ETL)  
- `arce_licitaciones_analisis_ia_v1.json` → (Próximo) Workflow de clasificación IA  
- `arce_licitaciones_notificaciones_v1.json` → (Pendiente) Workflow de avisos automatizados  

---

## 🧭 Notas técnicas
- **Entorno:** Fedora VM · Docker Compose · n8n self-hosted · PostgreSQL  
- **Ubicación DB:** `public.llamados`, `public.aclaraciones`, `public.archivos_adjuntos`  
- **Credenciales:** no incluidas por seguridad (se configuran manualmente en n8n)

---

## 🗓️ Estado del módulo
✅ Extracción automatizada  
🔜 Integración IA (Ollama)  
🕓 Notificaciones vía Bot de Telegram y página web tipo Dashboard — *pendientes*

