// Buscador: encuentra los fragmentos de tus materiales que mejor responden a una pregunta.

import { normalizar, terminosDeBusqueda } from "./texto.js";
import { fragmentosDe } from "./db.js";

function escaparRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Crea una expresión que encuentra palabras que EMPIEZAN por el término. */
function patron(termino) {
  return new RegExp(`\\b${escaparRegex(termino)}[a-z0-9]*`, "g"); // \b y no una búsqueda hacia atrás: los iPhone viejos no la entienden
}

/**
 * Busca en los documentos indicados.
 * @param {string} consulta  lo que escribió el estudiante
 * @param {Array} documentos lista de documentos donde buscar
 * @returns {{terminos: string[], resultados: Array}}
 */
export async function buscar(consulta, documentos, maximo = 25, porDocumento = Infinity) {
  const terminos = terminosDeBusqueda(consulta);
  if (!terminos.length) return { terminos, resultados: [] };
  const patrones = terminos.map(patron);
  const fraseNorm = normalizar(consulta).replace(/\s+/g, " ").trim();

  const candidatos = [];
  const df = new Array(terminos.length).fill(0); // en cuántos fragmentos aparece cada término
  let total = 0;
  let sumaLongitud = 0;

  for (const doc of documentos) {
    const frags = await fragmentosDe(doc.id);
    for (const f of frags) {
      total++;
      sumaLongitud += f.texto.length;
      // Se guarda en memoria para que la siguiente búsqueda sea más rápida
      const norm = f._norm || (f._norm = normalizar(f.texto));
      const tf = patrones.map((re) => (norm.match(re) || []).length);
      if (tf.every((x) => x === 0)) continue;
      tf.forEach((x, i) => x && df[i]++);
      candidatos.push({ doc, frag: f, norm, tf });
    }
  }
  if (!candidatos.length) return { terminos, resultados: [] };

  // Puntuación tipo BM25 (la que usan los buscadores clásicos)
  const promedio = sumaLongitud / total;
  const k1 = 1.2;
  const b = 0.75;
  const idf = df.map((d) => Math.log(1 + (total - d + 0.5) / (d + 0.5)));

  for (const c of candidatos) {
    let puntos = 0;
    let presentes = 0;
    c.tf.forEach((tf, i) => {
      if (!tf) return;
      presentes++;
      const norma = k1 * (1 - b + (b * c.frag.texto.length) / promedio);
      puntos += idf[i] * ((tf * (k1 + 1)) / (tf + norma));
    });
    // Premiar fragmentos que contienen todas las palabras o la frase exacta
    puntos *= Math.pow(presentes / terminos.length, 1.5);
    if (fraseNorm.length > 4 && c.norm.replace(/\s+/g, " ").includes(fraseNorm)) puntos *= 1.6;
    c.puntos = puntos;
  }

  candidatos.sort((a, b) => b.puntos - a.puntos);
  // Cuántas veces sale en cada material, y como mucho `porDocumento` resultados (de páginas distintas)
  // por material: así un libro enorme no tapa a las conferencias.
  const enDoc = new Map();
  const elegidos = [];
  const paginasVistas = new Set();
  for (const c of candidatos) {
    enDoc.set(c.doc.id, (enDoc.get(c.doc.id) || 0) + 1);
    const ya = elegidos.filter((x) => x.doc.id === c.doc.id).length;
    const clavePag = c.doc.id + "|" + c.frag.pagina;
    if (ya >= porDocumento || paginasVistas.has(clavePag) || elegidos.length >= maximo) continue;
    paginasVistas.add(clavePag);
    elegidos.push(c);
  }
  const resultados = elegidos.map((c) => ({
    doc: c.doc,
    pagina: c.frag.pagina,
    etiqueta: c.frag.etiqueta,
    texto: c.frag.texto,
    puntos: c.puntos,
    extracto: extracto(c.frag.texto, c.norm, patrones),
    enDocumento: enDoc.get(c.doc.id),
  }));
  return { terminos, resultados, enDoc };
}

/** Busca dónde aparecen los términos (para resaltarlos). Devuelve [[inicio, fin], ...] */
export function coincidencias(norm, patrones) {
  const rangos = [];
  for (const re of patrones) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(norm))) rangos.push([m.index, m.index + m[0].length]);
  }
  return rangos.sort((a, b) => a[0] - b[0]);
}

export function patronesDe(consulta) {
  return terminosDeBusqueda(consulta).map(patron);
}

/** Elige la parte del fragmento con más coincidencias (unas 320 letras). */
function extracto(texto, norm, patrones, largo = 320) {
  const rangos = coincidencias(norm, patrones);
  if (texto.length <= largo || !rangos.length) {
    return { texto: texto.slice(0, largo), inicio: 0, cortadoIzq: false, cortadoDer: texto.length > largo };
  }
  // Ventana con más coincidencias
  let mejor = 0;
  let mejorCuenta = 0;
  for (let i = 0; i < rangos.length; i++) {
    let cuenta = 0;
    for (let j = i; j < rangos.length && rangos[j][0] < rangos[i][0] + largo; j++) cuenta++;
    if (cuenta > mejorCuenta) {
      mejorCuenta = cuenta;
      mejor = rangos[i][0];
    }
  }
  let inicio = Math.max(0, mejor - 80);
  const espacio = texto.lastIndexOf(" ", inicio);
  if (inicio > 0 && espacio > inicio - 30) inicio = espacio + 1;
  const fin = Math.min(texto.length, inicio + largo);
  return { texto: texto.slice(inicio, fin), inicio, cortadoIzq: inicio > 0, cortadoDer: fin < texto.length };
}
