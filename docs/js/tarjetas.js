// Tarjetas de memoria (flashcards) con repaso espaciado.
// Salen de dos lugares, sin internet:
//  1. Las preguntas de los cuestionarios (cada afirmación de V o F, cada pareja de enlace…).
//  2. Las definiciones del texto de las conferencias ("La mitosis es…", "Osteología: estudio de…"),
//     así los materiales nuevos tienen tarjetas aunque todavía no tengan cuestionario.
// El progreso de cada tarjeta se guarda en el teléfono (finlay.tarjetas).

const CLAVE = "finlay.tarjetas";
const DIAS = [0, 1, 3, 7, 14, 30, 60];

const limpiar = (s) => String(s || "").replace(/\s+/g, " ").trim();
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Tarjetas sacadas del cuestionario de un material */
export function tarjetasDePreguntas(doc, textoRespuesta) {
  const salida = [];
  (doc.cuestionario || []).forEach((p, i) => {
    if (p.oculta) return; // pregunta quitada por el estudiante
    const base = { docId: doc.id, fuente: p.fuente || "", cita: p.cita || "", origen: "pregunta" };
    if (p.tipo === "vf" && Array.isArray(p.afirmaciones)) {
      p.afirmaciones.forEach((a, j) => salida.push({ ...base, id: `${doc.id}|p${i}|${j}`,
        frente: `¿Verdadero o falso?\n${a.texto}`, dorso: a.respuesta ? "Verdadero" : "Falso" }));
    } else if (p.tipo === "enlazar" && Array.isArray(p.columnaA)) {
      p.columnaA.forEach((a, j) => salida.push({ ...base, id: `${doc.id}|p${i}|${j}`,
        frente: `${limpiar(p.pregunta || "Enlace")}\n${a}`, dorso: p.columnaB?.[p.pares?.[j]] ?? "" }));
    } else {
      const frente = p.tipo === "completar" ? String(p.pregunta).replace(/_{2,}/g, "______") : p.pregunta;
      const dorso = p.tipo === "abierta" ? p.respuesta : textoRespuesta(p);
      if (frente && dorso) salida.push({ ...base, id: `${doc.id}|p${i}`, frente: limpiar(frente), dorso: limpiar(dorso) });
    }
  });
  return salida;
}

/**
 * Tarjetas automáticas a partir de las definiciones del texto.
 * paginas: [{ pagina, texto }]. Devuelve como mucho `maximo` tarjetas por material.
 */
export function tarjetasDeDefiniciones(doc, paginas, maximo = 40) {
  const salida = [];
  const vistos = new Set();
  const VERBO = /^(.{3,70}?)\s+(es|son|se define como|se definen como|se denomina|se denominan|consiste en|constituye|constituyen)\s+(.{15,240})$/i;
  const DOS_PUNTOS = /^([A-ZÁÉÍÓÚÑ][\wáéíóúñü ,()/-]{2,55}):\s+(.{15,240})$/;
  for (const { pagina, texto } of paginas) {
    const frases = String(texto).split(/\n+|(?<=[.;])\s+(?=[A-ZÁÉÍÓÚÑ¿])/).map(limpiar).filter((f) => f.length > 20);
    for (const f of frases) {
      if (salida.length >= maximo) return salida;
      let termino, explicacion, verbo;
      const m1 = f.match(VERBO);
      const m2 = !m1 && f.match(DOS_PUNTOS);
      if (m1) {
        [, termino, verbo, explicacion] = m1;
        termino = termino.replace(/^(la|el|los|las|un|una)\s+/i, "");
        if (termino.split(" ").length > 8 || /[,;]/.test(termino) || /^(esto|esta|este|ello|que|lo|se|no|también)\b/i.test(termino)) continue;
      } else if (m2) {
        [, termino, explicacion] = m2;
        if (/^(nota|notas|objetivo|objetivos|bibliografia|bibliografía|sumario|introducción|conclusiones|tema|ejemplo|ejemplos)$/i.test(termino.trim())) continue;
      } else continue;
      const clave = termino.toLowerCase();
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      const plural = /^(son|se definen|se denominan|constituyen)/i.test(verbo || "");
      salida.push({
        id: `${doc.id}|d${pagina}|${salida.length}`, docId: doc.id, origen: "definicion",
        frente: m1 ? `¿Qué ${plural ? "son" : "es"} ${termino.replace(/\.$/, "")}?` : `${termino.trim()}`,
        dorso: capital(limpiar(m1 ? f : explicacion).replace(/\.$/, "")) + ".",
        fuente: `${doc.etiqueta || "pág."} ${pagina}`, cita: m1 ? f : explicacion,
      });
    }
  }
  return salida;
}

// ---------- Progreso (repaso espaciado) ----------
function leer() {
  try { return JSON.parse(localStorage.getItem(CLAVE) || "{}"); } catch { return {}; }
}
function escribir(e) {
  try { localStorage.setItem(CLAVE, JSON.stringify(e)); } catch {}
}
const sumarDias = (fecha, n) => {
  const d = new Date(fecha + "T12:00:00");
  d.setDate(d.getDate() + n);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

/** Tarjetas para hoy: primero las que tocan repasar, luego unas nuevas (como mucho `nuevas`) */
export function mazoDeHoy(todas, hoy, nuevas = 20) {
  const e = leer();
  const tocan = todas.filter((t) => e[t.id] && e[t.id].proxima <= hoy).sort((a, b) => e[a.id].proxima.localeCompare(e[b.id].proxima));
  const sinVer = todas.filter((t) => !e[t.id]);
  return { lista: [...tocan, ...sinVer.slice(0, nuevas)], pendientes: tocan.length, nuevasTotal: sinVer.length };
}

/** Calificación: 0 = otra vez, 1 = difícil, 2 = bien, 3 = fácil */
export function calificar(id, nota, hoy) {
  const e = leer();
  const t = e[id] || { caja: 0, vistas: 0 };
  t.vistas++;
  t.caja = nota === 0 ? 0 : nota === 1 ? Math.max(1, t.caja) : Math.min(DIAS.length - 1, t.caja + (nota === 3 ? 2 : 1));
  t.proxima = sumarDias(hoy, nota === 0 ? 0 : nota === 1 ? 1 : DIAS[t.caja]);
  t.ultima = hoy;
  e[id] = t;
  escribir(e);
  return t;
}
export function proximoTexto(nota, id) {
  const t = leer()[id] || { caja: 0 };
  const caja = nota === 0 ? 0 : nota === 1 ? Math.max(1, t.caja) : Math.min(DIAS.length - 1, t.caja + (nota === 3 ? 2 : 1));
  const dias = nota === 0 ? 0 : nota === 1 ? 1 : DIAS[caja];
  return dias === 0 ? "hoy" : dias === 1 ? "mañana" : `${dias} días`;
}
export function estadoTarjetas(todas) {
  const e = leer();
  const vistas = todas.filter((t) => e[t.id]).length;
  const dominadas = todas.filter((t) => e[t.id]?.caja >= 3).length;
  return { total: todas.length, vistas, dominadas };
}
