import type { Rubro } from '../pipeline/filtro.js';

// Prompts en español, derivados de scripts/procesar_analisis_batch.sh, parametrizados por rubro.
// Todas las escalas de confianza son 0-100. No hay bloque "NUNCA null": lo garantiza el esquema JSON.

export function systemPrompt(rubro: Rubro): string {
  return `Eres un analizador especializado en licitaciones públicas de Uruguay (portal ARCE / Compras Estatales) que trabaja para una ${rubro.descripcion}. Respondes únicamente con JSON válido que cumpla el esquema indicado, en español, sin texto adicional.`;
}

export function bloqueCriterios(rubro: Rubro): string {
  const lista = (items: string[]) => items.map((i) => `- ${i}`).join('\n');
  return `CRITERIOS DE RELEVANCIA Y CONFIANZA (confianza es un entero de 0 a 100):

RELEVANTE (es_relevante=true):
${lista(rubro.relevancia.relevante)}
${rubro.relevancia.parcial.length ? `\nPARCIALMENTE RELEVANTE (es_relevante=true, pero menor confianza):\n${lista(rubro.relevancia.parcial)}\n` : ''}
NO RELEVANTE (es_relevante=false):
${lista(rubro.relevancia.no_relevante)}

REGLA CLAVE: ${rubro.relevancia.regla_clave}
La confianza expresa qué tan seguro estás de la decisión es_relevante: si es_relevante=false y es claramente ajeno al rubro, usa confianza alta (80-100) de que NO es relevante.`;
}

export const BLOQUE_VISITA = `DETECCIÓN DE VISITA OBLIGATORIA (CRÍTICO):
Busca estos patrones en CUALQUIER parte del contenido (título, descripción, pliego, aclaraciones):
"visita obligatoria", "visita previa obligatoria", "visita técnica obligatoria", "se requiere visita",
"deberá realizar visita", "visita al lugar", "inspección previa", "visita de obra".
Si encuentras alguno, requiere_visita DEBE ser true.

CUANDO requiere_visita=true, extrae TODA esta información:
A) UBICACIÓN DE LA VISITA: dirección exacta, edificio, referencias (secciones "Visita Técnica", "Lugar de Visita", "Inspección", "Ubicación"). Si no hay dirección específica de visita, usa la ubicación de obra.
B) COORDINACIÓN: coordina_visita=true si dice "coordinar previamente", "comunicarse con", "contactar para agendar", "solicitar visita"; coordina_visita=false si hay fecha/horario fijo.
C) FECHA Y HORARIO: si hay fecha fija, fecha_visita_especifica en formato YYYY-MM-DD; si debe coordinarse, null.
D) CONTACTOS: nombre de persona/departamento, teléfono (con extensiones, ej. "+598 1825 int 01200"), correo electrónico. Suelen estar en "Contacto", "Informes", "Coordinación" o al final del pliego.

REGLA DE COHERENCIA:
- requiere_visita=true sin ubicacion_visita → usa ubicacion_obra.
- requiere_visita=true con contacto (tel/mail) y sin fecha → coordina_visita=true.
- requiere_visita=false → ubicacion_visita=null, fecha_visita_especifica=null, coordina_visita=false y contactos=null.`;

export const BLOQUE_FORMATO = `REGLAS DE FORMATO:
1. descripcion_llamado: resumen ESPECÍFICO y DESCRIPTIVO en ≤150 caracteres con la forma "<tipo de trabajo> de <material/objeto principal> en <lugar u organismo, si aparece>", usando SOLO datos que estén en el contenido. Nunca inventes lugares, cantidades ni materiales. Nunca frases genéricas como "Licitación para..." o "Adquisición de materiales".
2. resumen_trabajo: describe DETALLADAMENTE el trabajo: cantidades, especificaciones técnicas (tipos de vidrio, medidas, colores), plazos, lugar de instalación, requisitos especiales. Mínimo 2-3 oraciones completas.
3. razon: explicación clara y específica de por qué es o no relevante, mencionando los materiales encontrados o su ausencia. Si el contenido es insuficiente, dilo en la razón y baja la confianza.
4. materiales_detectados: SOLO materiales que REALMENTE aparecen en el llamado; no agregues genéricos.
5. ubicacion_obra: dirección/ciudad/departamento tal como aparece en el pliego, o null.
6. contacto_visita_correo: SOLO el email, sin URLs ni texto adicional.
7. formularios_requeridos: cada formulario/anexo/planilla/declaración jurada que deba presentarse, con nombre exacto, si es obligatorio y la sección del pliego ("Anexo II", "Capítulo 5"); en Title Case y sin duplicados. Busca "deberá presentar", "se adjunta formulario", "completar anexo", "declaración jurada", "planilla de cotización".
8. Todo el texto en español.`;

export function promptAnalisisCompleto(rubro: Rubro, contenido: string): string {
  return `Analiza este llamado de licitación y extrae información estructurada.

IMPORTANTE - ANALIZA TODAS LAS FUENTES POR IGUAL:
1. El TÍTULO del llamado (puede contener "visita obligatoria", tipo de obra, etc.)
2. La DESCRIPCIÓN del llamado
3. El contenido del ARCHIVO ADJUNTO (pliego)
4. Los ITEMS/PRODUCTOS solicitados
5. Las ACLARACIONES oficiales
No bases tu análisis solo en el pliego: el título y la descripción pueden tener información crítica.

${bloqueCriterios(rubro)}

${BLOQUE_VISITA}

${BLOQUE_FORMATO}

Contenido completo del llamado:
${contenido}`;
}

export function promptChunk(rubro: Rubro, indice: number, total: number, fragmento: string): string {
  return `Eres un analizador de licitaciones para una ${rubro.descripcion}.

Este es el FRAGMENTO ${indice} de ${total} de un pliego de licitación. EXTRAE SOLO la información presente en ESTE fragmento:

1) resumen_fragmento: 2-4 oraciones con qué se pide en este fragmento (objeto, cantidades, materiales, plazos). Si el fragmento es solo texto legal/administrativo sin información del trabajo, dilo.
2) materiales mencionados (ej.: ${rubro.materiales_ejemplo.join(', ')}): solo los que aparecen.
3) ubicacion_obra: dirección, ciudad, departamento, referencias geográficas.
4) VISITA TÉCNICA: patrones "visita obligatoria", "visita técnica", "inspección previa", "deberá realizar visita"; ubicación de la visita; fecha (YYYY-MM-DD) y horario; si debe coordinarse ("coordinar previamente", "comunicarse con"); contactos (nombre, teléfono con extensiones, correo).
5) formularios requeridos para presentar la oferta: nombre exacto, obligatorio u opcional, sección del pliego (ej. "Anexo II").

Si un dato no está en este fragmento, usa null (o lista vacía).

Fragmento:
${fragmento}`;
}

export function promptSintesis(rubro: Rubro, titulo: string, fragmentosJson: string): string {
  return `Eres un analizador de licitaciones para una ${rubro.descripcion}.

Tienes los análisis parciales de todos los fragmentos del pliego "${titulo}" (en orden):
${fragmentosJson}

COMBINA toda la información en el esquema JSON completo del análisis.

${bloqueCriterios(rubro)}

${BLOQUE_VISITA}

${BLOQUE_FORMATO}

CRITERIOS ADICIONALES DE SÍNTESIS:
- Unifica materiales (sin duplicados).
- Si varios fragmentos mencionan ubicación, consolida en una sola.
- Lista TODOS los formularios encontrados sin duplicar.
- Si un fragmento detectó visita obligatoria, requiere_visita=true aunque otros no la mencionen.`;
}

export function promptFallback(rubro: Rubro, textoMetadatos: string): string {
  return `Eres un analizador de licitaciones para una ${rubro.descripcion}.

Analiza esta licitación basándote SOLO en título, descripción, ítems y aclaraciones: los archivos adjuntos no pudieron ser extraídos (o no existen).

${textoMetadatos}

${bloqueCriterios(rubro)}

${BLOQUE_FORMATO}

IMPORTANTE: como no tienes acceso al pliego, la confianza debe ser MODERADA: máximo 50 (escala 0-100). requiere_visita=false salvo que el título/descripción diga explícitamente que hay visita obligatoria.`;
}
