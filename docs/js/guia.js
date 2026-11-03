// Guía de corrección: cuando fallas una pregunta, busca en el libro o la conferencia
// la parte exacta donde está la respuesta, para resaltarla con el "corrector".

import { normalizar, terminosDeBusqueda } from "./texto.js";
import { fragmentosDe, textoDePagina } from "./db.js";

const escRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Lo que debería estar escrito en el material para responder bien. */
function claves(p) {
  switch (p.tipo) {
    case "multiple":
      return p.opciones[p.correcta];
    case "marcar":
      return p.correctas.map((j) => p.opciones[j]).join(" ");
    case "vf":
      return p.afirmaciones ? p.afirmaciones.map((a) => a.texto).join(" ") : p.pregunta;
    case "enlazar":
      return p.columnaA.map((a, j) => `${a} ${p.columnaB[p.pares[j]]}`).join(" ");
    case "completar":
      return p.pregunta + " " + p.respuestas.map((r) => (Array.isArray(r) ? r.join(" ") : r)).join(" ");
    default:
      return p.respuesta || "";
  }
}

/** Páginas que menciona la fuente: "pág. 12" → [12]; "pág. 3-5" → [3, 4, 5]; "diap. 2 y 7" → [2, 7] */
export function paginasDeFuente(fuente) {
  if (!fuente) return [];
  const paginas = new Set();
  for (const m of fuente.matchAll(/(\d+)\s*[-–]\s*(\d+)|(\d+)/g)) {
    if (m[3]) paginas.add(Number(m[3]));
    else for (let n = Number(m[1]); n <= Math.min(Number(m[2]), Number(m[1]) + 10); n++) paginas.add(n);
  }
  return [...paginas];
}

/** Busca la cita literal (si Claude la puso en el paquete). Devuelve [inicio, fin] o null. */
function buscarCita(texto, cita) {
  const palabras = normalizar(cita).split(/\s+/).filter(Boolean);
  if (palabras.length < 2) return null;
  const re = new RegExp(palabras.map(escRegex).join("\\s+"));
  const m = normalizar(texto).match(re);
  return m ? [m.index, m.index + m[0].length] : null;
}

/** Divide el texto en oraciones, conservando dónde empieza cada una. */
function oraciones(texto) {
  const lista = [];
  for (const m of texto.matchAll(/[^.!?;\n]+[.!?;]?/g)) {
    const espacios = m[0].length - m[0].trimStart().length;
    if (m[0].trim().length > 3) lista.push({ inicio: m.index + espacios, fin: m.index + m[0].trimEnd().length, texto: m[0] });
  }
  return lista;
}

/** Puntúa cada oración según cuántas palabras importantes de la respuesta contiene. */
function mejorPasaje(texto, pesos) {
  const ors = oraciones(texto);
  let mejor = { puntos: 0 };
  const puntos = ors.map((o) => {
    const norm = normalizar(o.texto);
    let s = 0;
    for (const [termino, peso] of pesos) {
      if (new RegExp(`(?<![a-z0-9])${escRegex(termino)}`).test(norm)) s += peso;
    }
    return s;
  });
  puntos.forEach((s, i) => s > mejor.puntos && (mejor = { puntos: s, i }));
  if (!mejor.puntos) return null;
  // Si la oración vecina también habla de lo mismo, se resalta junto con ella
  let ini = mejor.i;
  let fin = mejor.i;
  if (puntos[mejor.i + 1] >= mejor.puntos * 0.6) fin++;
  else if (puntos[mejor.i - 1] >= mejor.puntos * 0.6) ini--;
  return { puntos: mejor.puntos, rango: [ors[ini].inicio, ors[fin].fin] };
}

/**
 * Localiza en el documento la parte que responde la pregunta.
 * @returns {{pagina: number, texto: string, rango: [number, number] | null}}
 */
export async function localizar(doc, p) {
  const frags = await fragmentosDe(doc.id);
  const existentes = [...new Set(frags.map((f) => f.pagina))];
  if (!existentes.length) return null;
  const sugeridas = paginasDeFuente(p.fuente).filter((n) => existentes.includes(n));

  // 1) Cita literal
  if (p.cita) {
    for (const n of [...sugeridas, ...existentes.filter((x) => !sugeridas.includes(x))]) {
      const texto = await textoDePagina(doc.id, n);
      const rango = buscarCita(texto, p.cita);
      if (rango) return { pagina: n, texto, rango };
    }
  }

  // 2) Palabras de la respuesta correcta (valen más), de la explicación y de la pregunta
  const pesos = new Map();
  const sumar = (txt, peso) => terminosDeBusqueda(txt || "").forEach((t) => pesos.set(t, Math.max(pesos.get(t) || 0, peso)));
  sumar(p.pregunta.replace(/_{3,}/g, " "), 1);
  sumar(p.explicacion, 2);
  sumar(claves(p), 3);

  let mejor = null;
  const revisar = async (paginas) => {
    for (const n of paginas) {
      const texto = await textoDePagina(doc.id, n);
      const r = mejorPasaje(texto, pesos);
      if (r && (!mejor || r.puntos > mejor.puntos)) mejor = { ...r, pagina: n, texto };
    }
  };
  await revisar(sugeridas);
  // Si en la página indicada no aparece claro, se busca en todo el documento
  if (!mejor || mejor.puntos < 3) await revisar(existentes.filter((x) => !sugeridas.includes(x)));
  if (mejor) return { pagina: mejor.pagina, texto: mejor.texto, rango: mejor.rango };

  const n = sugeridas[0] ?? existentes[0];
  return { pagina: n, texto: await textoDePagina(doc.id, n), rango: null };
}
