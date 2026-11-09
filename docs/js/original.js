// Muestra un Word (.docx) o un PowerPoint (.pptx) con su formato original, sin internet,
// dentro de un visor con zoom (dos dedos o botones + / −).
import { cargarJSZip } from "./extraer.js";

const BASE = new URL("../lib/", import.meta.url).href;
const cargados = new Map();
function cargarScript(nombre, global) {
  if (window[global]) return Promise.resolve(window[global]);
  if (!cargados.has(nombre)) {
    cargados.set(nombre, new Promise((listo, fallo) => {
      const s = document.createElement("script");
      s.src = BASE + nombre;
      s.onload = () => (window[global] ? listo(window[global]) : fallo(new Error("No se pudo preparar el lector.")));
      s.onerror = () => { cargados.delete(nombre); fallo(new Error("No se pudo cargar el lector de Word/PowerPoint.")); };
      document.head.appendChild(s);
    }));
  }
  return cargados.get(nombre);
}

export function tipoOriginal(nombre = "") {
  const ext = String(nombre).toLowerCase().split(".").pop();
  return ext === "docx" || ext === "pptx" ? ext : null;
}

/** Dibuja el archivo dentro de `hoja`. Devuelve el ancho natural del contenido (para ajustar el zoom). */
export async function pintarOriginal(hoja, blob, tipo) {
  hoja.innerHTML = "";
  if (tipo === "docx") {
    await cargarJSZip();
    const docx = await cargarScript("docx-preview.min.js", "docx");
    await docx.renderAsync(blob, hoja, null, {
      className: "docx", inWrapper: true, breakPages: true, ignoreLastRenderedPageBreak: false,
      renderHeaders: true, renderFooters: true, renderFootnotes: true, useBase64URL: true, experimental: true,
    });
  } else if (tipo === "pptx") {
    const lib = await cargarScript("pptx-preview.umd.js", "pptxPreview");
    const visor = lib.init(hoja, { width: 960, height: 540, mode: "list" });
    await visor.preview(await blob.arrayBuffer());
    // La librería pone las diapositivas en una caja de alto fijo con su propio scroll: se deja crecer para verlas todas
    hoja.querySelectorAll(".pptx-preview-wrapper").forEach((w) => {
      w.style.height = "auto";
      w.style.overflow = "visible";
      w.style.background = "transparent";
    });
  } else {
    throw new Error("Formato no compatible.");
  }
  return Math.max(hoja.scrollWidth, 1);
}

/** Zoom con dos dedos y con botones. `marco` hace scroll; `hoja` es lo que se agranda. */
export function zoomOriginal(marco, hoja, botones, anchoNatural) {
  const ajustar = () => Math.min(1, (marco.clientWidth - 8) / anchoNatural);
  let escala = ajustar();
  const minimo = () => Math.min(0.25, ajustar());
  const poner = (e, cx = marco.clientWidth / 2, cy = 0) => {
    const nueva = Math.max(minimo(), Math.min(4, e));
    // Mantener el punto que se está mirando bajo los dedos
    const px = (marco.scrollLeft + cx) / escala, py = (marco.scrollTop + cy) / escala;
    escala = nueva;
    hoja.style.zoom = escala;
    marco.scrollLeft = px * escala - cx;
    marco.scrollTop = py * escala - cy;
    if (botones.pct) botones.pct.textContent = Math.round(escala * 100) + " %";
  };
  poner(escala);
  botones.mas?.addEventListener("click", () => poner(escala * 1.25));
  botones.menos?.addEventListener("click", () => poner(escala / 1.25));
  botones.ajustar?.addEventListener("click", () => { poner(ajustar()); marco.scrollLeft = 0; });

  let inicio = null;
  const distancia = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  marco.addEventListener("touchstart", (ev) => {
    if (ev.touches.length === 2) {
      const r = marco.getBoundingClientRect();
      inicio = { d: distancia(ev.touches), e: escala,
        cx: (ev.touches[0].clientX + ev.touches[1].clientX) / 2 - r.left, cy: (ev.touches[0].clientY + ev.touches[1].clientY) / 2 - r.top };
    }
  }, { passive: true });
  marco.addEventListener("touchmove", (ev) => {
    if (inicio && ev.touches.length === 2) {
      ev.preventDefault();
      poner(inicio.e * (distancia(ev.touches) / inicio.d), inicio.cx, inicio.cy);
    }
  }, { passive: false });
  marco.addEventListener("touchend", (ev) => { if (ev.touches.length < 2) inicio = null; });
  // Doble toque: alternar entre ajustado y 2×
  let ultimo = 0;
  marco.addEventListener("click", (ev) => {
    const ahora = Date.now();
    if (ahora - ultimo < 300) {
      const r = marco.getBoundingClientRect();
      poner(escala > ajustar() * 1.3 ? ajustar() : ajustar() * 2, ev.clientX - r.left, ev.clientY - r.top);
    }
    ultimo = ahora;
  });
}
