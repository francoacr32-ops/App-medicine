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
// Ícono de cada asignatura (del plan de estudio de Medicina, de 1ro a 6to año)
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
  ["oftalmolog", "oftalmologia"], ["comunidad", "comunidad"], ["salud publica", "salud-publica"],
  ["ciencia, tecnologia", "cts"], ["tecnologia y sociedad", "cts"],
  ["medicina general integral", "mgi"], ["mgi", "mgi"],
];
export function imagenAsignatura(nombre, anio) {
  const n = sinTildes(nombre).toLowerCase();
  const par = ICONOS_ASIG.find(([clave]) => n.includes(clave));
  if (!par) return null;
  const icono = par[1] === "mgi" && Number(anio) === 6 ? "mgi-6" : par[1];
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

// ---------- Anillo grande de porcentaje (progreso general) ----------
export function htmlAnilloPct(pct, texto = "") {
  const r = 44;
  const c = 2 * Math.PI * r;
  return `<div class="anillo anillo-pct" role="img" aria-label="${pct}% ${esc(texto)}">
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="${r}" class="anillo-fondo"/>
      <circle cx="50" cy="50" r="${r}" class="anillo-valor" stroke-dasharray="${c.toFixed(1)}"
        stroke-dashoffset="${(c * (1 - Math.min(100, pct) / 100)).toFixed(1)}"/>
    </svg>
    <div class="anillo-texto"><b>${pct}%</b>${texto ? `<span>${esc(texto)}</span>` : ""}</div>
  </div>`;
}

// El tiempo de estudio se guarda y se calcula en tiempo.js (una sola tabla de sesiones).
export function textoTiempo(seg) {
  const h = Math.floor(seg / 3600);
  const m = Math.round((seg % 3600) / 60);
  return h ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`;
}

// ---------- Favoritos (conferencias guardadas) ----------
export function favoritos() {
  try { return JSON.parse(localStorage.getItem("finlay.favoritos") || "[]"); } catch { return []; }
}
export function esFavorito(id) {
  return favoritos().includes(id);
}
export function alternarFavorito(id) {
  const f = favoritos();
  const i = f.indexOf(id);
  if (i >= 0) f.splice(i, 1); else f.unshift(id);
  try { localStorage.setItem("finlay.favoritos", JSON.stringify(f)); } catch {}
  return i < 0;
}

// ---------- Puntos y nivel (salen de lo que de verdad has estudiado) ----------
const NIVELES = ["Principiante", "Estudiante", "Estudiante aplicado", "Estudiante constante", "Estudiante avanzado",
  "Estudiante destacado", "Casi residente", "Residente", "Especialista", "Profesor"];
export function puntosYNivel({ correctas, temasDominados, examenes, racha }) {
  const puntos = correctas * 10 + temasDominados * 50 + examenes * 20 + racha * 5;
  const n = Math.min(NIVELES.length, 1 + Math.floor(puntos / 500));
  return { puntos, nivel: n, nombreNivel: NIVELES[n - 1], faltan: n < NIVELES.length ? n * 500 - puntos : 0 };
}
export function textoPuntos(p) {
  return p >= 1000 ? (p / 1000).toFixed(1).replace(".0", "") + "k" : String(p);
}

// ---------- Descripción corta de cada asignatura (como en el diseño) ----------
const DESCRIPCIONES = [
  ["ontogenia", "Desarrollo del embrión y sistema osteomioarticular"],
  ["celula", "La célula, los tejidos básicos y la piel"],
  ["molecular", "Biomoléculas, ADN, ARN y síntesis de proteínas"],
  ["nervioso", "Estructura y función de los sistemas nervioso, endocrino y reproductor"],
  ["metabol", "Cómo el cuerpo obtiene y usa la energía de los alimentos"],
  ["sangre", "La sangre y las defensas del organismo"],
  ["cardiovascular", "Corazón, respiración, digestión y riñones"],
  ["psicolog", "La conducta humana y la relación médico-paciente"],
  ["genetic", "La herencia y las enfermedades genéticas"],
  ["microbiolog", "Bacterias, virus, hongos y parásitos"],
  ["medicina interna", "Diagnóstico y tratamiento de las enfermedades del adulto"],
  ["propedeutica", "El interrogatorio, el examen físico y los síntomas"],
  ["pediatr", "La salud del niño y del adolescente"],
  ["ginecolog", "Salud de la mujer, embarazo y parto"],
  ["cirug", "Enfermedades que se tratan con operación"],
  ["oftalmolog", "Los ojos y la visión"],
  ["comunidad", "La atención médica en el consultorio y el área de salud"],
  ["salud publica", "La salud de la población y la prevención"],
  ["tecnologia", "La ciencia y la tecnología en la sociedad"],
];
export function descripcionAsignatura(nombre, anio) {
  const n = sinTildes(nombre).toLowerCase();
  if (n.includes("medicina general integral"))
    return Number(anio) === 6 ? "El internado en la atención primaria de salud" : "Atención primaria a la persona, la familia y la comunidad";
  return DESCRIPCIONES.find(([c]) => n.includes(c))?.[1] || "";
}
