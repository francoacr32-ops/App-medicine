// Base de datos local de Finlay (IndexedDB): todo se guarda en el teléfono.

const NOMBRE_DB = "finlay";
const VERSION_DB = 5;
let dbPromesa = null;

function abrir() {
  if (dbPromesa) return dbPromesa;
  dbPromesa = new Promise((resolver, rechazar) => {
    const pet = indexedDB.open(NOMBRE_DB, VERSION_DB);
    pet.onupgradeneeded = (ev) => {
      const db = pet.result;
      if (ev.oldVersion < 1) {
        // Asignaturas: id = "1|Morfofisiología"
        db.createObjectStore("asignaturas", { keyPath: "id" });
        // Documentos (conferencias y libros). Un libro puede estar en varias asignaturas.
        // Cada documento puede llevar también su resumen y su cuestionario.
        const docs = db.createObjectStore("documentos", { keyPath: "id" });
        docs.createIndex("asignaturas", "asignaturas", { multiEntry: true });
        // Fragmentos de texto para buscar (uno o varios por página)
        const frag = db.createObjectStore("fragmentos", { autoIncrement: true });
        frag.createIndex("docId", "docId");
      }
      if (ev.oldVersion < 2) {
        // Respuestas de los cuestionarios (para el progreso). id = "docId|númeroDePregunta"
        const resp = db.createObjectStore("respuestas", { keyPath: "id" });
        resp.createIndex("docId", "docId");
      }
      if (ev.oldVersion < 3) {
        // Actividad de cada día (para la racha y la meta diaria). id = "2026-11-03"
        db.createObjectStore("diario", { keyPath: "fecha" });
        // Fechas de examen (para el plan de estudio)
        db.createObjectStore("planes", { keyPath: "id", autoIncrement: true });
        // Notas de los exámenes de práctica
        db.createObjectStore("examenes", { keyPath: "id", autoIncrement: true });
      }
      if (ev.oldVersion < 4) {
        // Imágenes de las preguntas y los resúmenes. id = huella del contenido (no se repiten)
        db.createObjectStore("imagenes", { keyPath: "id" });
      }
      if (ev.oldVersion < 5) {
        // Diapositivas como imágenes (clave "docId|número") y PDF originales cargados desde el teléfono (clave docId)
        db.createObjectStore("diapositivas");
        db.createObjectStore("archivos");
      }
    };
    pet.onsuccess = () => resolver(pet.result);
    pet.onerror = () => rechazar(pet.error);
  });
  return dbPromesa;
}

function promesa(pet) {
  return new Promise((resolver, rechazar) => {
    pet.onsuccess = () => resolver(pet.result);
    pet.onerror = () => rechazar(pet.error);
  });
}

function finTransaccion(tx) {
  return new Promise((resolver, rechazar) => {
    tx.oncomplete = () => resolver();
    tx.onerror = () => rechazar(tx.error);
    tx.onabort = () => rechazar(tx.error || new Error("Transacción cancelada"));
  });
}

async function almacen(nombre, modo = "readonly") {
  const db = await abrir();
  return db.transaction(nombre, modo).objectStore(nombre);
}

// ---------- Asignaturas ----------
export async function listarAsignaturas(anio) {
  const todas = await promesa((await almacen("asignaturas")).getAll());
  const filtradas = anio ? todas.filter((a) => a.anio === anio) : todas;
  return filtradas.sort((a, b) => a.anio - b.anio || a.nombre.localeCompare(b.nombre, "es"));
}

export async function obtenerAsignatura(id) {
  return promesa((await almacen("asignaturas")).get(id));
}

/** semestre: 1 (primer semestre), 2 (segundo semestre), 0 (anual) o null (sin indicar). */
export async function crearAsignatura(anio, nombre, semestre = null) {
  const id = `${anio}|${nombre}`;
  const existente = await obtenerAsignatura(id);
  if (existente) {
    if (semestre !== null && semestre !== undefined && existente.semestre !== semestre) {
      existente.semestre = semestre;
      await promesa((await almacen("asignaturas", "readwrite")).put(existente));
    }
    return existente;
  }
  const asig = { id, anio, nombre, semestre: semestre ?? null };
  await promesa((await almacen("asignaturas", "readwrite")).put(asig));
  return asig;
}

export async function cambiarSemestre(id, semestre) {
  const asig = await obtenerAsignatura(id);
  asig.semestre = semestre;
  await promesa((await almacen("asignaturas", "readwrite")).put(asig));
}

export async function borrarAsignatura(id) {
  for (const doc of await documentosDeAsignatura(id)) await quitarDeAsignatura(doc.id, id);
  await promesa((await almacen("asignaturas", "readwrite")).delete(id));
}

// ---------- Documentos ----------
export async function listarDocumentos() {
  return promesa((await almacen("documentos")).getAll());
}

export async function obtenerDocumento(id) {
  return promesa((await almacen("documentos")).get(id));
}

export async function documentosDeAsignatura(asigId) {
  const indice = (await almacen("documentos")).index("asignaturas");
  return promesa(indice.getAll(asigId));
}

/** Guarda un documento nuevo con todos sus fragmentos en una sola operación. */
export async function guardarDocumento(doc, fragmentos) {
  const db = await abrir();
  const tx = db.transaction(["documentos", "fragmentos"], "readwrite");
  tx.objectStore("documentos").put(doc);
  const almFrag = tx.objectStore("fragmentos");
  for (const f of fragmentos) almFrag.add({ ...f, docId: doc.id });
  await finTransaccion(tx);
  cacheFragmentos.delete(doc.id);
}

export async function actualizarDocumento(doc) {
  await promesa((await almacen("documentos", "readwrite")).put(doc));
}

/** Añade un documento ya cargado a otra asignatura (sin duplicar el archivo). */
export async function vincularAAsignatura(docId, asigId) {
  const doc = await obtenerDocumento(docId);
  if (!doc.asignaturas.includes(asigId)) {
    doc.asignaturas.push(asigId);
    await actualizarDocumento(doc);
  }
}

/** Quita el documento de una asignatura; si ya no está en ninguna, lo borra. */
export async function quitarDeAsignatura(docId, asigId) {
  const doc = await obtenerDocumento(docId);
  if (!doc) return;
  doc.asignaturas = doc.asignaturas.filter((a) => a !== asigId);
  if (doc.asignaturas.length) await actualizarDocumento(doc);
  else await borrarDocumento(docId);
}

export async function borrarDocumento(docId) {
  const db = await abrir();
  const tx = db.transaction(["documentos", "fragmentos"], "readwrite");
  tx.objectStore("documentos").delete(docId);
  const indice = tx.objectStore("fragmentos").index("docId");
  const cursorPet = indice.openKeyCursor(IDBKeyRange.only(docId));
  cursorPet.onsuccess = () => {
    const cursor = cursorPet.result;
    if (cursor) {
      tx.objectStore("fragmentos").delete(cursor.primaryKey);
      cursor.continue();
    }
  };
  await finTransaccion(tx);
  cacheFragmentos.delete(docId);
  await borrarRespuestas(docId);
  await borrarVisual(docId);
}

// ---------- Respuestas de cuestionarios (progreso) ----------
// Repaso espaciado (sistema de cajas de Leitner): cada acierto sube la pregunta de caja
// y la aleja en el tiempo; cada fallo la devuelve a la caja 1 (se repasa mañana).
const DIAS_POR_CAJA = [0, 1, 2, 4, 8, 16];

export function hoy(fecha = new Date()) {
  const d = new Date(fecha.getTime() - fecha.getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 10);
}

function sumarDias(dias) {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return hoy(d);
}

/** Guarda si la pregunta se respondió bien, programa su próximo repaso y suma a la actividad del día. */
export async function guardarRespuesta(docId, indice, correcta) {
  const db = await abrir();
  const tx = db.transaction(["respuestas", "diario"], "readwrite");
  const alm = tx.objectStore("respuestas");
  const id = `${docId}|${indice}`;
  alm.get(id).onsuccess = (ev) => {
    const r = ev.target.result || { id, docId, indice, aciertos: 0, fallos: 0, caja: 0 };
    r.ultima = correcta;
    r.fecha = Date.now();
    correcta ? r.aciertos++ : r.fallos++;
    r.caja = correcta ? Math.min((r.caja || 0) + 1, 5) : 1;
    r.proxima = sumarDias(DIAS_POR_CAJA[r.caja]);
    alm.put(r);
  };
  const diario = tx.objectStore("diario");
  const fecha = hoy();
  diario.get(fecha).onsuccess = (ev) => {
    const d = ev.target.result || { fecha, preguntas: 0, correctas: 0 };
    d.preguntas++;
    if (correcta) d.correctas++;
    diario.put(d);
  };
  await finTransaccion(tx);
}

export async function todasLasRespuestas() {
  return promesa((await almacen("respuestas")).getAll());
}

export async function restaurarRespuestas(lista) {
  const db = await abrir();
  const tx = db.transaction("respuestas", "readwrite");
  lista.forEach((r) => tx.objectStore("respuestas").put(r));
  await finTransaccion(tx);
}

// ---------- Actividad diaria, planes y exámenes ----------
export async function listarDiario() {
  return promesa((await almacen("diario")).getAll());
}

export async function restaurarDiario(lista) {
  const db = await abrir();
  const tx = db.transaction("diario", "readwrite");
  const alm = tx.objectStore("diario");
  for (const d of lista) {
    alm.get(d.fecha).onsuccess = (ev) => {
      const actual = ev.target.result;
      if (!actual || actual.preguntas < d.preguntas) alm.put(d);
    };
  }
  await finTransaccion(tx);
}

export async function listarPlanes() {
  return promesa((await almacen("planes")).getAll());
}

export async function guardarPlan(plan) {
  return promesa((await almacen("planes", "readwrite")).put(plan));
}

export async function borrarPlan(id) {
  return promesa((await almacen("planes", "readwrite")).delete(id));
}

export async function guardarExamen(examen) {
  return promesa((await almacen("examenes", "readwrite")).add(examen));
}

export async function listarExamenes() {
  return promesa((await almacen("examenes")).getAll());
}

export async function respuestasDe(docId) {
  const indice = (await almacen("respuestas")).index("docId");
  return promesa(indice.getAll(docId));
}

export async function borrarRespuestas(docId) {
  const db = await abrir();
  const tx = db.transaction("respuestas", "readwrite");
  const pet = tx.objectStore("respuestas").index("docId").openKeyCursor(IDBKeyRange.only(docId));
  pet.onsuccess = () => {
    const c = pet.result;
    if (c) {
      tx.objectStore("respuestas").delete(c.primaryKey);
      c.continue();
    }
  };
  await finTransaccion(tx);
}

// ---------- Diapositivas y PDF originales ----------
export async function guardarDiapositivas(docId, lista) {
  const db = await abrir();
  const tx = db.transaction("diapositivas", "readwrite");
  for (const { n, blob } of lista) tx.objectStore("diapositivas").put(blob, `${docId}|${n}`);
  await finTransaccion(tx);
}

export async function obtenerDiapositiva(docId, n) {
  return promesa((await almacen("diapositivas")).get(`${docId}|${n}`));
}

export async function guardarArchivo(docId, blob) {
  return promesa((await almacen("archivos", "readwrite")).put(blob, docId));
}

export async function obtenerArchivo(docId) {
  return promesa((await almacen("archivos")).get(docId));
}

async function borrarVisual(docId) {
  const db = await abrir();
  const tx = db.transaction(["diapositivas", "archivos"], "readwrite");
  tx.objectStore("diapositivas").delete(IDBKeyRange.bound(`${docId}|`, `${docId}|\uffff`));
  tx.objectStore("archivos").delete(docId);
  await finTransaccion(tx);
}

// ---------- Imágenes ----------
const cacheImagenes = new Map();

export async function guardarImagenes(lista) {
  if (!lista.length) return;
  const db = await abrir();
  const tx = db.transaction("imagenes", "readwrite");
  lista.forEach((img) => tx.objectStore("imagenes").put(img));
  await finTransaccion(tx);
}

/** Devuelve la imagen como "data:image/...;base64,…" (o null si no existe). */
export async function obtenerImagen(id) {
  if (cacheImagenes.has(id)) return cacheImagenes.get(id);
  const img = await promesa((await almacen("imagenes")).get(id));
  const datos = img?.datos || null;
  if (datos) cacheImagenes.set(id, datos);
  return datos;
}

// ---------- Fragmentos ----------
const cacheFragmentos = new Map();

export async function fragmentosDe(docId) {
  if (cacheFragmentos.has(docId)) return cacheFragmentos.get(docId);
  const indice = (await almacen("fragmentos")).index("docId");
  const lista = await promesa(indice.getAll(docId));
  lista.sort((a, b) => a.pagina - b.pagina || a.orden - b.orden);
  cacheFragmentos.set(docId, lista);
  return lista;
}

/** Devuelve el texto completo de una página de un documento. */
export async function textoDePagina(docId, pagina) {
  const frags = (await fragmentosDe(docId)).filter((f) => f.pagina === pagina);
  return frags.map((f) => f.texto).join("\n\n");
}
