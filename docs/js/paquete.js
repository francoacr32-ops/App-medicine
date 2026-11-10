// Importa los "paquetes de estudio" que prepara Claude: conferencias completas,
// resúmenes y cuestionarios, organizados por año y asignatura.
// El formato está explicado en FORMATO-PAQUETE.md (en la raíz del repositorio).

import * as db from "./db.js";
import { paqueteFirmado, leerCodigoProfesor } from "./seguridad.js";
import { generarCuestionario } from "./generar.js";
import { fragmentarPagina, limpiar } from "./texto.js";
import { errorEnPregunta } from "./cuestionario.js";
import { cargarJSZip } from "./extraer.js";

/** Huella corta del contenido, para no guardar dos veces la misma imagen. */
function huella(texto) {
  let h1 = 0x811c9dc5, h2 = 0;
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = (Math.imul(h2, 31) + c) | 0;
  }
  return "i" + (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36) + texto.length.toString(36);
}

const IMAGEN_VALIDA = /^data:image\/(jpeg|png|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/;

/** Guarda las imágenes del paquete y cambia sus nombres por la huella en preguntas y resúmenes. */
async function importarImagenes(datos) {
  const nombres = new Map();
  const guardar = [];
  for (const [nombre, contenido] of Object.entries(datos.imagenes || {})) {
    if (typeof contenido !== "string" || !IMAGEN_VALIDA.test(contenido)) continue;
    const id = huella(contenido);
    nombres.set(nombre, id);
    guardar.push({ id, datos: contenido });
  }
  await db.guardarImagenes(guardar);
  const cambiar = (obj) => {
    if (obj?.imagen) obj.imagen = nombres.get(obj.imagen) || (String(obj.imagen).startsWith("i") ? obj.imagen : null);
  };
  for (const m of datos.materiales) {
    (m.cuestionario || []).forEach(cambiar);
    (m.resumen || []).forEach(cambiar);
  }
  return guardar.length;
}

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
  let zip = null;
  try {
    // Los paquetes .zip traen paquete.json y las diapositivas como imágenes
    const cabeza = new Uint8Array(await archivo.slice(0, 2).arrayBuffer());
    let texto;
    if (cabeza[0] === 0x50 && cabeza[1] === 0x4b) {
      const JSZip = await cargarJSZip();
      zip = await JSZip.loadAsync(await archivo.arrayBuffer());
      const j = zip.file("paquete.json");
      if (!j) throw new Error();
      texto = await j.async("string");
    } else {
      texto = await archivo.text();
    }
    datos = JSON.parse(texto);
  } catch {
    throw new Error("El archivo no es un paquete de Finlay válido (no se pudo leer).");
  }
  Object.defineProperty(datos, "__zip", { value: zip, enumerable: false });
  // ¿Lo firmó el administrador? Solo los paquetes firmados pueden cambiar el contenido oficial
  Object.defineProperty(datos, "__oficial", { value: await paqueteFirmado(datos), enumerable: false, writable: true });
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
export async function importarPaquete(datos, progreso = () => {}, opciones = {}) {
  const todos = await db.listarDocumentos();
  // Oficial = viene dentro de la app (confiable) o lo firmó el administrador
  const oficial = !!(opciones.confiable || datos.__oficial);
  const resultado = { nuevos: 0, actualizados: 0, resumenes: 0, preguntas: 0, progreso: false, oficial, omitidos: 0, docs: [] };
  // Mensaje que acompaña al paquete (entrega de un profesor, aviso del administrador…)
  const msj = datos.mensaje && typeof datos.mensaje === "object" ? datos.mensaje : null;
  let remitente = null;
  if (msj) {
    const prof = msj.de?.codigo ? await leerCodigoProfesor(msj.de.codigo) : null;
    remitente = { nombre: String(msj.de?.nombre || prof?.nombre || "Sin nombre").slice(0, 60),
      rol: datos.__oficial ? "admin" : prof ? "profesor" : "estudiante", verificado: !!(datos.__oficial || prof) };
    resultado.mensaje = { id: String(msj.id || Date.now()), texto: String(msj.texto || "").slice(0, 4000), fecha: Number(msj.fecha) || Date.now(),
      para: String(msj.para || "todos"), de: remitente };
  }
  const respuestasPrevias = new Map((await db.todasLasRespuestas()).map((r) => [r.id, r]));
  const respuestasNuevas = [];
  resultado.imagenes = await importarImagenes(datos);

  // Lista de asignaturas del plan de estudio (con su semestre), aunque todavía no tengan materiales
  const semestre = (s) => (s === 1 || s === 2 || s === 0 ? s : null);
  for (const a of datos.asignaturas || []) {
    await db.crearAsignatura(Number(a.anio), String(a.nombre).trim().replace(/\|/g, "-"), semestre(a.semestre));
    resultado.asignaturas = (resultado.asignaturas || 0) + 1;
  }

  // Asignaturas que el paquete pide quitar (con sus materiales y progreso)
  for (const q of oficial ? datos.quitarAsignaturas || [] : []) {
    const id = `${Number(q.anio)}|${String(q.nombre).trim()}`;
    if (await db.obtenerAsignatura(id)) {
      await db.borrarAsignatura(id);
      (resultado.quitadas ||= []).push(q.nombre);
    }
  }

  // Materiales que el paquete pide quitar (solo los que vinieron en un paquete y nunca los que cargaste tú)
  for (const q of oficial ? datos.quitarMateriales || [] : []) {
    const id = `${Number(q.anio)}|${String(q.asignatura).trim().replace(/\|/g, "-")}`;
    const clave = sinExtension(String(q.nombre));
    for (const d of todos.filter((x) => x.origen === "paquete" && sinExtension(x.nombre) === clave && x.asignaturas.includes(id))) {
      // Si tiene una clase de Finlay se queda; si tiene preguntas o diapositivas, solo se quita cuando el paquete lo pide expresamente
      if (d.leccion || (!q.forzar && (d.cuestionario?.length || d.diapositivas || d.pdf))) continue;
      await db.borrarDocumento(d.id);
      todos.splice(todos.indexOf(d), 1);
      resultado.materialesQuitados = (resultado.materialesQuitados || 0) + 1;
    }
  }

  // Resúmenes de asignatura (mapa conceptual, cuadros y lo esencial de cada tema)
  for (const r of oficial ? datos.resumenesAsignatura || [] : []) {
    const asig = await db.crearAsignatura(Number(r.anio), String(r.asignatura).trim());
    await db.guardarResumenAsignatura(asig.id, r);
    resultado.resumenesAsig = (resultado.resumenesAsig || 0) + 1;
  }

  for (const [i, m] of datos.materiales.entries()) {
    progreso(`Guardando ${i + 1} de ${datos.materiales.length}:\n${m.nombre}`);
    const asig = await db.crearAsignatura(Number(m.anio), String(m.asignatura).trim().replace(/\|/g, "-"), semestre(m.semestre));
    const clave = sinExtension(m.nombre);
    const candidatos = todos.filter((d) => sinExtension(d.nombre) === clave);
    let doc = candidatos.find((d) => d.asignaturas.includes(asig.id)) || candidatos.find((d) => d.tipo === "libro");

    // Un paquete sin firma no puede cambiar el contenido oficial: solo se restaura el progreso
    const docOficial = doc && doc.origen === "paquete" && doc.oficial !== false;
    if (doc && docOficial && !oficial) {
      resultado.omitidos++;
    } else if (doc) {
      if (!doc.asignaturas.includes(asig.id)) doc.asignaturas.push(asig.id);
      if (m.resumen) doc.resumen = m.resumen;
      if (m.leccion) doc.leccion = m.leccion;
      if (Number.isFinite(m.orden)) doc.orden = m.orden;
      if (m.cuestionario) {
        // Si cambian las preguntas, el progreso anterior ya no corresponde.
        // Pero si solo se añadieron preguntas nuevas al final, lo ya respondido se conserva.
        // Las preguntas que el estudiante quitó (oculta) siguen quitadas.
        const sinMarca = (lista) => JSON.stringify(lista.map(({ oculta, ...p }) => p));
        const viejas = doc.cuestionario || [];
        const soloAnadidas = viejas.length <= m.cuestionario.length &&
          sinMarca(viejas) === sinMarca(m.cuestionario.slice(0, viejas.length));
        if (!soloAnadidas) await db.borrarRespuestas(doc.id);
        doc.cuestionario = m.cuestionario.map((p, k) => (soloAnadidas && viejas[k]?.oculta ? { ...p, oculta: true } : p));
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
        tipo: ["libro", "taller"].includes(m.tipo) ? m.tipo : "conferencia",
        asignaturas: [asig.id],
        paginas: paginas.length,
        primera: paginas[0]?.n ?? 1,
        etiqueta,
        sinTexto: 0,
        fecha: Date.now(),
        resumen: m.resumen || null,
        cuestionario: m.cuestionario || null,
        leccion: m.leccion || null,
        ...(Number.isFinite(m.orden) ? { orden: m.orden } : {}),
        origen: "paquete",
        ...(oficial ? {} : { oficial: false }),
        ...(m.cuestionarioAuto ? { cuestionarioAuto: true } : {}),
        ...(remitente ? { de: remitente, nuevo: true }
          : opciones.marcarNuevo ? { nuevo: true, ...(datos.__oficial ? { de: { nombre: "Administrador", rol: "admin", verificado: true } } : {}) } : {}),
      };
      // Material recibido sin cuestionario: la app le hace uno automático (borrador)
      if (msj && !doc.cuestionario?.length && doc.tipo !== "libro" && paginas.length) {
        const auto = generarCuestionario(doc, paginas.map((p) => ({ pagina: p.n, texto: p.texto })));
        if (auto.length) { doc.cuestionario = auto; doc.cuestionarioAuto = true; }
      }
      await db.guardarDocumento(doc, fragmentos);
      todos.push(doc);
      resultado.nuevos++;
    }
    resultado.docs.push(doc.id);
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
    // Diapositivas originales (imágenes) y PDF que vienen dentro del .zip
    const zip = docOficial && !oficial ? null : datos.__zip; // sin firma no se tocan las diapositivas oficiales
    if (zip && m.diapositivas?.carpeta && m.diapositivas.total > 0) {
      const { carpeta, total } = m.diapositivas;
      let lote = [];
      let guardadas = 0;
      for (let n = 1; n <= total; n++) {
        const f = zip.file(`${carpeta}/${String(n).padStart(3, "0")}.webp`);
        if (!f) continue;
        lote.push({ n, blob: new Blob([await f.async("arraybuffer")], { type: "image/webp" }) });
        if (lote.length === 20 || n === total) {
          progreso(`Guardando diapositivas de ${m.nombre}\n${n} de ${total}`);
          await db.guardarDiapositivas(doc.id, lote);
          guardadas += lote.length;
          lote = [];
        }
      }
      if (lote.length) await db.guardarDiapositivas(doc.id, lote);
      doc.diapositivas = total;
      await db.actualizarDocumento(doc);
      resultado.diapositivas = (resultado.diapositivas || 0) + guardadas;
    }
    if (zip && m.pdf && zip.file(m.pdf)) {
      await db.guardarArchivo(doc.id, new Blob([await zip.file(m.pdf).async("arraybuffer")], { type: "application/pdf" }));
      doc.pdf = true;
      await db.actualizarDocumento(doc);
    }
    if (zip && m.archivoOriginal && ["docx", "pptx"].includes(m.original) && zip.file(m.archivoOriginal)) {
      await db.guardarArchivo(doc.id, new Blob([await zip.file(m.archivoOriginal).async("arraybuffer")]));
      doc.original = m.original;
      await db.actualizarDocumento(doc);
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
