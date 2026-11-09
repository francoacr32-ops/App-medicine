// Tipos de preguntas, al estilo de los exámenes cubanos:
//   multiple  → Selección única (una opción correcta)
//   marcar    → Marque con una X (puede haber varias correctas)
//   vf        → Verdadero o falso (una afirmación o una lista de afirmaciones)
//   enlazar   → Enlace la columna A con la columna B
//   completar → Complete los espacios en blanco (___)
//   abierta   → Pregunta y respuesta (te autoevalúas)

import { normalizar } from "./texto.js";

export const NOMBRE_TIPO = {
  vf: "Verdadero o falso",
  marcar: "Marque con una X",
  enlazar: "Enlace",
  completar: "Complete",
  multiple: "Selección única",
  abierta: "Pregunta y respuesta",
};

const LETRAS = "abcdefghijklmnopqrstuvwxyz";
const HUECO = /_{3,}/g;

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** ¿Es un V o F con varias afirmaciones? */
const esLista = (p) => p.tipo === "vf" && Array.isArray(p.afirmaciones);

/** Las preguntas que se responden con un toque (sin botón "Comprobar"). */
export const esInmediata = (p) => p.tipo === "multiple" || (p.tipo === "vf" && !esLista(p));

/** HTML de las opciones de una pregunta. */
export function htmlOpciones(p, i) {
  const comprobar = `<button class="btn mini" data-accion="comprobar" data-i="${i}">✔ Comprobar</button>`;
  switch (p.tipo) {
    case "multiple":
      return p.opciones
        .map((o, j) => `<button class="opcion" data-accion="responder" data-i="${i}" data-r="${j}"><span class="letra">${LETRAS[j].toUpperCase()}</span><span>${esc(o)}</span></button>`)
        .join("");
    case "vf":
      if (!esLista(p))
        return `<button class="opcion" data-accion="responder" data-i="${i}" data-r="true">Verdadero</button>
                <button class="opcion" data-accion="responder" data-i="${i}" data-r="false">Falso</button>`;
      return (
        p.afirmaciones
          .map(
            (a, j) => `<div class="fila-vf" data-j="${j}">
              <span class="vf-botones">
                <label><input type="radio" name="p${i}a${j}" value="V"> V</label>
                <label><input type="radio" name="p${i}a${j}" value="F"> F</label>
              </span>
              <span>${LETRAS[j]}) ${esc(a.texto)}</span></div>`
          )
          .join("") + comprobar
      );
    case "marcar":
      return (
        p.opciones
          .map(
            (o, j) => `<label class="opcion marca" data-j="${j}">
              <input type="checkbox" value="${j}"> <span class="letra">${LETRAS[j].toUpperCase()}</span><span>${esc(o)}</span></label>`
          )
          .join("") + comprobar
      );
    case "enlazar": {
      const opcionesB = p.columnaB.map((_, k) => `<option value="${k}">${LETRAS[k]}</option>`).join("");
      return `<div class="enlace">
          <div><p class="sub">Columna A</p>${p.columnaA
            .map(
              (a, j) => `<div class="fila-enlace" data-j="${j}">
                <select aria-label="Respuesta para ${j + 1}"><option value="">—</option>${opcionesB}</select>
                <span>${j + 1}. ${esc(a)}</span></div>`
            )
            .join("")}</div>
          <div><p class="sub">Columna B</p>${p.columnaB.map((b, k) => `<p class="item-b">${LETRAS[k]}) ${esc(b)}</p>`).join("")}</div>
        </div>${comprobar}`;
    }
    case "completar":
      return comprobar;
    default:
      return `<button class="btn mini" data-accion="ver-respuesta" data-i="${i}">👁 Ver respuesta</button>`;
  }
}

/** Enunciado: en "completar" los ___ se convierten en casillas para escribir. */
export function htmlEnunciado(p) {
  if (p.tipo !== "completar") return esc(p.pregunta);
  let n = 0;
  return esc(p.pregunta).replace(HUECO, () => `<input class="hueco" data-h="${n++}" autocomplete="off" aria-label="Espacio ${n}">`);
}

const respuestasDeHueco = (r) => (Array.isArray(r) ? r : [r]);
const igual = (a, b) => normalizar(a).replace(/\s+/g, " ").trim() === normalizar(b).replace(/\s+/g, " ").trim();

/** Texto con la respuesta correcta (para mostrar y para la voz). */
export function textoRespuesta(p) {
  switch (p.tipo) {
    case "multiple":
      return `La respuesta correcta es ${LETRAS[p.correcta].toUpperCase()}) ${p.opciones[p.correcta]}.`;
    case "marcar":
      return "Las correctas son: " + p.correctas.map((j) => `${LETRAS[j].toUpperCase()}) ${p.opciones[j]}`).join("; ") + ".";
    case "vf":
      if (!esLista(p)) return `Es ${p.respuesta ? "verdadero" : "falso"}.`;
      return p.afirmaciones.map((a, j) => `${LETRAS[j]}) ${a.respuesta ? "V" : "F"}`).join(", ") + ".";
    case "enlazar":
      return "Respuestas: " + p.pares.map((k, j) => `${j + 1}-${LETRAS[k]}`).join(", ") + ".";
    case "completar":
      return "Respuestas: " + p.respuestas.map((r) => respuestasDeHueco(r)[0]).join("; ") + ".";
    default:
      return `Respuesta: ${p.respuesta}`;
  }
}

/**
 * Corrige la pregunta y marca en pantalla lo que está bien y mal.
 * @returns {{correcta: boolean, aciertos: number, total: number} | null}  null si falta responder algo
 */
export function corregir(p, tarjeta, valor) {
  const marcar = (el, ok) => el.classList.add(ok ? "bien" : "mal");
  const bloquear = () => tarjeta.querySelectorAll("input, select, .opcion, [data-accion=comprobar], [data-accion=autoevaluar]").forEach((el) => (el.disabled = true));

  if (p.tipo === "multiple" || (p.tipo === "vf" && !esLista(p))) {
    const elegida = String(valor);
    tarjeta.querySelectorAll(".opcion").forEach((b) => {
      const r = b.dataset.r;
      const buena = p.tipo === "multiple" ? Number(r) === p.correcta : (r === "true") === p.respuesta;
      if (buena) b.classList.add("bien");
      else if (r === elegida) b.classList.add("mal");
    });
    bloquear();
    const correcta = p.tipo === "multiple" ? Number(valor) === p.correcta : (valor === "true") === p.respuesta;
    return { correcta, aciertos: correcta ? 1 : 0, total: 1 };
  }

  if (p.tipo === "abierta") {
    bloquear();
    const correcta = valor === "si";
    return { correcta, aciertos: correcta ? 1 : 0, total: 1 };
  }

  if (p.tipo === "marcar") {
    const filas = [...tarjeta.querySelectorAll(".marca")];
    if (!filas.some((f) => f.querySelector("input").checked)) return null;
    let aciertos = 0;
    filas.forEach((f) => {
      const j = Number(f.dataset.j);
      const marcada = f.querySelector("input").checked;
      const debe = p.correctas.includes(j);
      if (marcada === debe) aciertos++;
      if (debe) {
        f.classList.add("bien");
        if (!marcada) f.insertAdjacentHTML("beforeend", ' <span class="falto">(faltó marcarla)</span>');
      } else if (marcada) f.classList.add("mal");
    });
    bloquear();
    return { correcta: aciertos === filas.length, aciertos, total: filas.length };
  }

  if (p.tipo === "vf") {
    const filas = [...tarjeta.querySelectorAll(".fila-vf")];
    const elegidas = filas.map((f) => f.querySelector("input:checked")?.value);
    if (elegidas.some((x) => !x)) return null;
    let aciertos = 0;
    filas.forEach((f, j) => {
      const ok = (elegidas[j] === "V") === p.afirmaciones[j].respuesta;
      if (ok) aciertos++;
      marcar(f, ok);
      if (!ok) f.insertAdjacentHTML("beforeend", `<span class="falto">Era ${p.afirmaciones[j].respuesta ? "V" : "F"}</span>`);
    });
    bloquear();
    return { correcta: aciertos === filas.length, aciertos, total: filas.length };
  }

  if (p.tipo === "enlazar") {
    const filas = [...tarjeta.querySelectorAll(".fila-enlace")];
    const elegidas = filas.map((f) => f.querySelector("select").value);
    if (elegidas.some((x) => x === "")) return null;
    let aciertos = 0;
    filas.forEach((f, j) => {
      const ok = Number(elegidas[j]) === p.pares[j];
      if (ok) aciertos++;
      marcar(f, ok);
      if (!ok) f.insertAdjacentHTML("beforeend", `<span class="falto">Era ${LETRAS[p.pares[j]]}</span>`);
    });
    bloquear();
    return { correcta: aciertos === filas.length, aciertos, total: filas.length };
  }

  if (p.tipo === "completar") {
    const huecos = [...tarjeta.querySelectorAll(".hueco")];
    if (huecos.some((h) => !h.value.trim())) return null;
    let aciertos = 0;
    huecos.forEach((h, n) => {
      const validas = respuestasDeHueco(p.respuestas[n] ?? "");
      const ok = validas.some((r) => igual(h.value, r));
      if (ok) aciertos++;
      marcar(h, ok);
      if (!ok) h.insertAdjacentHTML("afterend", `<span class="falto"> (${esc(validas[0])})</span>`);
    });
    bloquear();
    return { correcta: aciertos === huecos.length, aciertos, total: huecos.length };
  }
  return null;
}

/** Comprueba que una pregunta de un paquete esté bien formada. Devuelve un error en texto o null. */
export function errorEnPregunta(p) {
  if (!p || !NOMBRE_TIPO[p.tipo]) return "tipo desconocido";
  if (!p.pregunta) return "falta el texto de la pregunta";
  const lista = (x, min = 2) => Array.isArray(x) && x.length >= min;
  switch (p.tipo) {
    case "multiple":
      return lista(p.opciones) && p.correcta in p.opciones ? null : "opciones o respuesta correcta no válidas";
    case "marcar":
      return lista(p.opciones) && lista(p.correctas, 1) && p.correctas.every((j) => j in p.opciones)
        ? null : "opciones o respuestas correctas no válidas";
    case "vf":
      if (esLista(p))
        return p.afirmaciones.length && p.afirmaciones.every((a) => a.texto && typeof a.respuesta === "boolean")
          ? null : "afirmaciones no válidas";
      return typeof p.respuesta === "boolean" ? null : "la respuesta debe ser verdadero o falso";
    case "enlazar":
      return lista(p.columnaA, 1) && lista(p.columnaB) && lista(p.pares, 1) &&
        p.pares.length === p.columnaA.length && p.pares.every((k) => k in p.columnaB)
        ? null : "columnas o pares no válidos";
    case "completar": {
      const huecos = (p.pregunta.match(HUECO) || []).length;
      return huecos && lista(p.respuestas, 1) && p.respuestas.length === huecos
        ? null : "el número de espacios ___ y de respuestas no coincide";
    }
    default:
      return p.respuesta ? null : "falta la respuesta";
  }
}

// ---------- Que no salga siempre igual ----------
function barajarIndices(n) {
  const a = Array.from({ length: n }, (_, k) => k);
  for (let k = n - 1; k > 0; k--) {
    const j = Math.floor(Math.random() * (k + 1));
    [a[k], a[j]] = [a[j], a[k]];
  }
  return a;
}

/**
 * Copia de la pregunta con las opciones en otro orden (selección, marcar, enlazar y V/F de varias afirmaciones).
 * La respuesta correcta y las explicaciones por opción se reordenan igual, así la corrección no cambia.
 */
export function mezclarPregunta(p) {
  if (!p) return p;
  if ((p.tipo === "multiple" || p.tipo === "marcar") && Array.isArray(p.opciones) && p.opciones.length > 1) {
    const orden = barajarIndices(p.opciones.length); // orden[nuevo] = viejo
    const nuevoDe = new Map(orden.map((viejo, nuevo) => [viejo, nuevo]));
    const q = { ...p, opciones: orden.map((v) => p.opciones[v]) };
    if (Array.isArray(p.porque)) q.porque = orden.map((v) => p.porque[v]);
    if (p.tipo === "multiple") q.correcta = nuevoDe.get(p.correcta);
    else q.correctas = (p.correctas || []).map((v) => nuevoDe.get(v)).sort((a, b) => a - b);
    return q;
  }
  if (p.tipo === "enlazar" && Array.isArray(p.columnaB) && p.columnaB.length > 1) {
    const orden = barajarIndices(p.columnaB.length);
    const nuevoDe = new Map(orden.map((viejo, nuevo) => [viejo, nuevo]));
    return { ...p, columnaB: orden.map((v) => p.columnaB[v]), pares: p.pares.map((v) => nuevoDe.get(v)) };
  }
  if (p.tipo === "vf" && Array.isArray(p.afirmaciones) && p.afirmaciones.length > 1) {
    return { ...p, afirmaciones: barajarIndices(p.afirmaciones.length).map((v) => p.afirmaciones[v]) };
  }
  return p;
}

/** Copia del documento con las opciones de todas sus preguntas mezcladas (el original no se toca). */
export function mezclarDocumento(doc) {
  return doc?.cuestionario?.length ? { ...doc, cuestionario: doc.cuestionario.map(mezclarPregunta) } : doc;
}
