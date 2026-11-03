// Finlay — pantallas y navegación.

import * as db from "./db.js";
import { extraerTexto, tipoDeArchivo, FORMATOS } from "./extraer.js";
import { fragmentarPagina, normalizar } from "./texto.js";
import { buscar, coincidencias, patronesDe } from "./buscar.js";
import * as voz from "./voz.js";
import { leerPaquete, importarPaquete } from "./paquete.js";

const ANIOS = ["1er año", "2do año", "3er año", "4to año", "5to año", "6to año"];
const $app = document.getElementById("app");
const $titulo = document.getElementById("titulo");
const $atras = document.getElementById("atras");

// ---------- Utilidades ----------
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const enlaceAsig = (id) => `#/asig/${encodeURIComponent(id)}`;

function nombreAsig(id) {
  const [anio, ...resto] = id.split("|");
  return `${ANIOS[Number(anio) - 1]} › ${resto.join("|")}`;
}

function aviso(texto, ms = 3500) {
  const t = document.getElementById("aviso");
  t.textContent = texto;
  t.hidden = false;
  clearTimeout(aviso.temporizador);
  aviso.temporizador = setTimeout(() => (t.hidden = true), ms);
}

function mostrarProgreso(texto) {
  const p = document.getElementById("progreso");
  p.hidden = !texto;
  if (texto) p.querySelector("p").textContent = texto;
}

function velocidadVoz() {
  try {
    return Number(localStorage.getItem("finlay.velocidad")) || 1;
  } catch {
    return 1;
  }
}

/** Resalta en el texto las palabras buscadas. */
function resaltar(texto, patrones) {
  if (!patrones?.length) return esc(texto);
  const rangos = coincidencias(normalizar(texto), patrones);
  let html = "";
  let pos = 0;
  for (const [ini, fin] of rangos) {
    if (ini < pos) continue;
    html += esc(texto.slice(pos, ini)) + "<mark>" + esc(texto.slice(ini, fin)) + "</mark>";
    pos = fin;
  }
  return html + esc(texto.slice(pos));
}

function cita(doc, etiqueta, pagina) {
  const icono = doc.tipo === "libro" ? "📕" : "📝";
  return `${icono} <b>${esc(doc.nombre)}</b> — ${esc(etiqueta)} ${pagina}`;
}

function poner(titulo, html, atras = null) {
  $titulo.textContent = titulo;
  $atras.hidden = !atras;
  $atras.dataset.destino = atras || "";
  $app.innerHTML = html;
  window.scrollTo(0, 0);
}

// ---------- Pantalla: inicio ----------
async function vistaInicio() {
  const asigs = await db.listarAsignaturas();
  const docs = await db.listarDocumentos();
  let espacio = "";
  if (navigator.storage?.estimate) {
    const { usage } = await navigator.storage.estimate();
    espacio = `Espacio usado en el teléfono: ${(usage / 1048576).toFixed(1)} MB`;
  }
  const tarjetas = ANIOS.map((nombre, i) => {
    const n = asigs.filter((a) => a.anio === i + 1).length;
    return `<a class="tarjeta anio" href="#/anio/${i + 1}">
      <span class="grande">${esc(nombre)}</span>
      <span class="sub">${n ? `${n} asignatura${n > 1 ? "s" : ""}` : "Vacío"}</span></a>`;
  }).join("");

  poner(
    "Finlay",
    `<form class="buscador" data-ambito="todo">
       <input name="q" type="search" placeholder="Buscar en toda la carrera…" autocomplete="off" required>
       <button class="btn">Buscar</button>
     </form>
     <h2>Elige un año</h2>
     <div class="rejilla">${tarjetas}</div>
     <p class="nota">${docs.length} materiales cargados. ${esc(espacio)}</p>
     <button class="btn ancho" data-accion="paquete">📥 Cargar paquete de Claude (conferencias, resúmenes y cuestionarios)</button>
     <p class="nota"><a href="#/biblioteca">Ver todos los materiales</a> · <a href="#/ayuda">Cómo usar Finlay</a></p>
     <button id="instalar" class="btn secundario" hidden>📲 Instalar Finlay en el teléfono</button>`
  );
  mostrarBotonInstalar();
}

// ---------- Pantalla: un año ----------
async function vistaAnio(anio) {
  const asigs = await db.listarAsignaturas(anio);
  const filas = await Promise.all(
    asigs.map(async (a) => {
      const docs = await db.documentosDeAsignatura(a.id);
      const c = docs.filter((d) => d.tipo === "conferencia").length;
      const l = docs.length - c;
      return `<a class="tarjeta fila" href="${enlaceAsig(a.id)}">
        <span class="grande">${esc(a.nombre)}</span>
        <span class="sub">${c} conferencias · ${l} libros</span></a>`;
    })
  );
  poner(
    ANIOS[anio - 1],
    `${filas.join("") || `<p class="vacio">Todavía no hay asignaturas en ${ANIOS[anio - 1]}.</p>`}
     <form class="nueva-asig" data-anio="${anio}">
       <input name="nombre" placeholder="Nombre de la asignatura (ej. Morfofisiología)" required maxlength="80">
       <button class="btn">＋ Añadir</button>
     </form>
     ${asigs.length ? `<form class="buscador" data-ambito="anio:${anio}">
       <input name="q" type="search" placeholder="Buscar en todo ${esc(ANIOS[anio - 1])}…" required>
       <button class="btn">Buscar</button></form>` : ""}`,
    "#/"
  );
}

// ---------- Pantalla: una asignatura ----------
async function vistaAsignatura(id, pestana = "conferencias") {
  const asig = await db.obtenerAsignatura(id);
  if (!asig) return (location.hash = "#/");
  const docs = (await db.documentosDeAsignatura(id)).sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { numeric: true }));
  if (pestana === "progreso") return vistaProgreso(asig, docs);
  const tipo = pestana === "libros" ? "libro" : "conferencia";
  const lista = docs.filter((d) => d.tipo === tipo);

  const items = lista
    .map(
      (d) => `<li class="doc">
        <a href="#/doc/${d.id}" class="doc-nombre">${tipo === "libro" ? "📕" : "📝"} ${esc(d.nombre)}</a>
        <span class="sub">${d.paginas ? `${d.paginas} ${d.etiqueta === "diap." ? "diapositivas" : d.etiqueta === "parte" ? "partes" : "páginas"}` : "sin texto completo"}${d.asignaturas.length > 1 ? " · compartido en " + d.asignaturas.length + " asignaturas" : ""}${d.sinTexto ? ` · ⚠️ ${d.sinTexto} sin texto` : ""}</span>
        ${d.resumen || d.cuestionario ? `<span class="etiquetas">${d.resumen ? '<span class="chip">📋 Resumen</span>' : ""}${d.cuestionario ? `<span class="chip">❓ ${d.cuestionario.length} preguntas</span>` : ""}</span>` : ""}
        <span class="acciones">
          <button class="btn mini" data-accion="exportar" data-id="${d.id}">📤 Exportar texto</button>
          <button class="btn mini peligro" data-accion="quitar" data-id="${d.id}">Quitar</button>
        </span></li>`
    )
    .join("");

  const otrosLibros =
    tipo === "libro"
      ? (await db.listarDocumentos()).filter((d) => d.tipo === "libro" && !d.asignaturas.includes(id))
      : [];

  poner(
    asig.nombre,
    `<p class="migas">${esc(ANIOS[asig.anio - 1])}</p>
     <form class="buscador" data-ambito="${esc(id)}">
       <input name="q" type="search" placeholder="Buscar en ${esc(asig.nombre)}…" required>
       <button class="btn">Buscar</button>
     </form>
     <nav class="pestanas">
       <a href="${enlaceAsig(id)}/conferencias" class="${tipo === "conferencia" ? "activa" : ""}">Conferencias</a>
       <a href="${enlaceAsig(id)}/libros" class="${tipo === "libro" ? "activa" : ""}">Libros</a>
       <a href="${enlaceAsig(id)}/progreso">Progreso</a>
     </nav>
     <ul class="docs">${items || `<li class="vacio">No hay ${tipo === "libro" ? "libros" : "conferencias"} todavía.</li>`}</ul>
     <button class="btn ancho" data-accion="cargar" data-asig="${esc(id)}" data-tipo="${tipo}">
       ＋ Cargar ${tipo === "libro" ? "libros" : "conferencias"} (PDF, Word, PowerPoint)</button>
     ${otrosLibros.length ? `<details class="compartir"><summary>📚 Usar un libro que ya cargaste en otra asignatura</summary>
        <ul>${otrosLibros.map((d) => `<li><button class="btn mini" data-accion="vincular" data-id="${d.id}" data-asig="${esc(id)}">＋</button> ${esc(d.nombre)}</li>`).join("")}</ul>
        <p class="nota">Así el libro no se guarda dos veces.</p></details>` : ""}
     <button class="btn mini peligro abajo" data-accion="borrar-asig" data-asig="${esc(id)}">Borrar asignatura</button>`,
    `#/anio/${asig.anio}`
  );
}

// ---------- Pantalla: resultados de búsqueda ----------
async function documentosDelAmbito(ambito) {
  if (ambito === "todo") return db.listarDocumentos();
  if (ambito.startsWith("anio:")) {
    const anio = Number(ambito.slice(5));
    return (await db.listarDocumentos()).filter((d) => d.asignaturas.some((a) => a.startsWith(anio + "|")));
  }
  return db.documentosDeAsignatura(ambito);
}

function nombreAmbito(ambito) {
  if (ambito === "todo") return "toda la carrera";
  if (ambito.startsWith("anio:")) return ANIOS[Number(ambito.slice(5)) - 1];
  return nombreAsig(ambito);
}

async function vistaBuscar(ambito, q) {
  const atras = ambito === "todo" ? "#/" : ambito.startsWith("anio:") ? `#/anio/${ambito.slice(5)}` : enlaceAsig(ambito);
  poner("Buscando…", `<p class="vacio">Buscando en ${esc(nombreAmbito(ambito))}…</p>`, atras);
  const docs = await documentosDelAmbito(ambito);
  const { terminos, resultados } = await buscar(q, docs);
  const patrones = patronesDe(q);

  const cabecera = `<form class="buscador" data-ambito="${esc(ambito)}">
      <input name="q" type="search" value="${esc(q)}" required>
      <button class="btn">Buscar</button></form>
    <p class="migas">En ${esc(nombreAmbito(ambito))} · ${docs.length} materiales</p>`;

  let cuerpo;
  if (!docs.length) {
    cuerpo = `<p class="vacio">Aquí todavía no hay materiales cargados.</p>`;
  } else if (!terminos.length) {
    cuerpo = `<p class="vacio">Escribe palabras más concretas (por ejemplo: "potencial de acción").</p>`;
  } else if (!resultados.length) {
    cuerpo = `<div class="no-encontrado"><b>No encontré eso en los materiales.</b>
      <p>Prueba con otras palabras o un sinónimo, o busca en ${ambito === "todo" ? "otro tema" : `<a href="#/buscar/todo?q=${encodeURIComponent(q)}">toda la carrera</a>`}.</p></div>`;
  } else {
    cuerpo = resultados
      .map((r, i) => {
        const e = r.extracto;
        const texto = (e.cortadoIzq ? "…" : "") + resaltar(e.texto, patrones) + (e.cortadoDer ? "…" : "");
        return `<article class="resultado">
          <p class="cita">${cita(r.doc, r.etiqueta, r.pagina)}</p>
          <p class="sub">${esc(r.doc.asignaturas.map(nombreAsig).join(" · "))}</p>
          <p class="extracto">${texto}</p>
          <div class="acciones">
            <a class="btn mini" href="#/leer/${r.doc.id}/${r.pagina}?q=${encodeURIComponent(q)}">📖 Ver página</a>
            <button class="btn mini" data-accion="leer-resultado" data-i="${i}">🔊 Escuchar</button>
          </div></article>`;
      })
      .join("");
  }
  poner(`Resultados`, cabecera + cuerpo, atras);
  vistaBuscar.ultimos = resultados;
}

// ---------- Pantalla: leer una página ----------
async function vistaLeer(docId, pagina, q) {
  const doc = await db.obtenerDocumento(docId);
  if (!doc) return (location.hash = "#/");
  const frags = await db.fragmentosDe(docId);
  const paginas = [...new Set(frags.map((f) => f.pagina))];
  if (!paginas.includes(pagina)) pagina = paginas.find((p) => p >= pagina) ?? paginas[0];
  const idx = paginas.indexOf(pagina);
  const texto = await db.textoDePagina(docId, pagina);
  const patrones = q ? patronesDe(q) : null;
  const sufijo = q ? `?q=${encodeURIComponent(q)}` : "";
  const nav = `<div class="paginador">
      ${idx > 0 ? `<a class="btn mini" href="#/leer/${docId}/${paginas[idx - 1]}${sufijo}">◀ Anterior</a>` : "<span></span>"}
      <span>${esc(doc.etiqueta)} ${pagina} (${idx + 1}/${paginas.length})</span>
      ${idx < paginas.length - 1 ? `<a class="btn mini" href="#/leer/${docId}/${paginas[idx + 1]}${sufijo}">Siguiente ▶</a>` : "<span></span>"}
    </div>`;
  poner(
    doc.nombre,
    `<p class="cita">${cita(doc, doc.etiqueta, pagina)}</p>
     <p class="sub">${esc(doc.asignaturas.map(nombreAsig).join(" · "))}</p>
     ${nav}
     <button class="btn ancho" data-accion="leer-pagina">🔊 Escuchar esta página</button>
     <div class="pagina">${resaltar(texto, patrones).replace(/\n/g, "<br>")}</div>
     ${nav}`,
    `#/doc/${docId}/texto`
  );
  if (q) $atras.dataset.destino = "historial";
  vistaLeer.texto = texto;
  const primera = $app.querySelector("mark");
  if (primera) primera.scrollIntoView({ block: "center" });
}

// ---------- Pantalla: un documento (resumen, cuestionario y texto completo) ----------
const NOMBRE_TIPO = { multiple: "Selección múltiple", vf: "Verdadero o falso", abierta: "Pregunta y respuesta" };

async function vistaDoc(docId, pestana) {
  const doc = await db.obtenerDocumento(docId);
  if (!doc) return (location.hash = "#/");
  if (!pestana) pestana = doc.resumen ? "resumen" : doc.cuestionario ? "cuestionario" : "texto";
  const asigActual = doc.asignaturas[0];
  const base = `#/doc/${docId}`;
  const pestanas = `<nav class="pestanas">
      <a href="${base}/resumen" class="${pestana === "resumen" ? "activa" : ""}">Resumen</a>
      <a href="${base}/cuestionario" class="${pestana === "cuestionario" ? "activa" : ""}">Cuestionario</a>
      <a href="${base}/texto" class="${pestana === "texto" ? "activa" : ""}">Completa</a>
    </nav>`;
  const pedirAClaude = (que) => `<div class="no-encontrado"><b>Todavía no hay ${que}.</b>
      <p>${doc.paginas ? `Pulsa <b>📤 Exportar texto</b> y mándale el archivo a Claude. Él te devolverá un paquete con el ${que}.` : ""}</p>
      ${doc.paginas ? `<button class="btn mini" data-accion="exportar" data-id="${doc.id}">📤 Exportar texto</button>` : ""}</div>`;

  let cuerpo = "";
  if (pestana === "resumen") {
    if (!doc.resumen?.length) cuerpo = pedirAClaude("resumen");
    else {
      cuerpo =
        `<button class="btn ancho" data-accion="leer-resumen">🔊 Escuchar el resumen</button>` +
        doc.resumen
          .map(
            (s) => `<section class="seccion-resumen">
              ${s.titulo ? `<h3>${esc(s.titulo)}</h3>` : ""}
              <div>${esc(s.texto).replace(/\n/g, "<br>")}</div>
              ${s.fuente ? `<p class="fuente">📌 Fuente: ${esc(doc.nombre)}, ${esc(s.fuente)}</p>` : ""}
            </section>`
          )
          .join("");
    }
  } else if (pestana === "cuestionario") {
    cuerpo = doc.cuestionario?.length ? await htmlCuestionario(doc) : pedirAClaude("cuestionario");
  } else {
    cuerpo = doc.paginas
      ? `<p>${doc.paginas} ${doc.etiqueta === "diap." ? "diapositivas" : "páginas"} con texto.</p>
         <a class="btn ancho" href="#/leer/${doc.id}/${doc.primera ?? 1}">📖 Leer completa</a>
         <form class="buscador" data-ambito="${esc(asigActual)}">
           <input name="q" type="search" placeholder="Buscar en ${esc(asigActual.split("|")[1])}…" required>
           <button class="btn">Buscar</button></form>
         <button class="btn mini" data-accion="exportar" data-id="${doc.id}">📤 Exportar texto para Claude</button>`
      : `<p class="vacio">Este material solo tiene resumen y cuestionario (no tiene el texto completo).</p>`;
  }

  poner(
    doc.nombre,
    `<p class="migas">${esc(doc.asignaturas.map(nombreAsig).join(" · "))}</p>${pestanas}${cuerpo}`,
    enlaceAsig(asigActual) + (doc.tipo === "libro" ? "/libros" : "")
  );
  vistaDoc.doc = doc;
}

async function htmlCuestionario(doc) {
  const resp = new Map((await db.respuestasDe(doc.id)).map((r) => [r.indice, r]));
  const filtro = vistaDoc.filtro || "todas";
  const preguntas = doc.cuestionario
    .map((p, i) => ({ p, i }))
    .filter(({ p, i }) => filtro === "todas" || (filtro === "falladas" ? resp.get(i)?.ultima === false : p.tipo === filtro));
  const chips = [["todas", "Todas"], ["multiple", "Selección"], ["vf", "V o F"], ["abierta", "Preguntas"], ["falladas", "❗ Las que fallé"]]
    .map(([k, t]) => `<button class="chip ${filtro === k ? "activa" : ""}" data-accion="filtro" data-filtro="${k}">${t}</button>`)
    .join("");
  const tarjetas = preguntas
    .map(({ p, i }) => {
      let opciones = "";
      if (p.tipo === "multiple")
        opciones = p.opciones
          .map((o, j) => `<button class="opcion" data-accion="responder" data-i="${i}" data-r="${j}">${"ABCDEFG"[j]}) ${esc(o)}</button>`)
          .join("");
      else if (p.tipo === "vf")
        opciones = `<button class="opcion" data-accion="responder" data-i="${i}" data-r="true">Verdadero</button>
                    <button class="opcion" data-accion="responder" data-i="${i}" data-r="false">Falso</button>`;
      else opciones = `<button class="btn mini" data-accion="ver-respuesta" data-i="${i}">👁 Ver respuesta</button>`;
      const previa = resp.get(i);
      return `<article class="pregunta" id="p${i}">
        <p class="sub">${i + 1}. ${NOMBRE_TIPO[p.tipo]}${previa ? ` · la última vez: ${previa.ultima ? "✅" : "❌"}` : ""}</p>
        <p class="enunciado">${esc(p.pregunta)}</p>
        <div class="opciones">${opciones}</div>
        <div class="explicacion" hidden></div>
      </article>`;
    })
    .join("");
  const total = doc.cuestionario.length;
  const bien = [...resp.values()].filter((r) => r.ultima).length;
  return `<p class="marcador" id="marcador">Respondidas ${resp.size} de ${total} · Correctas ${bien}</p>
    <div class="chips">${chips}</div>
    ${tarjetas || `<p class="vacio">No hay preguntas en este grupo. ${filtro === "falladas" ? "¡Bien hecho! 🎉" : ""}</p>`}
    <button class="btn mini peligro abajo" data-accion="reiniciar">Empezar de cero este cuestionario</button>`;
}

async function responder(i, valor) {
  const doc = vistaDoc.doc;
  const p = doc.cuestionario[i];
  const tarjeta = document.getElementById("p" + i);
  let correcta;
  if (p.tipo === "multiple") correcta = Number(valor) === p.correcta;
  else if (p.tipo === "vf") correcta = (valor === "true") === p.respuesta;
  else correcta = valor === "si";

  tarjeta.querySelectorAll(".opcion").forEach((b) => {
    b.disabled = true;
    const r = b.dataset.r;
    const esLaBuena = p.tipo === "multiple" ? Number(r) === p.correcta : (r === "true") === p.respuesta;
    if (esLaBuena) b.classList.add("bien");
    else if (r === String(valor)) b.classList.add("mal");
  });
  tarjeta.querySelectorAll("[data-accion=autoevaluar]").forEach((b) => (b.disabled = true));

  const caja = tarjeta.querySelector(".explicacion");
  const encabezado = p.tipo === "abierta" ? "" : `<b>${correcta ? "✅ ¡Correcto!" : "❌ Incorrecto."}</b> `;
  const respuestaTexto =
    p.tipo === "multiple" ? `La respuesta correcta es ${"ABCDEFG"[p.correcta]}) ${p.opciones[p.correcta]}.` :
    p.tipo === "vf" ? `Es ${p.respuesta ? "verdadero" : "falso"}.` : "";
  if (p.tipo !== "abierta") {
    caja.innerHTML = `${encabezado}${esc(respuestaTexto)}
      ${p.explicacion ? `<p>${esc(p.explicacion)}</p>` : ""}
      ${p.fuente ? `<p class="fuente">📌 Fuente: ${esc(doc.nombre)}, ${esc(p.fuente)}</p>` : ""}
      <button class="btn mini" data-accion="leer-explicacion" data-i="${i}">🔊 Escuchar</button>`;
    caja.hidden = false;
  }
  await db.guardarRespuesta(doc.id, i, correcta);
  const resp = await db.respuestasDe(doc.id);
  document.getElementById("marcador").textContent =
    `Respondidas ${resp.length} de ${doc.cuestionario.length} · Correctas ${resp.filter((r) => r.ultima).length}`;
}

function verRespuesta(i) {
  const doc = vistaDoc.doc;
  const p = doc.cuestionario[i];
  const tarjeta = document.getElementById("p" + i);
  tarjeta.querySelector("[data-accion=ver-respuesta]").remove();
  const caja = tarjeta.querySelector(".explicacion");
  caja.innerHTML = `<p><b>Respuesta:</b> ${esc(p.respuesta).replace(/\n/g, "<br>")}</p>
    ${p.explicacion ? `<p>${esc(p.explicacion)}</p>` : ""}
    ${p.fuente ? `<p class="fuente">📌 Fuente: ${esc(doc.nombre)}, ${esc(p.fuente)}</p>` : ""}
    <p class="sub">¿La sabías?</p>
    <div class="acciones">
      <button class="btn mini" data-accion="autoevaluar" data-i="${i}" data-r="si">✅ La sabía</button>
      <button class="btn mini peligro" data-accion="autoevaluar" data-i="${i}" data-r="no">❌ No la sabía</button>
      <button class="btn mini" data-accion="leer-explicacion" data-i="${i}">🔊 Escuchar</button>
    </div>`;
  caja.hidden = false;
}

// ---------- Pestaña: progreso de una asignatura ----------
async function estadoDe(doc) {
  const total = doc.cuestionario.length;
  const resp = await db.respuestasDe(doc.id);
  const bien = resp.filter((r) => r.ultima).length;
  const pct = Math.round((bien / total) * 100);
  let estado = "sin-empezar";
  if (resp.length) estado = pct >= 80 && resp.length === total ? "dominado" : pct >= 60 ? "en-camino" : "repasar";
  return { total, respondidas: resp.length, bien, pct, estado };
}

const ESTADOS = {
  dominado: "✅ Dominado",
  "en-camino": "🟡 En camino",
  repasar: "🔴 Repasar",
  "sin-empezar": "⚪ Sin empezar",
};

async function vistaProgreso(asig, docs) {
  const conPreguntas = docs.filter((d) => d.cuestionario?.length);
  const filas = await Promise.all(conPreguntas.map(async (d) => ({ d, e: await estadoDe(d) })));
  const orden = { repasar: 0, "en-camino": 1, "sin-empezar": 2, dominado: 3 };
  filas.sort((a, b) => orden[a.e.estado] - orden[b.e.estado] || a.e.pct - b.e.pct);
  const dominados = filas.filter((f) => f.e.estado === "dominado").length;
  const id = asig.id;

  poner(
    asig.nombre,
    `<p class="migas">${esc(ANIOS[asig.anio - 1])}</p>
     <nav class="pestanas">
       <a href="${enlaceAsig(id)}/conferencias">Conferencias</a>
       <a href="${enlaceAsig(id)}/libros">Libros</a>
       <a href="${enlaceAsig(id)}/progreso" class="activa">Progreso</a>
     </nav>
     ${filas.length
       ? `<p class="resumen-progreso">Dominas <b>${dominados}</b> de <b>${filas.length}</b> temas.</p>
          <ul class="docs">${filas
            .map(
              ({ d, e }) => `<li class="doc">
              <a class="doc-nombre" href="#/doc/${d.id}/cuestionario">${esc(d.nombre)}</a>
              <span class="sub">${ESTADOS[e.estado]} · ${e.bien} de ${e.total} correctas</span>
              <span class="barra-progreso"><span class="${e.estado}" style="width:${e.pct}%"></span></span>
            </li>`
            )
            .join("")}</ul>
          <p class="nota">🔴 Repasar: menos del 60 % · 🟡 En camino: 60–79 % · ✅ Dominado: 80 % o más, con todas respondidas.</p>`
       : `<p class="vacio">Todavía no hay cuestionarios en esta asignatura. Cuando cargues un paquete de Claude, aquí verás qué temas dominas y cuáles debes repasar.</p>`}`,
    `#/anio/${asig.anio}`
  );
}

// ---------- Pantalla: todos los materiales ----------
async function vistaBiblioteca() {
  const docs = (await db.listarDocumentos()).sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { numeric: true }));
  poner(
    "Todos los materiales",
    docs.length
      ? `<ul class="docs">${docs
          .map(
            (d) => `<li class="doc"><a class="doc-nombre" href="#/doc/${d.id}">${d.tipo === "libro" ? "📕" : "📝"} ${esc(d.nombre)}</a>
            <span class="sub">${esc(d.asignaturas.map(nombreAsig).join(" · "))}</span></li>`
          )
          .join("")}</ul>`
      : `<p class="vacio">Todavía no has cargado materiales.</p>`,
    "#/"
  );
}

function vistaAyuda() {
  poner(
    "Cómo usar Finlay",
    `<ol class="ayuda">
      <li><b>Elige un año</b> y añade tus asignaturas.</li>
      <li>Entra en una asignatura y pulsa <b>＋ Cargar conferencias</b> o <b>＋ Cargar libros</b>. Elige los archivos que bajaste del aula virtual (PDF, Word .docx o PowerPoint .pptx).</li>
      <li>Finlay lee el texto <b>dentro de tu teléfono</b>: no sube nada a internet.</li>
      <li>Un libro que se usa en varias asignaturas (como Guyton) se carga una sola vez. En las demás asignaturas usa <b>📚 Usar un libro que ya cargaste</b>.</li>
      <li><b>Busca</b> en una asignatura, en un año o en toda la carrera. Cada resultado dice de qué libro o conferencia sale y en qué página.</li>
      <li>Pulsa <b>🔊</b> para escuchar. Si la voz no suena en español, instala la voz española en Ajustes del teléfono → Idioma → Texto a voz.</li>
      <li><b>📤 Exportar texto</b> crea un archivo pequeño con el texto de una conferencia para enviárselo a Claude y que te haga el resumen y el cuestionario.</li>
    </ol>
    <p class="nota">Velocidad de la voz:
      <select id="velocidad">${[0.8, 0.9, 1, 1.15, 1.3, 1.5].map((v) => `<option value="${v}" ${v === velocidadVoz() ? "selected" : ""}>${v}×</option>`).join("")}</select></p>
    <p class="nota">⚠️ Si borras los datos del navegador, se borran los materiales cargados en Finlay (tus archivos originales no se tocan).</p>`,
    "#/"
  );
}

// ---------- Cargar archivos ----------
const $archivo = document.getElementById("archivo");
$archivo.accept = FORMATOS;
let destinoCarga = null;

async function cargarArchivos(archivos, asigId, tipo) {
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  const existentes = await db.listarDocumentos();
  let cargados = 0;
  const errores = [];

  for (const archivo of archivos) {
    try {
      if (!tipoDeArchivo(archivo.name)) throw new Error("Formato no compatible.");
      const igual = existentes.find((d) => d.nombre === archivo.name && d.tamano === archivo.size);
      if (igual) {
        if (igual.asignaturas.includes(asigId)) {
          errores.push(`${archivo.name}: ya estaba en esta asignatura.`);
        } else if (confirm(`«${archivo.name}» ya está cargado en ${igual.asignaturas.map(nombreAsig).join(", ")}.\n¿Añadirlo también aquí sin guardarlo dos veces?`)) {
          await db.vincularAAsignatura(igual.id, asigId);
          cargados++;
        }
        continue;
      }

      mostrarProgreso(`Abriendo ${archivo.name}…`);
      const paginas = await extraerTexto(archivo, (t) => mostrarProgreso(`${archivo.name}\n${t}`));
      const conTexto = paginas.filter((p) => p.texto.replace(/\s/g, "").length > 20);
      if (!conTexto.length) {
        throw new Error("No tiene texto que se pueda leer. Probablemente es un PDF escaneado (fotos de páginas). Lo añadiremos en una etapa futura.");
      }

      mostrarProgreso(`${archivo.name}\nGuardando…`);
      const fragmentos = [];
      for (const p of conTexto) {
        fragmentarPagina(p.texto).forEach((texto, orden) =>
          fragmentos.push({ pagina: p.n, etiqueta: p.etiqueta, orden, texto })
        );
      }
      const doc = {
        id: "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        nombre: archivo.name,
        tamano: archivo.size,
        tipo,
        asignaturas: [asigId],
        paginas: paginas.length,
        primera: conTexto[0].n,
        etiqueta: paginas[0].etiqueta,
        sinTexto: paginas.length - conTexto.length,
        fecha: Date.now(),
      };
      await db.guardarDocumento(doc, fragmentos);
      existentes.push(doc);
      cargados++;
      if (doc.sinTexto > paginas.length * 0.3) {
        errores.push(`${archivo.name}: ${doc.sinTexto} de ${paginas.length} páginas no tienen texto (pueden ser imágenes escaneadas).`);
      }
    } catch (e) {
      console.error(e);
      const msj = e?.name === "QuotaExceededError" ? "No queda espacio en el teléfono para guardarlo." : e.message;
      errores.push(`${archivo.name}: ${msj}`);
    }
  }
  mostrarProgreso(null);
  if (errores.length) alert(`Cargados: ${cargados}\n\nAvisos:\n• ${errores.join("\n• ")}`);
  else aviso(`✅ ${cargados} archivo${cargados === 1 ? "" : "s"} cargado${cargados === 1 ? "" : "s"}`);
  router();
}

async function exportarTexto(docId) {
  const doc = await db.obtenerDocumento(docId);
  const frags = await db.fragmentosDe(docId);
  let texto =
    `FINLAY — TEXTO EXTRAÍDO\n` +
    `Documento: ${doc.nombre}\nTipo: ${doc.tipo}\n` +
    `Asignatura(s): ${doc.asignaturas.map(nombreAsig).join("; ")}\n` +
    `Páginas: ${doc.paginas}\n`;
  let ultima = null;
  for (const f of frags) {
    if (f.pagina !== ultima) {
      texto += `\n=== ${f.etiqueta} ${f.pagina} ===\n`;
      ultima = f.pagina;
    }
    texto += f.texto + "\n";
  }
  const nombre = doc.nombre.replace(/\.[^.]+$/, "") + ".txt";
  const archivo = new File([texto], nombre, { type: "text/plain" });
  // En Android se puede compartir directo a la app de Claude, WhatsApp, etc.
  if (navigator.canShare?.({ files: [archivo] })) {
    try {
      await navigator.share({ files: [archivo], title: nombre });
      return;
    } catch (e) {
      if (e.name === "AbortError") return;
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(archivo);
  a.download = nombre;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  aviso(`Guardado en Descargas: ${nombre} (${Math.ceil(texto.length / 1024)} KB)`);
}

// ---------- Eventos ----------
document.addEventListener("submit", async (ev) => {
  const f = ev.target;
  ev.preventDefault();
  if (f.classList.contains("buscador")) {
    const q = f.q.value.trim();
    if (q) location.hash = `#/buscar/${encodeURIComponent(f.dataset.ambito)}?q=${encodeURIComponent(q)}`;
  } else if (f.classList.contains("nueva-asig")) {
    const nombre = f.nombre.value.trim().replace(/\|/g, "-");
    if (!nombre) return;
    const asig = await db.crearAsignatura(Number(f.dataset.anio), nombre);
    location.hash = enlaceAsig(asig.id);
  }
});

document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-accion]");
  if (!b) return;
  const { accion, id, asig } = b.dataset;
  if (accion === "cargar") {
    destinoCarga = { asig, tipo: b.dataset.tipo };
    $archivo.value = "";
    $archivo.click();
  } else if (accion === "exportar") {
    exportarTexto(id);
  } else if (accion === "quitar") {
    const doc = await db.obtenerDocumento(id);
    const asigActual = decodeURIComponent(location.hash.split("/")[2]);
    const msj =
      doc.asignaturas.length > 1
        ? `¿Quitar «${doc.nombre}» de esta asignatura? Seguirá en las otras.`
        : `¿Borrar «${doc.nombre}» de Finlay? (El archivo original del teléfono no se borra.)`;
    if (confirm(msj)) {
      await db.quitarDeAsignatura(id, asigActual);
      router();
    }
  } else if (accion === "vincular") {
    await db.vincularAAsignatura(id, asig);
    aviso("📚 Libro añadido a esta asignatura");
    router();
  } else if (accion === "borrar-asig") {
    if (confirm("¿Borrar esta asignatura? Sus materiales se quitarán (los libros compartidos seguirán en las otras asignaturas).")) {
      const a = await db.obtenerAsignatura(asig);
      await db.borrarAsignatura(asig);
      location.hash = `#/anio/${a.anio}`;
    }
  } else if (accion === "leer-resultado") {
    const r = vistaBuscar.ultimos[Number(b.dataset.i)];
    voz.leer(`${r.doc.nombre}, ${r.etiqueta === "diap." ? "diapositiva" : r.etiqueta === "parte" ? "parte" : "página"} ${r.pagina}. ${r.texto}`, velocidadVoz());
  } else if (accion === "leer-pagina") {
    voz.leer(vistaLeer.texto, velocidadVoz());
  } else if (accion === "paquete") {
    $paquete.value = "";
    $paquete.click();
  } else if (accion === "filtro") {
    vistaDoc.filtro = b.dataset.filtro;
    router();
  } else if (accion === "responder" || accion === "autoevaluar") {
    responder(Number(b.dataset.i), b.dataset.r);
  } else if (accion === "ver-respuesta") {
    verRespuesta(Number(b.dataset.i));
  } else if (accion === "leer-resumen") {
    const d = vistaDoc.doc;
    voz.leer(`Resumen de ${d.nombre}. ` + d.resumen.map((s) => `${s.titulo || ""}. ${s.texto}`).join(" "), velocidadVoz());
  } else if (accion === "leer-explicacion") {
    const p = vistaDoc.doc.cuestionario[Number(b.dataset.i)];
    const r =
      p.tipo === "multiple" ? `La respuesta correcta es: ${p.opciones[p.correcta]}.` :
      p.tipo === "vf" ? `Es ${p.respuesta ? "verdadero" : "falso"}.` : `Respuesta: ${p.respuesta}.`;
    voz.leer(`${p.pregunta} ${r} ${p.explicacion || ""}`, velocidadVoz());
  } else if (accion === "reiniciar") {
    if (confirm("¿Borrar tus respuestas de este cuestionario y empezar de cero?")) {
      await db.borrarRespuestas(vistaDoc.doc.id);
      router();
    }
  }
});

// Cargar paquetes de Claude
const $paquete = document.getElementById("paquete");
$paquete.addEventListener("change", async () => {
  const archivo = $paquete.files[0];
  if (!archivo) return;
  try {
    mostrarProgreso("Leyendo el paquete…");
    const datos = await leerPaquete(archivo);
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
    const r = await importarPaquete(datos, mostrarProgreso);
    mostrarProgreso(null);
    alert(
      `✅ Paquete cargado${datos.titulo ? `: ${datos.titulo}` : ""}\n\n` +
      `• Materiales nuevos: ${r.nuevos}\n• Materiales actualizados: ${r.actualizados}\n` +
      `• Resúmenes: ${r.resumenes}\n• Preguntas: ${r.preguntas}`
    );
    const anios = [...new Set(datos.materiales.map((m) => m.anio))];
    location.hash = anios.length === 1 ? `#/anio/${anios[0]}` : "#/";
    router();
  } catch (e) {
    mostrarProgreso(null);
    console.error(e);
    alert("No se pudo cargar el paquete:\n" + (e?.name === "QuotaExceededError" ? "No queda espacio en el teléfono." : e.message));
  }
});

document.addEventListener("change", (ev) => {
  if (ev.target.id === "velocidad") {
    try {
      localStorage.setItem("finlay.velocidad", ev.target.value);
    } catch {}
    aviso("Velocidad guardada");
  }
});

$archivo.addEventListener("change", () => {
  if ($archivo.files.length && destinoCarga) cargarArchivos([...$archivo.files], destinoCarga.asig, destinoCarga.tipo);
});

$atras.addEventListener("click", () => {
  const d = $atras.dataset.destino;
  if (d === "historial") history.back();
  else if (d) location.hash = d;
});

// Botón flotante para detener la voz
const $detener = document.getElementById("detener-voz");
voz.onCambio((hablando) => ($detener.hidden = !hablando));
$detener.addEventListener("click", () => voz.detener());

// Instalar como app
let eventoInstalar = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  eventoInstalar = e;
  mostrarBotonInstalar();
});
function mostrarBotonInstalar() {
  const b = document.getElementById("instalar");
  if (!b || !eventoInstalar) return;
  b.hidden = false;
  b.onclick = async () => {
    eventoInstalar.prompt();
    await eventoInstalar.userChoice;
    eventoInstalar = null;
    b.hidden = true;
  };
}

// ---------- Navegación ----------
async function router() {
  voz.detener();
  const [ruta, consulta = ""] = location.hash.slice(1).split("?");
  const partes = ruta.split("/").filter(Boolean).map(decodeURIComponent);
  const q = new URLSearchParams(consulta).get("q") || "";
  try {
    if (partes[0] === "anio") await vistaAnio(Number(partes[1]));
    else if (partes[0] === "asig") await vistaAsignatura(partes[1], partes[2]);
    else if (partes[0] === "buscar") await vistaBuscar(partes[1], q);
    else if (partes[0] === "leer") await vistaLeer(partes[1], Number(partes[2]), q);
    else if (partes[0] === "doc") {
      if (vistaDoc.docId !== partes[1]) vistaDoc.filtro = "todas";
      vistaDoc.docId = partes[1];
      await vistaDoc(partes[1], partes[2]);
    }
    else if (partes[0] === "biblioteca") await vistaBiblioteca();
    else if (partes[0] === "ayuda") vistaAyuda();
    else await vistaInicio();
  } catch (e) {
    console.error(e);
    poner("Error", `<p class="vacio">Algo salió mal: ${esc(e.message)}</p><a class="btn" href="#/">Volver al inicio</a>`);
  }
}

window.addEventListener("hashchange", router);
router();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch((e) => console.warn("Sin modo sin conexión:", e));
}
