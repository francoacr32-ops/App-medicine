// Pantallas principales del diseño 1.2: Inicio, Temas, Progreso, Evaluaciones y Perfil.
// Cada función devuelve { titulo, html } o pinta directamente con las utilidades que recibe.

import { ico } from "./iconos.js";

export const ANIOS = ["1er año", "2do año", "3er año", "4to año", "5to año", "6to año"];

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ---------- Preferencias guardadas en el teléfono ----------
export function pref(clave, porDefecto = "") {
  try {
    return localStorage.getItem("finlay." + clave) ?? porDefecto;
  } catch {
    return porDefecto;
  }
}
export function guardarPref(clave, valor) {
  try {
    if (valor === "" || valor == null) localStorage.removeItem("finlay." + clave);
    else localStorage.setItem("finlay." + clave, valor);
  } catch {}
}

// ---------- Imagen de cada asignatura ----------
const sinTildes = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
// Ícono de cada asignatura (del plan de estudio de Medicina, de 1ro a 5to año)
const ICONOS_ASIG = [
  ["ontogenia", "ontogenia"], ["embrio", "ontogenia"],
  ["celula", "celula"], ["tejido", "celula"], ["histolog", "celula"],
  ["molecular", "biologia-molecular"], ["bioquim", "biologia-molecular"],
  ["nervioso", "nervioso"], ["endocrino", "nervioso"],
  ["metabol", "metabolismo"], ["nutric", "metabolismo"],
  ["sangre", "sangre"], ["inmun", "sangre"],
  ["cardiovascular", "cardiovascular"], ["respirat", "cardiovascular"], ["digestiv", "cardiovascular"], ["renal", "cardiovascular"],
  ["psicolog", "psicologia"], ["genetic", "genetica"], ["microbiolog", "microbiologia"], ["parasitolog", "microbiologia"],
  ["propedeutica", "propedeutica"], ["semiolog", "propedeutica"], ["medicina interna", "medicina-interna"],
  ["pediatr", "pediatria"], ["ginecolog", "ginecologia"], ["obstetric", "ginecologia"], ["cirug", "cirugia"],
  ["oftalmolog", "oftalmologia"], ["comunidad", "comunidad"],
  ["medicina general integral", "mgi"], ["mgi", "mgi"],
];
export function imagenAsignatura(nombre, anio) {
  const n = sinTildes(nombre).toLowerCase();
  const par = ICONOS_ASIG.find(([clave]) => n.includes(clave));
  if (!par) return null;
  const icono = par[1] === "mgi" && Number(anio) === 5 ? "mgi-5" : par[1];
  return `iconos/asig/${icono}.webp`;
}
export function htmlMiniatura(nombre, anio) {
  const img = imagenAsignatura(nombre, anio);
  return img
    ? `<img class="miniatura miniatura-dibujo" src="${img}" alt="" loading="lazy">`
    : `<span class="miniatura miniatura-icono">${ico("libro")}</span>`;
}

// ---------- Anillo de la meta diaria ----------
export function htmlAnillo(hechas, meta) {
  const pct = Math.min(100, Math.round((hechas / Math.max(1, meta)) * 100));
  const r = 44;
  const c = 2 * Math.PI * r;
  return `<div class="anillo" role="img" aria-label="Meta diaria: ${hechas} de ${meta} preguntas">
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="${r}" class="anillo-fondo"/>
      <circle cx="50" cy="50" r="${r}" class="anillo-valor" stroke-dasharray="${c.toFixed(1)}"
        stroke-dashoffset="${(c * (1 - pct / 100)).toFixed(1)}"/>
    </svg>
    <div class="anillo-texto">${ico("libro", "anillo-ico")}<b>${pct}%</b><span>Meta diaria</span><span>(${hechas} / ${meta})</span></div>
  </div>`;
}

// Línea de pulso (electrocardiograma) con la cruz médica en el centro
export const htmlPulso = `<svg class="pulso" viewBox="0 0 220 60" aria-hidden="true">
  <polyline points="0,34 40,34 52,34 60,14 70,52 78,34 92,34" />
  <polyline points="128,34 142,34 150,14 160,52 168,34 180,34 220,34" />
  <path class="pulso-cruz" d="M103 18h14v12h12v14h-12v12h-14V44H91V30h12z"/>
</svg>`;

// ---------- Gráfica de barras de los últimos 7 días ----------
export function htmlSemana(diario, hoyStr) {
  const dias = [];
  const base = new Date(hoyStr + "T12:00:00");
  for (let k = 6; k >= 0; k--) {
    const d = new Date(base);
    d.setDate(d.getDate() - k);
    const f = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const reg = diario.find((x) => x.fecha === f) || { preguntas: 0, correctas: 0 };
    dias.push({ f, n: reg.preguntas, ok: reg.correctas, letra: d.toLocaleDateString("es", { weekday: "narrow" }) });
  }
  const max = Math.max(5, ...dias.map((d) => d.n));
  const barras = dias
    .map((d, i) => {
      const alto = Math.round((d.n / max) * 100);
      const x = 10 + i * 40;
      return `<g>
        <rect x="${x}" y="${120 - alto}" width="24" height="${Math.max(alto, 2)}" rx="6" class="${d.f === hoyStr ? "barra-hoy" : "barra-dia"}"/>
        ${d.n ? `<text x="${x + 12}" y="${112 - alto}" text-anchor="middle" class="graf-num">${d.n}</text>` : ""}
        <text x="${x + 12}" y="138" text-anchor="middle" class="graf-dia">${esc(d.letra)}</text>
      </g>`;
    })
    .join("");
  return `<svg class="grafica" viewBox="0 0 290 145" role="img" aria-label="Preguntas respondidas en los últimos 7 días">
    <line x1="4" y1="120" x2="286" y2="120" class="graf-eje"/>${barras}</svg>`;
}

// ---------- Insignias ----------
export function insignias({ racha, totalRespondidas, temasDominados, mejorNota }) {
  return [
    { id: "racha3", t: "3 días seguidos", d: "Estudia 3 días sin parar", ok: racha >= 3, e: "🔥" },
    { id: "racha7", t: "Semana completa", d: "7 días seguidos", ok: racha >= 7, e: "📅" },
    { id: "racha30", t: "Constancia de hierro", d: "30 días seguidos", ok: racha >= 30, e: "🏅" },
    { id: "p50", t: "Primeras 50", d: "Responde 50 preguntas", ok: totalRespondidas >= 50, e: "✍️" },
    { id: "p500", t: "Medio millar", d: "Responde 500 preguntas", ok: totalRespondidas >= 500, e: "📚" },
    { id: "t1", t: "Primer tema dominado", d: "Domina un tema", ok: temasDominados >= 1, e: "✅" },
    { id: "t10", t: "10 temas dominados", d: "Domina 10 temas", ok: temasDominados >= 10, e: "🧠" },
    { id: "n5", t: "Excelente", d: "Saca 5 en un examen", ok: mejorNota >= 5, e: "🏆" },
  ];
}
