// Cuestionario automático, sin internet: lee las definiciones del texto de una conferencia
// ("La mitosis es…", "Osteología: estudio de…") y arma con ellas preguntas de completar,
// selección, enlazar y verdadero o falso. Es un BORRADOR: quien estudia puede quitar las malas.
import { tarjetasDeDefiniciones } from "./tarjetas.js";

const limpiar = (s) => String(s || "").replace(/\s+/g, " ").trim();
const corto = (s, n = 150) => (s.length > n ? s.slice(0, n).replace(/\s+\S*$/, "") + "…" : s);

/** Generador de azar con semilla (el mismo material da siempre el mismo cuestionario) */
function azarCon(semilla) {
  let h = 2166136261;
  for (const c of String(semilla)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function barajar(lista, azar) {
  const a = [...lista];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(azar() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Definiciones del texto: [{ termino, explicacion, frase, fuente }] */
export function definicionesDe(doc, paginas, maximo = 60) {
  return tarjetasDeDefiniciones(doc, paginas, maximo).map((t) => {
    const conVerbo = t.frente.startsWith("¿Qué ");
    const termino = limpiar(conVerbo ? t.frente.replace(/^¿Qué (es|son) /, "").replace(/\?$/, "") : t.frente);
    // explicación sin repetir el término: "X es Y" → "Y"
    let explicacion = limpiar(t.dorso);
    if (conVerbo) {
      const m = t.cita.match(/\s(es|son|se define como|se definen como|se denomina|se denominan|consiste en|constituye|constituyen)\s+(.+)$/i);
      if (m) explicacion = limpiar(m[2]);
    }
    return { termino, explicacion: explicacion.replace(/\.$/, ""), frase: limpiar(t.cita), fuente: t.fuente };
  }).filter((d) => d.termino.length >= 3 && d.termino.length <= 60 && d.explicacion.length >= 15);
}

/**
 * Cuestionario automático de un material.
 * paginas: [{ pagina, texto }]. Devuelve [] si el texto no tiene suficientes definiciones.
 */
export function generarCuestionario(doc, paginas, maximo = 15) {
  const defs = definicionesDe(doc, paginas);
  if (defs.length < 3) return [];
  const azar = azarCon(doc.nombre || doc.id || "finlay");
  const preguntas = [];
  const base = (d) => ({ fuente: d.fuente, cita: d.frase, auto: true });
  const orden = barajar(defs, azar);
  let k = 0;
  const siguiente = () => orden[k++ % orden.length];

  while (preguntas.length < maximo && k < orden.length) {
    const tipo = preguntas.length % 4;
    const d = siguiente();
    const otras = barajar(defs.filter((x) => x !== d), azar);
    if (tipo === 0 && defs.length >= 4) {
      // Selección: de qué término es esta definición
      const opciones = barajar([d, ...otras.slice(0, 3)], azar);
      preguntas.push({ tipo: "multiple", pregunta: `«${corto(d.explicacion)}» corresponde a:`,
        opciones: opciones.map((x) => x.termino), correcta: opciones.indexOf(d), ...base(d) });
    } else if (tipo === 1) {
      // Completar: la frase con el término en blanco
      const frase = d.frase.replace(d.termino, "___");
      if (frase !== d.frase && frase.length < 260)
        preguntas.push({ tipo: "completar", pregunta: frase, respuestas: [[d.termino]], ...base(d) });
      else preguntas.push({ tipo: "completar", pregunta: `${corto(d.explicacion, 200)}: ___`, respuestas: [[d.termino]], ...base(d) });
    } else if (tipo === 2 && defs.length >= 4) {
      // Enlazar tres términos con su definición (y una definición de más)
      const grupo = [d, ...otras.slice(0, 2)];
      const columnaB = barajar([...grupo, otras[2]].filter(Boolean), azar);
      preguntas.push({ tipo: "enlazar", pregunta: "Enlace cada término (columna A) con su definición (columna B):",
        columnaA: grupo.map((x) => x.termino), columnaB: columnaB.map((x) => corto(x.explicacion, 110)),
        pares: grupo.map((x) => columnaB.indexOf(x)), ...base(d) });
      k += 2;
    } else {
      // Verdadero o falso: una definición correcta y otra con el término cambiado
      const falsa = otras[0];
      const afirmaciones = barajar([
        { texto: `${d.termino}: ${corto(d.explicacion, 140)}.`, respuesta: true },
        { texto: `${falsa.termino}: ${corto((otras[1] || d).explicacion, 140)}.`, respuesta: false },
      ], azar);
      preguntas.push({ tipo: "vf", pregunta: "Diga si son verdaderas (V) o falsas (F):", afirmaciones, ...base(d),
        explicacion: `${falsa.termino}: ${corto(falsa.explicacion, 160)}.` });
    }
  }
  return preguntas;
}

/** Resumen automático de una asignatura a partir de sus materiales (para «Generar asignatura») */
export function resumenDeAsignatura(nombre, materiales) {
  // materiales: [{ nombre, definiciones: [{ termino, explicacion }] }]
  return {
    intro: `Resumen de **${nombre}**, generado a partir de sus ${materiales.length} materiales.`,
    mapa: { t: "mapa", titulo: "Mapa general", raiz: nombre,
      ramas: materiales.slice(0, 8).map((m) => ({ t: corto(m.nombre.replace(/^(Conferencia|Clase)\s*\d*\s*[-–:]?\s*/i, ""), 60),
        hijos: m.definiciones.slice(0, 4).map((d) => ({ t: corto(d.termino, 40), hijos: [] })) })) },
    temas: materiales.filter((m) => m.definiciones.length).map((m) => ({ titulo: m.nombre, bloques: [
      { t: "lista", items: m.definiciones.slice(0, 6).map((d) => `**${d.termino}**: ${corto(d.explicacion, 170)}.`) }] })),
    estrategia: ["**Lee cada material** en orden y haz su cuestionario.", "**Repasa** las preguntas que falles hasta dominarlas."],
  };
}
