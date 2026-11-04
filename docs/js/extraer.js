// Extrae el texto de PDF, Word (.docx), PowerPoint (.pptx) y .txt dentro del teléfono.
// Devuelve una lista de páginas: [{ n, etiqueta, texto }]
//   etiqueta: "pág." (PDF y Word), "diap." (PowerPoint) o "parte" (texto sin páginas)

import { limpiar } from "./texto.js";

const BASE = new URL("../lib/", import.meta.url).href;

export const FORMATOS = ".pdf,.docx,.pptx,.txt";

export function tipoDeArchivo(nombre) {
  const ext = nombre.toLowerCase().split(".").pop();
  if (["pdf", "docx", "pptx", "txt"].includes(ext)) return ext;
  if (ext === "doc" || ext === "ppt") return "viejo";
  return null;
}

export async function extraerTexto(archivo, progreso = () => {}) {
  const tipo = tipoDeArchivo(archivo.name);
  if (tipo === "pdf") return extraerPdf(archivo, progreso);
  if (tipo === "docx") return extraerDocx(archivo);
  if (tipo === "pptx") return extraerPptx(archivo);
  if (tipo === "txt") return dividirEnPartes(await archivo.text());
  if (tipo === "viejo")
    throw new Error("Es un formato antiguo (.doc/.ppt). Ábrelo con WPS u Office y guárdalo como .docx o .pptx.");
  throw new Error("Formato no compatible. Usa PDF, Word (.docx), PowerPoint (.pptx) o .txt.");
}

// ---------- PDF ----------
let pdfjsPromesa = null;
export function cargarPdfjs() {
  if (!pdfjsPromesa) {
    pdfjsPromesa = import(BASE + "pdf.min.mjs").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = BASE + "pdf.worker.min.mjs";
      return pdfjs;
    });
  }
  return pdfjsPromesa;
}

async function extraerPdf(archivo, progreso) {
  progreso("Preparando el lector de PDF…");
  const pdfjs = await cargarPdfjs();
  const datos = new Uint8Array(await archivo.arrayBuffer());
  let pdf;
  try {
    pdf = await pdfjs.getDocument({ data: datos, isEvalSupported: false }).promise;
  } catch (e) {
    if (e && e.name === "PasswordException") throw new Error("El PDF tiene contraseña.");
    throw new Error("No se pudo abrir el PDF (puede estar dañado).");
  }
  const paginas = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    progreso(`Leyendo página ${n} de ${pdf.numPages}…`);
    const pagina = await pdf.getPage(n);
    const contenido = await pagina.getTextContent();
    let texto = "";
    for (const item of contenido.items) {
      if (!("str" in item)) continue;
      texto += item.str;
      texto += item.hasEOL ? "\n" : item.str && !item.str.endsWith(" ") ? " " : "";
    }
    paginas.push({ n, etiqueta: "pág.", texto: limpiar(texto) });
    pagina.cleanup();
  }
  await pdf.destroy();
  return paginas;
}

// ---------- Word y PowerPoint (son archivos ZIP con XML dentro) ----------
let jszipPromesa = null;
export function cargarJSZip() {
  if (!jszipPromesa) {
    jszipPromesa = new Promise((resolver, rechazar) => {
      if (window.JSZip) return resolver(window.JSZip);
      const s = document.createElement("script");
      s.src = BASE + "jszip.min.js";
      s.onload = () => resolver(window.JSZip);
      s.onerror = () => {
        jszipPromesa = null;
        rechazar(new Error("No se pudo cargar el lector de Word/PowerPoint. Revisa la conexión."));
      };
      document.head.appendChild(s);
    });
  }
  return jszipPromesa;
}

async function abrirZip(archivo) {
  const JSZip = await cargarJSZip();
  try {
    return await JSZip.loadAsync(await archivo.arrayBuffer());
  } catch {
    throw new Error("El archivo está dañado o no es un documento de Office válido.");
  }
}

function xml(texto) {
  return new DOMParser().parseFromString(texto, "application/xml");
}

async function extraerDocx(archivo) {
  const zip = await abrirZip(archivo);
  const entrada = zip.file("word/document.xml");
  if (!entrada) throw new Error("No parece un documento de Word válido.");
  const doc = xml(await entrada.async("string"));
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

  // Word guarda dónde caían los saltos de página la última vez que se abrió:
  // así podemos citar el número de página aproximado.
  const paginas = [];
  let n = 1;
  let actual = [];
  let hayPaginas = false;
  const cerrarPagina = () => {
    paginas.push({ n: n++, etiqueta: "pág.", texto: limpiar(actual.join("\n")) });
    actual = [];
  };

  for (const p of doc.getElementsByTagNameNS(W, "p")) {
    let linea = "";
    const recorrer = (nodo) => {
      for (const hijo of nodo.childNodes) {
        if (hijo.namespaceURI !== W) {
          // mc:Fallback repite el mismo texto que mc:Choice: lo saltamos
          if (hijo.localName !== "Fallback" && hijo.childNodes?.length) recorrer(hijo);
          continue;
        }
        const nombre = hijo.localName;
        if (nombre === "t") linea += hijo.textContent;
        else if (nombre === "tab") linea += " ";
        else if (nombre === "lastRenderedPageBreak" || (nombre === "br" && hijo.getAttributeNS(W, "type") === "page")) {
          hayPaginas = true;
          if (linea.trim() || actual.length) {
            actual.push(linea);
            linea = "";
            cerrarPagina();
          }
        } else if (nombre === "br") linea += "\n";
        else if (nombre !== "p" && hijo.childNodes.length) recorrer(hijo);
      }
    };
    recorrer(p);
    if (linea.trim()) actual.push(linea);
  }
  if (actual.length) cerrarPagina();

  if (!hayPaginas) return dividirEnPartes(paginas.map((p) => p.texto).join("\n"));
  return paginas.filter((p) => p.texto);
}

async function extraerPptx(archivo) {
  const zip = await abrirZip(archivo);
  const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const diapositivas = Object.keys(zip.files)
    .map((nombre) => nombre.match(/^ppt\/slides\/slide(\d+)\.xml$/))
    .filter(Boolean)
    .map((m) => ({ ruta: m[0], n: Number(m[1]) }))
    .sort((a, b) => a.n - b.n);
  if (!diapositivas.length) throw new Error("No parece una presentación de PowerPoint válida.");

  const paginas = [];
  for (const d of diapositivas) {
    const doc = xml(await zip.file(d.ruta).async("string"));
    const lineas = [];
    for (const p of doc.getElementsByTagNameNS(A, "p")) {
      const t = [...p.getElementsByTagNameNS(A, "t")].map((x) => x.textContent).join("");
      if (t.trim()) lineas.push(t);
    }
    // Notas del orador (a veces contienen la explicación de la diapositiva)
    const notas = zip.file(`ppt/notesSlides/notesSlide${d.n}.xml`);
    if (notas) {
      const docN = xml(await notas.async("string"));
      const t = [...docN.getElementsByTagNameNS(A, "p")]
        .map((p) => [...p.getElementsByTagNameNS(A, "t")].map((x) => x.textContent).join(""))
        .filter((x) => x.trim() && !/^\d+$/.test(x.trim()));
      if (t.length) lineas.push("Notas: " + t.join("\n"));
    }
    paginas.push({ n: d.n, etiqueta: "diap.", texto: limpiar(lineas.join("\n")) });
  }
  return paginas;
}

// ---------- Texto sin páginas ----------
function dividirEnPartes(texto, tamano = 3000) {
  const limpio = limpiar(texto);
  // Si el texto trae saltos de página (\f), los usamos
  if (limpio.includes("\f")) {
    return limpio.split("\f").map((t, i) => ({ n: i + 1, etiqueta: "pág.", texto: t.trim() }));
  }
  const parrafos = limpio.split(/\n/);
  const partes = [];
  let actual = "";
  for (const p of parrafos) {
    if (actual && actual.length + p.length > tamano) {
      partes.push(actual);
      actual = "";
    }
    actual += (actual ? "\n" : "") + p;
  }
  if (actual.trim()) partes.push(actual);
  return partes.map((t, i) => ({ n: i + 1, etiqueta: "parte", texto: t }));
}
