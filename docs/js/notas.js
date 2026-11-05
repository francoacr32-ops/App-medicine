// Notas personales y marcadores en las diapositivas, y reportes de errores en las preguntas.
// Todo queda en el teléfono (localStorage).

const NOTAS = "finlay.notas";
const REPORTES = "finlay.reportes";

function leer(clave, vacio) {
  try { return JSON.parse(localStorage.getItem(clave) || "null") ?? vacio; } catch { return vacio; }
}
function escribir(clave, v) {
  try { localStorage.setItem(clave, JSON.stringify(v)); } catch {}
}

// ---------- Notas y marcadores: clave "docId|n" → { t: texto, m: marcada, f: fecha } ----------
export function notasDe(docId) {
  const todas = leer(NOTAS, {});
  const salida = {};
  for (const [k, v] of Object.entries(todas)) if (k.startsWith(docId + "|")) salida[Number(k.split("|")[1])] = v;
  return salida;
}
export function todasLasNotas() {
  return Object.entries(leer(NOTAS, {})).map(([k, v]) => ({ docId: k.split("|")[0], n: Number(k.split("|")[1]), ...v }));
}
export function guardarNota(docId, n, texto) {
  const todas = leer(NOTAS, {});
  const k = `${docId}|${n}`;
  const actual = todas[k] || {};
  const t = String(texto || "").trim();
  if (!t && !actual.m) delete todas[k];
  else todas[k] = { ...actual, t, f: Date.now() };
  escribir(NOTAS, todas);
}
export function alternarMarca(docId, n) {
  const todas = leer(NOTAS, {});
  const k = `${docId}|${n}`;
  const actual = todas[k] || {};
  const m = !actual.m;
  if (!m && !actual.t) delete todas[k];
  else todas[k] = { ...actual, m, f: Date.now() };
  escribir(NOTAS, todas);
  return m;
}

// ---------- Reportes de errores ----------
export function reportes() {
  return leer(REPORTES, []);
}
export function reportar(datos) {
  const lista = reportes();
  lista.push({ ...datos, fecha: Date.now() });
  escribir(REPORTES, lista);
  return lista.length;
}
export function borrarReportes() {
  escribir(REPORTES, []);
}
/** Texto para mandar a Claude (por WhatsApp, Zapya…) con todos los reportes */
export function textoDeReportes() {
  const lista = reportes();
  return `Reportes de errores de Finlay (${lista.length})\n\n` + lista.map((r, k) =>
    `${k + 1}. ${r.material} — pregunta ${r.indice + 1}${r.fuente ? ` (${r.fuente})` : ""}\n` +
    `   Pregunta: ${r.pregunta}\n   Problema: ${r.comentario}\n   Fecha: ${new Date(r.fecha).toLocaleDateString("es")}\n`).join("\n");
}
