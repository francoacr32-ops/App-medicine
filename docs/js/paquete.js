// Importa los "paquetes de estudio" que prepara Claude: conferencias completas,
// resúmenes y cuestionarios, organizados por año y asignatura.
// El formato está explicado en FORMATO-PAQUETE.md (en la raíz del repositorio).

import * as db from "./db.js";
import { fragmentarPagina, limpiar } from "./texto.js";

const TIPOS_PREGUNTA = new Set(["multiple", "vf", "abierta"]);

function sinExtension(nombre) {
  return nombre.replace(/\.(pdf|docx|pptx|txt)$/i, "").trim().toLowerCase();
}

function validarPregunta(p, i, nombre) {
  const donde = `${nombre}, pregunta ${i + 1}`;
  if (!p || !TIPOS_PREGUNTA.has(p.tipo)) throw new Error(`${donde}: tipo desconocido.`);
  if (!p.pregunta) throw new Error(`${donde}: falta el texto de la pregunta.`);
  if (p.tipo === "multiple" && (!Array.isArray(p.opciones) || p.opciones.length < 2 || !(p.correcta in p.opciones)))
    throw new Error(`${donde}: opciones o respuesta correcta no válidas.`);
  if (p.tipo === "vf" && typeof p.respuesta !== "boolean") throw new Error(`${donde}: la respuesta debe ser verdadero o falso.`);
  if (p.tipo === "abierta" && !p.respuesta) throw new Error(`${donde}: falta la respuesta.`);
}

/** Lee y comprueba el archivo. Devuelve el paquete o lanza un error en español. */
export async function leerPaquete(archivo) {
  let datos;
  try {
    datos = JSON.parse(await archivo.text());
  } catch {
    throw new Error("El archivo no es un paquete de Finlay válido (no se pudo leer).");
  }
  if (datos?.formato !== "finlay-paquete" || !Array.isArray(datos.materiales))
    throw new Error("Este archivo no es un paquete de Finlay.");
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
  const resultado = { nuevos: 0, actualizados: 0, resumenes: 0, preguntas: 0 };

  for (const [i, m] of datos.materiales.entries()) {
    progreso(`Guardando ${i + 1} de ${datos.materiales.length}:\n${m.nombre}`);
    const asig = await db.crearAsignatura(Number(m.anio), String(m.asignatura).trim().replace(/\|/g, "-"));
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
    if (m.resumen) resultado.resumenes++;
    resultado.preguntas += (m.cuestionario || []).length;
  }
  return resultado;
}
