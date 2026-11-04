// Visor de diapositivas: muestra cada página/diapositiva con su formato original.
// - Paquetes de Claude: las diapositivas vienen como imágenes WebP guardadas en el teléfono.
// - PDF cargados desde el teléfono: se guarda el PDF y cada página se dibuja con pdf.js
//   solo cuando aparece en pantalla (así no se gasta memoria ni tiempo de más).

import { obtenerDiapositiva, obtenerArchivo } from "./db.js";
import { cargarPdfjs } from "./extraer.js";

const urls = new Set();          // direcciones temporales de imágenes, para liberarlas al salir
const pdfs = new Map();          // docId → documento pdf.js abierto
let observador = null;

/** ¿Este material se puede ver con su formato original? */
export function tieneVisual(doc) {
  return !!(doc.diapositivas || doc.pdf);
}

/** Devuelve una dirección de imagen para la página n (o null si no hay). */
export async function urlPagina(doc, n, ancho = 1000) {
  if (doc.diapositivas) {
    const blob = await obtenerDiapositiva(doc.id, n);
    if (!blob) return null;
    const u = URL.createObjectURL(blob);
    urls.add(u);
    return u;
  }
  if (doc.pdf) {
    let pdf = pdfs.get(doc.id);
    if (!pdf) {
      const blob = await obtenerArchivo(doc.id);
      if (!blob) return null;
      const pdfjs = await cargarPdfjs();
      pdf = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
      pdfs.set(doc.id, pdf);
    }
    if (n < 1 || n > pdf.numPages) return null;
    const pagina = await pdf.getPage(n);
    const base = pagina.getViewport({ scale: 1 });
    const vista = pagina.getViewport({ scale: Math.min(2.5, ancho / base.width) });
    const lienzo = document.createElement("canvas");
    lienzo.width = Math.round(vista.width);
    lienzo.height = Math.round(vista.height);
    await pagina.render({ canvasContext: lienzo.getContext("2d"), viewport: vista }).promise;
    pagina.cleanup();
    const blob = await new Promise((ok) => lienzo.toBlob(ok, "image/webp", 0.8));
    lienzo.width = lienzo.height = 0;
    if (!blob) return null;
    const u = URL.createObjectURL(blob);
    urls.add(u);
    return u;
  }
  return null;
}

/** Número total de páginas del material visual. */
export function totalPaginas(doc) {
  return doc.diapositivas || doc.paginas || 0;
}

/**
 * Activa la carga perezosa: cada <img data-diapo="n"> recibe su imagen
 * cuando se acerca a la pantalla.
 */
export function activarCarga(raiz, doc) {
  observador?.disconnect();
  const pendientes = [...raiz.querySelectorAll("img[data-diapo]")];
  const cargar = async (img) => {
    if (img.dataset.cargada) return;
    img.dataset.cargada = "1";
    const u = await urlPagina(doc, Number(img.dataset.diapo));
    if (u) img.src = u;
    else img.closest("figure")?.classList.add("diapo-sin-imagen");
  };
  if (!("IntersectionObserver" in window)) {
    pendientes.forEach(cargar);
    return;
  }
  observador = new IntersectionObserver((entradas) => {
    for (const e of entradas) if (e.isIntersecting) {
      observador.unobserve(e.target);
      cargar(e.target);
    }
  }, { rootMargin: "800px 0px" });
  pendientes.forEach((img) => observador.observe(img));
}

/** Libera la memoria al salir de la pantalla. */
export function liberar() {
  observador?.disconnect();
  observador = null;
  for (const u of urls) URL.revokeObjectURL(u);
  urls.clear();
  for (const pdf of pdfs.values()) pdf.destroy?.();
  pdfs.clear();
}
