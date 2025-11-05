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

  let resultado = { id, aclaraciones: [], archivos_adjuntos: [] };

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

    // Extraer aclaraciones
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

    // Extraer adjuntos
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

    resultado = { id, aclaraciones, archivos_adjuntos };
  } catch (err) {
    resultado = { id, error: err.message, aclaraciones: [], archivos_adjuntos: [] };
  } finally {
    await browser.close();
    process.stdout.write(JSON.stringify(resultado));
  }
})();

