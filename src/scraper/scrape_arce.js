import puppeteer from "puppeteer";

const BASE_URL = "https://www.comprasestatales.gub.uy";
const url = process.argv[2];
const id = process.argv[3] || null;

if (!url) {
  process.stderr.write(JSON.stringify({ error: "Falta URL de entrada" }));
  process.exit(1);
}

// === Helpers ===
const absolutize = (href) =>
  href?.startsWith("http") ? href : href ? BASE_URL + href : null;

const cleanText = (str = "") =>
  str
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&sol;/g, "/")
    .replace(/\s+/g, " ")
    .replace(/<\/?[^>]+(>|$)/g, "")
    .trim();

const parseFechaHora = (raw = "") => {
  const m = raw.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
  if (!m) return { fecha: null, hora: null };
  const [, dd, mm, yyyy, hh, mi] = m;
  return { fecha: `${yyyy}-${mm}-${dd}`, hora: `${hh}:${mi}` };
};

// === Main ===
(async () => {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    defaultViewport: { width: 1366, height: 900 },
  });

  let resultado = {
    id,
    departamento: null,
    division: null,
    servicio: null,
    numero_llamado: null,
    tipo_compra: null,
    aclaraciones: [],
    archivos_adjuntos: [],
    items_extraidos: [],
  };

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({
      "Accept-Language": "es-UY,es;q=0.9,en;q=0.8",
    });
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const t = req.resourceType();
      if (["image", "font", "media", "stylesheet"].includes(t)) req.abort();
      else req.continue();
    });

    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

    // === 0️⃣ Extraer metadata del llamado ===
    const metadata = await page.evaluate(() => {
      const getData = (labelText) => {
        // Buscar en diferentes posibles estructuras del DOM
        const allLabels = Array.from(document.querySelectorAll("label, .label, strong, .field-label, dt"));
        for (const label of allLabels) {
          const text = label.textContent.trim().toLowerCase();
          if (text.includes(labelText.toLowerCase())) {
            // Intentar obtener el valor desde el siguiente elemento
            let valueElement = label.nextElementSibling;
            if (!valueElement) {
              // Si no hay siguiente elemento, buscar en el padre
              valueElement = label.parentElement;
            }
            if (valueElement) {
              let value = valueElement.textContent.trim();
              // Remover el label del valor si está incluido
              value = value.replace(label.textContent.trim(), "").trim();
              // Limpiar caracteres especiales
              value = value.replace(/^[:|\-–—]\s*/, "").trim();
              if (value && value.length > 0 && value.length < 500) {
                return value;
              }
            }
          }
        }

        // Estrategia alternativa: buscar en párrafos o divs
        const allText = document.body.innerText;
        const regex = new RegExp(labelText + "\\s*[:|-]?\\s*([^\\n]{1,200})", "i");
        const match = allText.match(regex);
        return match ? match[1].trim() : null;
      };

      return {
        departamento: getData("Departamento"),
        division: getData("División") || getData("Division"),
        servicio: getData("Servicio"),
        numero_llamado: getData("Número de Compra") || getData("Numero de Compra") || getData("N° de Compra"),
        tipo_compra: getData("Tipo de Compra") || getData("Modalidad"),
      };
    });

    // === 1️⃣ Extraer aclaraciones ===
    const aclaracionesRaw = await page.$$eval(".aclaration-container tr", (rows) =>
      rows.map((tr) => {
        const td = tr.querySelector("td");
        const strong = td?.querySelector("strong");
        const fechaRaw = strong?.textContent || "";
        const textoNode = strong ? strong.parentNode : td;
        if (textoNode && strong) textoNode.removeChild(strong);
        const texto = textoNode ? textoNode.innerText.trim() : "";
        const link = tr.querySelector("a[href]")?.getAttribute("href");
        return { fechaRaw, texto, link };
      })
    );

    const aclaraciones = aclaracionesRaw
      .map((a) => {
        const { fecha, hora } = parseFechaHora(a.fechaRaw);
        return {
          fecha,
          hora,
          texto: cleanText(a.texto),
          archivo_url: absolutize(a.link),
        };
      })
      .filter((a) => a.fecha || a.texto || a.archivo_url);

    // === 2️⃣ Extraer adjuntos ===
    const adjuntosRaw = await page.$$eval("ul.buy-detail-list", (blocks) =>
      blocks.map((ul) => {
        const link = ul.querySelector("a[href]");
        const href = link?.getAttribute("href");
        const nombre = href ? href.split("/").pop() : null;
        const label = ul.innerText || "";
        return { nombre, href, label };
      })
    );

    const archivos_adjuntos = adjuntosRaw
      .map((a) => {
        const ext = a.nombre?.match(/\.(pdf|docx?|xlsx?|zip|rar|7z|png|jpe?g|html|txt)$/i);
        return {
          nombre: a.nombre,
          tipo: ext ? ext[1].toLowerCase() : "otro",
          archivo_url: absolutize(a.href),
          label: cleanText(a.label),
        };
      })
      .filter((a) => a.archivo_url);

    // === 3️⃣ Extraer ítems del llamado ===
    const itemsExtraidos = await page.$$eval(
      ".row.item .desc-item h3",
      (elements) =>
        elements
          .map((el) =>
            el.textContent
              .replace(/\s+/g, " ")
              .replace(/Ítem\s*Nº\s*\d+/i, "")
              .trim()
          )
          .filter((txt) => txt && txt.length > 0)
    );

    const itemsUnicos = [...new Set(itemsExtraidos)];

    resultado = {
      id,
      departamento: metadata.departamento,
      division: metadata.division,
      servicio: metadata.servicio,
      numero_llamado: metadata.numero_llamado,
      tipo_compra: metadata.tipo_compra,
      aclaraciones,
      archivos_adjuntos,
      items_extraidos: itemsUnicos,
    };
  } catch (err) {
    resultado = {
      id,
      departamento: null,
      division: null,
      servicio: null,
      numero_llamado: null,
      tipo_compra: null,
      error: err.message,
      aclaraciones: [],
      archivos_adjuntos: [],
      items_extraidos: [],
    };
  } finally {
    await browser.close();
    process.stdout.write(JSON.stringify(resultado));
  }
})();

