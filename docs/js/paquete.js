// Importa los "paquetes de estudio" que prepara Claude: conferencias completas,
// resúmenes y cuestionarios, organizados por año y asignatura.
// El formato está explicado en FORMATO-PAQUETE.md (en la raíz del repositorio).

import * as db from "./db.js";
import { fragmentarPagina, limpiar } from "./texto.js";
import { errorEnPregunta } from "./cuestionario.js";

function sinExtension(nombre) {
  return nombre.replace(/\.(pdf|docx|pptx|txt)$/i, "").trim().toLowerCase();
}

function validarPregunta(p, i, nombre) {
  const error = errorEnPregunta(p);
  if (error) throw new Error(`${nombre}, pregunta ${i + 1}: ${error}.`);
}

/** Lee y comprueba el archivo. Devuelve el paquete o lanza un error en español. */
export async function leerPaquete(archivo) {
  let datos;
  try {
    datos = JSON.parse(await archivo.text());
  } catch {
    throw new Error("El archivo no es un paquete de Finlay válido (no se pudo leer).");
  }
  if (datos?.formato !== "finlay-paquete") throw new Error("Este archivo no es un paquete de Finlay.");
  datos.materiales ||= [];
  if (!Array.isArray(datos.materiales)) throw new Error("Este archivo no es un paquete de Finlay.");
  for (const a of datos.asignaturas || []) {
    if (!(a.anio >= 1 && a.anio <= 6) || !a.nombre) throw new Error("Hay una asignatura sin año o sin nombre.");
  }
  for (const m of datos.materiales) {
    if (!(m.anio >= 1 && m.anio <= 6) || !m.asignatura || !m.nombre)
      throw new Error("Hay un material sin año, asignatura o nombre.");
    (m.cuestionario || []).forEach((p, i) => validarPregunta(p, i, m.nombre));
  }
  return datos;
}

/** Guarda el paquete en el teléfono. Si la conferencia ya existe, le añade el resumen y el cuestionario. */
export async function importarPaquete(datos, progreso = () => {}) {
  const todos = await db.listarDocumentos();
  const resultado = { nuevos: 0, actualizados: 0, resumenes: 0, preguntas: 0, progreso: false };
  const respuestasPrevias = new Map((await db.todasLasRespuestas()).map((r) => [r.id, r]));
  const respuestasNuevas = [];

  // Lista de asignaturas del plan de estudio (con su semestre), aunque todavía no tengan materiales
  const semestre = (s) => (s === 1 || s === 2 || s === 0 ? s : null);
  for (const a of datos.asignaturas || []) {
    await db.crearAsignatura(Number(a.anio), String(a.nombre).trim().replace(/\|/g, "-"), semestre(a.semestre));
    resultado.asignaturas = (resultado.asignaturas || 0) + 1;
  }

  for (const [i, m] of datos.materiales.entries()) {
    progreso(`Guardando ${i + 1} de ${datos.materiales.length}:\n${m.nombre}`);
    const asig = await db.crearAsignatura(Number(m.anio), String(m.asignatura).trim().replace(/\|/g, "-"), semestre(m.semestre));
    const clave = sinExtension(m.nombre);
    const candidatos = todos.filter((d) => sinExtension(d.nombre) === clave);
    let doc = candidatos.find((d) => d.asignaturas.includes(asig.id)) || candidatos.find((d) => d.tipo === "libro");

    if (doc) {
      if (!doc.asignaturas.includes(asig.id)) doc.asignaturas.push(asig.id);
      if (m.resumen) doc.resumen = m.resumen;
      if (m.cuestionario) {
        // Si cambian las preguntas, el progreso anterior ya no corresponde
        if (JSON.stringify(doc.cuestionario) !== JSON.stringify(m.cuestionario)) await db.borrarRespuestas(doc.id);
        doc.cuestionario = m.cuestionario;
      }
      await db.actualizarDocumento(doc);
      resultado.actualizados++;
    } else {
      const paginas = (m.paginas || [])
        .map((p) => ({ n: Number(p.n), texto: limpiar(String(p.texto || "")) }))
        .filter((p) => p.texto);
      const etiqueta = m.etiqueta || "pág.";
      const fragmentos = [];
      for (const p of paginas) {
        fragmentarPagina(p.texto).forEach((texto, orden) => fragmentos.push({ pagina: p.n, etiqueta, orden, texto }));
      }
      doc = {
        id: "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        nombre: m.nombre,
        tamano: 0,
        tipo: m.tipo === "libro" ? "libro" : "conferencia",
        asignaturas: [asig.id],
        paginas: paginas.length,
        primera: paginas[0]?.n ?? 1,
        etiqueta,
        sinTexto: 0,
        fecha: Date.now(),
        resumen: m.resumen || null,
        cuestionario: m.cuestionario || null,
        origen: "paquete",
      };
      await db.guardarDocumento(doc, fragmentos);
      todos.push(doc);
      resultado.nuevos++;
    }
    // Libro que también se usa en otras asignaturas
    for (const otra of m.tambienEn || []) {
      if (!(otra.anio >= 1 && otra.anio <= 6) || !otra.asignatura) continue;
      const a = await db.crearAsignatura(Number(otra.anio), String(otra.asignatura).trim().replace(/\|/g, "-"));
      await db.vincularAAsignatura(doc.id, a.id);
    }
    // Progreso guardado en una copia de seguridad: se queda el más reciente
    for (const r of m.progreso || []) {
      const id = `${doc.id}|${r.indice}`;
      const previa = respuestasPrevias.get(id);
      if (!previa || (previa.fecha || 0) < (r.fecha || 0)) respuestasNuevas.push({ ...r, id, docId: doc.id });
    }
    if (m.resumen) resultado.resumenes++;
    resultado.preguntas += (m.cuestionario || []).length;
  }
  if (respuestasNuevas.length) {
    await db.restaurarRespuestas(respuestasNuevas);
    resultado.progreso = true;
  }
  if (Array.isArray(datos.diario)) {
    await db.restaurarDiario(datos.diario.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.fecha)));
    resultado.progreso = true;
  }
  return resultado;
}
