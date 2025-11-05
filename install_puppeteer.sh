#!/bin/bash
# ==========================================================
# 🧩 Instalador automático de Puppeteer para ARCE-LICITACIONES-IA
# ==========================================================
# Crea entorno Node.js local y deja listo el scraper scrape_arce.js
# ==========================================================

set -e

PROJECT_DIR="$HOME/ARCE-LICITACIONES-IA"
SCRAPER_DIR="$PROJECT_DIR/arce-scraper"

echo "📦 Instalando dependencias del sistema..."
sudo dnf install -y nodejs npm || {
  echo "❌ Error instalando Node.js"; exit 1;
}

echo "📦 Instalando librerías que Chromium necesita..."
sudo dnf install -y \
  atk at-spi2-atk cups-libs xdg-utils alsa-lib \
  gtk3 libX11 libX11-xcb libXcomposite libXcursor libXdamage \
  libXext libXi libXtst libnss3 libXrandr mesa-libgbm pango \
  libdrm libxkbcommon || true

echo "📁 Creando estructura del scraper..."
mkdir -p "$SCRAPER_DIR"
cd "$SCRAPER_DIR"

echo "📦 Inicializando proyecto Node..."
npm init -y

echo "📦 Instalando Puppeteer..."
npm install puppeteer --save

echo "✅ Puppeteer instalado correctamente en:"
echo "   $SCRAPER_DIR/node_modules/puppeteer"

echo ""
echo "📄 Creando archivo ejemplo scrape_arce.js ..."
cat <<'EOF' > scrape_arce.js
import puppeteer from 'puppeteer';

const BASE_URL = 'https://www.comprasestatales.gub.uy';
const url = process.argv[2];

if (!url) {
  console.error('Falta URL. Uso: node scrape_arce.js "<url_detalle>"');
  process.exit(1);
}

function absolutize(href) {
  if (!href) return null;
  return href.startsWith('http') ? href : BASE_URL + href;
}

function cleanText(str) {
  return String(str || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&sol;/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseFechaHora(raw) {
  const m = String(raw || '').match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
  if (!m) return { fecha: null, hora: null };
  const [, dd, mm, yyyy, hh, mi] = m;
  return { fecha: \`\${yyyy}-\${mm}-\${dd}\`, hora: \`\${hh}:\${mi}\` };
}

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1366, height: 900 },
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-UY,es;q=0.9,en;q=0.8' });
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const t = req.resourceType();
      if (['image', 'font', 'media', 'stylesheet'].includes(t)) req.abort(); else req.continue();
    });

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    try { await page.waitForSelector('.aclaration-container', { timeout: 5000 }); } catch {}
    try { await page.waitForSelector('ul.buy-detail-list', { timeout: 5000 }); } catch {}

    const aclaraciones = await page.evaluate(() => {
      function cleanText(str) {
        return String(str || '')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&sol;/g, '/')
          .replace(/\s+/g, ' ')
          .replace(/<\/?[^>]+(>|$)/g, '')
          .trim();
      }
      const container = document.querySelector('.aclaration-container');
      if (!container) return [];
      const rows = Array.from(container.querySelectorAll('tr'));
      return rows.map(tr => {
        const td = tr.querySelector('td');
        const strong = td ? td.querySelector('strong') : null;
        const fechaRaw = strong ? strong.textContent : '';
        const textoNode = strong ? strong.parentNode : td;
        const cloned = textoNode ? textoNode.cloneNode(true) : null;
        if (cloned && cloned.querySelector('strong')) cloned.querySelector('strong').remove();
        const texto = cloned ? cleanText(cloned.innerText || cloned.textContent || '') : '';
        const linkEl = tr.querySelector('a[href]');
        const linkRel = linkEl ? linkEl.getAttribute('href') : null;
        return { fechaRaw, texto, linkRel };
      });
    });

    const aclaracionesNorm = aclaraciones.map(a => {
      const { fecha, hora } = parseFechaHora(a.fechaRaw);
      return {
        fecha, hora,
        texto: cleanText(a.texto),
        archivo_url: a.linkRel ? absolutize(a.linkRel) : null,
      };
    });

    const archivos_adjuntos = await page.evaluate(() => {
      function cleanText(str) {
        return String(str || '')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&sol;/g, '/')
          .replace(/\s+/g, ' ')
          .replace(/<\/?[^>]+(>|$)/g, '')
          .trim();
      }
      const blocks = Array.from(document.querySelectorAll('ul.buy-detail-list'));
      return blocks.map(ul => {
        const link = ul.querySelector('a[href]');
        const href = link ? link.getAttribute('href') : null;
        const nombre = href ? href.split('/').pop() : null;
        return { nombre, href, label: cleanText(ul.innerText || ul.textContent || '') };
      });
    });

    const archivosAdjNorm = archivos_adjuntos.map(a => {
      const nombre = a.nombre;
      const archivo_url = a.href ? absolutize(a.href) : null;
      const extMatch = nombre ? nombre.match(/\.(pdf|docx?|xlsx?|zip|rar|7z|png|jpe?g|html|txt)$/i) : null;
      return {
        nombre,
        tipo: extMatch ? extMatch[1].toLowerCase() : 'otro',
        archivo_url,
        label: a.label || null,
      };
    });

    console.log(JSON.stringify({ aclaraciones: aclaracionesNorm, archivos_adjuntos: archivosAdjNorm }));
  } catch (err) {
    console.error('SCRAPER_ERROR:', err?.message || err);
    console.log(JSON.stringify({ aclaraciones: [], archivos_adjuntos: [] }));
  } finally {
    await browser.close();
  }
})();
EOF

echo ""
echo "✅ Instalación completa."
echo "Para probarlo, ejecutá:"
echo "   node $SCRAPER_DIR/scrape_arce.js 'https://www.comprasestatales.gub.uy/consultas/detalle/id/i479479'"
echo ""
echo "Después, en n8n usá Execute Command con:"
echo "   node $SCRAPER_DIR/scrape_arce.js '{{$json.url_detalle}}'"

