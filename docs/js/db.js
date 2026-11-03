// Base de datos local de Finlay (IndexedDB): todo se guarda en el teléfono.

const NOMBRE_DB = "finlay";
const VERSION_DB = 2;
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

export async function crearAsignatura(anio, nombre) {
  const id = `${anio}|${nombre}`;
  const existente = await obtenerAsignatura(id);
  if (existente) return existente;
  const asig = { id, anio, nombre };
  await promesa((await almacen("asignaturas", "readwrite")).put(asig));
  return asig;
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
}

// ---------- Respuestas de cuestionarios (progreso) ----------
/** Guarda si la pregunta se respondió bien. Se conserva el historial de aciertos. */
export async function guardarRespuesta(docId, indice, correcta) {
  const alm = await almacen("respuestas", "readwrite");
  const id = `${docId}|${indice}`;
  const previa = (await promesa(alm.get(id))) || { id, docId, indice, aciertos: 0, fallos: 0 };
  previa.ultima = correcta;
  previa.fecha = Date.now();
  correcta ? previa.aciertos++ : previa.fallos++;
  await promesa(alm.put(previa));
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
