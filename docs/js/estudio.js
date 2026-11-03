// Lógica de estudio: repaso del día, racha, modo examen, plan de examen y copias de seguridad.

import { hoy } from "./db.js";

// ---------- Meta diaria y racha ----------
export function metaDiaria() {
  try {
    return Number(localStorage.getItem("finlay.meta")) || 15;
  } catch {
    return 15;
  }
}

export function guardarMeta(n) {
  try {
    localStorage.setItem("finlay.meta", String(n));
  } catch {}
}

/** Días seguidos estudiando (cuenta hoy si ya estudiaste, si no, hasta ayer). */
export function calcularRacha(diario) {
  const dias = new Set(diario.filter((d) => d.preguntas > 0).map((d) => d.fecha));
  const fecha = new Date();
  if (!dias.has(hoy(fecha))) fecha.setDate(fecha.getDate() - 1);
  let racha = 0;
  while (dias.has(hoy(fecha))) {
    racha++;
    fecha.setDate(fecha.getDate() - 1);
  }
  const deHoy = diario.find((d) => d.fecha === hoy()) || { preguntas: 0, correctas: 0 };
  return { racha, hoy: deHoy };
}

// ---------- Repaso del día ----------
/**
 * Elige las preguntas de hoy: primero las que "tocan" según el repaso espaciado
 * (las falladas antes), y luego algunas nuevas que nunca has respondido.
 */
export function preguntasDelRepaso(docs, respuestas, maximo = 15, nuevasMax = 5) {
  const porId = new Map(docs.map((d) => [d.id, d]));
  const fecha = hoy();
  const tocan = respuestas
    .filter((r) => r.proxima && r.proxima <= fecha && porId.get(r.docId)?.cuestionario?.[r.indice])
    .sort((a, b) => (a.caja || 0) - (b.caja || 0) || a.fecha - b.fecha)
    .map((r) => ({ doc: porId.get(r.docId), i: r.indice }));

  const respondidas = new Set(respuestas.map((r) => r.id));
  const nuevas = [];
  for (const d of [...docs].sort((a, b) => a.fecha - b.fecha)) {
    (d.cuestionario || []).forEach((_, i) => {
      if (!respondidas.has(`${d.id}|${i}`)) nuevas.push({ doc: d, i });
    });
  }
  const lista = tocan.slice(0, maximo);
  const huecos = Math.max(0, Math.min(nuevasMax, maximo - lista.length));
  return { lista: lista.concat(nuevas.slice(0, huecos)), pendientes: tocan.length, nuevas: nuevas.length };
}

// ---------- Modo examen ----------
export function barajar(lista) {
  const a = [...lista];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Preguntas al azar para el examen (sin las de autoevaluación). */
export function preguntasDeExamen(docs, cantidad) {
  const todas = [];
  for (const d of docs) (d.cuestionario || []).forEach((p, i) => p.tipo !== "abierta" && todas.push({ doc: d, i }));
  return barajar(todas).slice(0, cantidad);
}

/** Escala de evaluación de la educación superior cubana. */
export function nota(porcentaje) {
  if (porcentaje >= 90) return { nota: 5, texto: "Excelente", clase: "dominado" };
  if (porcentaje >= 80) return { nota: 4, texto: "Bien", clase: "en-camino" };
  if (porcentaje >= 70) return { nota: 3, texto: "Aprobado", clase: "en-camino" };
  return { nota: 2, texto: "Desaprobado", clase: "repasar" };
}

// ---------- Plan para el examen ----------
export function diasHasta(fecha) {
  const a = new Date(hoy() + "T00:00:00");
  const b = new Date(fecha + "T00:00:00");
  return Math.round((b - a) / 86400000);
}

/**
 * Reparte los temas en los días que faltan. Los temas más flojos van primero y,
 * si sobran días, los flojos se repiten. El último día queda para repaso general.
 * @param temas [{doc, estado, pct}] ya ordenados del más flojo al más fuerte
 */
export function repartirPlan(fechaExamen, temas) {
  const dias = diasHasta(fechaExamen);
  if (dias <= 0 || !temas.length) return [];
  const diasDeEstudio = Math.max(1, dias - 1);
  const flojos = temas.filter((t) => t.estado !== "dominado");
  const cola = [...temas];
  while (cola.length < diasDeEstudio && flojos.length) cola.push(...flojos);
  const porDia = Math.ceil(cola.length / diasDeEstudio);
  const plan = [];
  for (let d = 0; d < diasDeEstudio; d++) {
    const fecha = new Date(hoy() + "T00:00:00");
    fecha.setDate(fecha.getDate() + d);
    const delDia = cola.slice(d * porDia, (d + 1) * porDia);
    if (delDia.length) plan.push({ fecha: hoy(fecha), temas: delDia });
  }
  if (dias > 1) {
    const fecha = new Date(fechaExamen + "T00:00:00");
    fecha.setDate(fecha.getDate() - 1);
    plan.push({ fecha: hoy(fecha), temas: [], repasoGeneral: true });
  }
  return plan;
}

// ---------- Copias de seguridad y compartir ----------
/**
 * Crea un paquete de Finlay con los materiales indicados (mismo formato que los de Claude),
 * para guardar una copia o pasárselo a un compañero.
 */
export function crearPaquete({ titulo, docs, fragmentosPorDoc, respuestas = null, diario = null }) {
  const materiales = docs.map((d) => {
    const [anio, ...resto] = d.asignaturas[0].split("|");
    const paginas = [];
    for (const f of fragmentosPorDoc.get(d.id) || []) {
      const ultima = paginas[paginas.length - 1];
      if (ultima && ultima.n === f.pagina) ultima.texto += "\n" + f.texto;
      else paginas.push({ n: f.pagina, texto: f.texto });
    }
    const m = {
      anio: Number(anio),
      asignatura: resto.join("|"),
      nombre: d.nombre,
      tipo: d.tipo,
      etiqueta: d.etiqueta,
      paginas,
    };
    if (d.asignaturas.length > 1)
      m.tambienEn = d.asignaturas.slice(1).map((a) => {
        const [an, ...r] = a.split("|");
        return { anio: Number(an), asignatura: r.join("|") };
      });
    if (d.resumen) m.resumen = d.resumen;
    if (d.cuestionario) m.cuestionario = d.cuestionario;
    if (respuestas) {
      const propias = respuestas.filter((r) => r.docId === d.id);
      if (propias.length) m.progreso = propias.map(({ id, docId, ...resto }) => resto);
    }
    return m;
  });
  const paquete = { formato: "finlay-paquete", version: 1, titulo, creado: new Date().toISOString(), materiales };
  if (diario) paquete.diario = diario;
  return paquete;
}
