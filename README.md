# 🏗️ ARCE Licitaciones - Monitor IA

> ⚠️ **Estado:** En desarrollo activo | ✅ Modelo IA funcional | 🚧 Integración n8n en progreso

Sistema automatizado de monitoreo de licitaciones estatales uruguayas (ARCE) para el rubro aluminio, usando IA local con Ollama.

## 🎯 ¿Qué hace?

1. **Scraping automático** - n8n consulta ARCE cada 7 días
2. **Deduplicación** - Detecta llamados ya procesados (PostgreSQL)
3. **Descarga inteligente** - Extrae pliegos (PDF/ODT/DOC) a carpeta temporal
4. **Análisis IA** - Modelo Llama 3.1 custom clasifica relevancia para aluminio
5. **Notificación** - Alerta Telegram con datos clave y enlaces

## ✨ Características

- ✅ **Extracción multi-formato:** PDF, ODT, DOC, DOCX (pdftotext, pandoc, tesseract OCR)
- ✅ **Modelo IA custom:** Llama 3.1:8b fine-tuned para licitaciones de aluminio
- ✅ **Tests automatizados:** Suite de validación con casos reales
- 🚧 **Workflow n8n:** Orquestación completa (en desarrollo)
- 🚧 **Notificaciones Telegram:** Bot con feedback interactivo (pendiente)

## 🧪 Estado Actual

| Componente | Estado | Notas |
|------------|--------|-------|
| Modelo IA Ollama | ✅ Funcional | Prompt optimizado, JSON puro |
| Extracción texto | ✅ Funcional | Soporta PDF/ODT/DOC/imágenes OCR |
| Tests automatizados | ✅ Funcional | 10 casos sintéticos + reales |
| Workflow n8n | 🚧 En desarrollo | Scraping ARCE pendiente |
| Bot Telegram | 🚧 Planeado | Notificaciones + feedback |
| Deduplicación DB | 🚧 En desarrollo | Schema PostgreSQL definido |

## 🚀 Quick Start (Modelo IA)

### Prerrequisitos
- Ollama instalado
- Fedora/Ubuntu con `pdftotext`, `pandoc`, `tesseract`

### 1. Clonar e instalar modelo
```bash
git clone https://github.com/tu-usuario/arce-licitaciones.git
cd arce-licitaciones

# Crear modelo IA
ollama create arce-licitaciones -f models/modelfile-arce-v2
```

### 2. Instalar dependencias
```bash
# Fedora
sudo dnf install -y poppler-utils pandoc tesseract tesseract-langpack-spa odt2txt antiword

# Ubuntu/Debian
sudo apt install -y poppler-utils pandoc tesseract-ocr tesseract-ocr-spa odt2txt antiword
```

### 3. Ejecutar tests
```bash
cd tests/test-real-pdfs
chmod +x *.sh extract-text.sh
./test-real-pdfs.sh

# Resultados en: ../../results/
```

## 📊 Ejemplos de Respuesta IA

**Caso positivo (relevante):**
```json
{
  "es_relevante": true,
  "confianza": 95,
  "razon": "Suministro de 45 ventanas de aluminio con DVH",
  "materiales_detectados": ["aluminio", "DVH"],
  "tipo_trabajo": "suministro e instalación",
  "fecha_apertura": "15/11/2025",
  "items_clave": ["45 ventanas", "DVH"]
}
```

**Caso negativo (no relevante):**
```json
{
  "es_relevante": false,
  "confianza": 90,
  "razon": "Renovación de licencias de software, no relacionado con aluminio",
  "materiales_detectados": []
}
```

## 🏗️ Arquitectura (Planeada)
```
┌─────────────┐
│  ARCE Web   │ ← Scraping cada 7 días
└──────┬──────┘
       │
   ┌───▼────┐
   │  n8n   │ ← Orquestación
   └───┬────┘
       │
   ┌───▼────────────────────┐
   │ PostgreSQL (dedup)     │
   └────────────────────────┘
       │
   ┌───▼──────────────────┐
   │ Extracción texto     │ ← PDF/ODT/DOC → TXT
   └───┬──────────────────┘
       │
   ┌───▼──────────────────┐
   │ Ollama (Llama 3.1)   │ ← Clasificación IA
   └───┬──────────────────┘
       │
   ┌───▼──────────────────┐
   │ Telegram Bot         │ ← Notificación
   └──────────────────────┘
```

## 📖 Documentación

- [CLAUDE.md](CLAUDE.md) - Documentación técnica completa (AI-first approach)
- `tests/README.txt` - Casos de prueba y resultados esperados

## 🛠️ Tech Stack

- **IA:** Ollama (Llama 3.1:8b custom)
- **Orquestación:** n8n workflows
- **Base de datos:** PostgreSQL
- **Extracción texto:** pdftotext, pandoc, tesseract OCR
- **Notificaciones:** Telegram Bot API
- **Infraestructura:** Docker Compose

## 🗺️ Roadmap

- [x] Diseño de arquitectura
- [x] Modelado IA (prompt engineering)
- [x] Extracción multi-formato
- [x] Suite de tests automatizados
- [ ] Workflow n8n completo
- [ ] Scraping ARCE + deduplicación
- [ ] Bot Telegram con feedback
- [ ] Deploy Docker production-ready
- [ ] Documentación usuario final

## 🤝 Contribuir

Este es un proyecto personal en desarrollo. Sugerencias y feedback bienvenidos vía Issues.

## 📄 Licencia

MIT License - Ver [LICENSE](LICENSE)

---

---
👨‍💻 **Autor:** Sebastián Viglione  
🔗 [LinkedIn](https://linkedin.com/in/sebaviglione) · [GitHub](https://github.com/sebaviglione)

**Nota:** Este proyecto está en desarrollo activo. El modelo IA está funcional y testeado.

