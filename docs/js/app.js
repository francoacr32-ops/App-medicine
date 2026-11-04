// Finlay — pantallas y navegación.

import * as db from "./db.js";
import { extraerTexto, tipoDeArchivo, FORMATOS, cargarJSZip } from "./extraer.js";
import { fragmentarPagina, normalizar } from "./texto.js";
import { buscar, coincidencias, patronesDe } from "./buscar.js";
import * as voz from "./voz.js";
import { leerPaquete, importarPaquete } from "./paquete.js";
import { NOMBRE_TIPO, htmlEnunciado, htmlOpciones, corregir, textoRespuesta, esInmediata } from "./cuestionario.js";
import { localizar } from "./guia.js";
import { tieneVisual, totalPaginas, activarCarga, liberar as liberarDiapositivas, urlPagina } from "./diapositivas.js";
import { ico } from "./iconos.js";
import { pref, guardarPref, htmlMiniatura, htmlAnillo, htmlPulso, htmlSemana, insignias } from "./inicio.js";
import { metaDiaria, guardarMeta, calcularRacha, preguntasDelRepaso, preguntasDeExamen, nota, diasHasta, repartirPlan, crearPaquete } from "./estudio.js";

const ANIOS = ["1er año", "2do año", "3er año", "4to año", "5to año", "6to año"];
const $app = document.getElementById("app");
const $cabecera = document.getElementById("cabecera");

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

const ICONO = { libro: "📕", conferencia: "📝", taller: "🛠️" };
const icono = (doc) => ICONO[doc.tipo] || "📝";

function cita(doc, etiqueta, pagina) {
  return `${icono(doc)} <b>${esc(doc.nombre)}</b> — ${esc(etiqueta)} ${pagina}`;
}

/**
 * Pinta una pantalla. Con `titulo` null se muestra la cabecera de marca (inicio):
 * retrato de Finlay, nombre, "ESTUDIO MÉDICO" y el menú ☰.
 */
function poner(titulo, html, atras = null) {
  if (titulo === null) {
    $cabecera.className = "barra marca";
    $cabecera.innerHTML = `<img class="marca-retrato" src="iconos/retrato-finlay.webp" alt="Carlos J. Finlay">
      <div class="marca-texto"><span class="marca-nombre">Finlay</span><span class="marca-sub">ESTUDIO MÉDICO</span></div>
      <button class="btn-icono" data-accion="menu" aria-label="Menú">${ico("menu")}</button>`;
  } else {
    $cabecera.className = "barra";
    $cabecera.innerHTML = `${atras ? `<button class="atras" data-accion="volver" data-destino="${esc(atras)}" aria-label="Atrás">${ico("atras")}</button>` : ""}
      <h1>${esc(titulo)}</h1>
      <button class="btn-icono" data-accion="menu" aria-label="Menú">${ico("menu")}</button>`;
  }
  $app.innerHTML = html;
  window.scrollTo(0, 0);
  cargarImagenes($app);
}

function htmlFigura(id, pie) {
  if (!id) return "";
  return `<figure class="figura"><img data-img="${esc(id)}" alt="${esc(pie || "Imagen")}" data-accion="ampliar">
    ${pie ? `<figcaption>${esc(pie)}</figcaption>` : ""}<span class="sub">🔍 Toca la imagen para ampliarla</span></figure>`;
}

async function cargarImagenes(raiz) {
  for (const img of raiz.querySelectorAll("img[data-img]:not([src])")) {
    const datos = await db.obtenerImagen(img.dataset.img);
    if (datos) img.src = datos;
    else img.closest("figure")?.remove();
  }
}

// Ver una imagen en grande (con zoom de dos dedos del navegador)
const $lupa = document.getElementById("lupa");
function ampliar(src) {
  $lupa.querySelector("img").src = src;
  $lupa.hidden = false;
  history.pushState({ lupa: true }, "");
}
function cerrarLupa(desdeHistorial = false) {
  if ($lupa.hidden) return false;
  $lupa.hidden = true;
  if (!desdeHistorial && history.state?.lupa) history.back();
  return true;
}

// ---------- Pantalla: Inicio (diseño de la maqueta) ----------
async function progresoAsignatura(asig) {
  const docs = await db.documentosDeAsignatura(asig.id);
  let total = 0;
  let bien = 0;
  for (const d of docs) {
    if (!d.cuestionario?.length) continue;
    total += d.cuestionario.length;
    bien += (await db.respuestasDe(d.id)).filter((r) => r.ultima).length;
  }
  return { docs, total, bien, pct: total ? Math.round((bien / total) * 100) : 0 };
}

function htmlTarjetaAsignatura(a, p) {
  return `<a class="tarjeta asig-tarjeta" href="${enlaceAsig(a.id)}">
    ${htmlMiniatura(a.nombre, a.anio)}
    <span class="asig-cuerpo">
      <span class="asig-nombre">${esc(a.nombre)}</span>
      ${p.total
        ? `<span class="asig-barra"><span class="barra-progreso"><span class="en-camino" style="width:${p.pct}%"></span></span><b>${p.pct}%</b></span>`
        : `<span class="sub">${p.docs.length} tema${p.docs.length === 1 ? "" : "s"}</span>`}
    </span>
    ${ico("chevron", "flecha-der")}
  </a>`;
}

async function vistaInicio() {
  const docs = await db.listarDocumentos();
  const nombre = pref("nombre");
  if (!docs.length) {
    return poner(null, `
      <section class="bienvenida">
        <img src="iconos/cruz.webp" alt="" class="bienvenida-cruz">
        <h2 class="hola">¡Bienvenido${nombre ? ", " + esc(nombre) : ""} a Finlay!</h2>
        <p>Tu app para estudiar Medicina con tus conferencias, libros y clases taller, sin internet.</p>
        <label class="bienvenida-nombre" for="aj-nombre">¿Cómo te llamas?
          <input id="aj-nombre" value="${esc(nombre)}" maxlength="30" placeholder="Escribe tu nombre" autocomplete="given-name">
        </label>
        <button class="btn btn-repasar solo-manual" data-accion="paquete">${ico("cargar")}<span>Cargar paquete de Claude</span>${ico("chevron")}</button>
        <a class="btn secundario btn-explorar" href="#/temas">Explorar los temas</a>
        <p class="nota">En honor a Carlos J. Finlay, el médico cubano que descubrió que el mosquito transmite la fiebre amarilla.</p>
      </section>`);
  }
  const { racha, hoy: deHoy } = calcularRacha(await db.listarDiario());
  const meta = metaDiaria();
  const conPreguntas = docs.filter((d) => d.cuestionario?.length);
  const { lista } = preguntasDelRepaso(conPreguntas, await db.todasLasRespuestas(), meta);

  // Examen más cercano
  let plan = "";
  const planes = (await db.listarPlanes()).filter((p) => diasHasta(p.fecha) >= 0).sort((a, b) => a.fecha.localeCompare(b.fecha));
  if (planes.length) {
    const p = planes[0];
    const dias = repartirPlan(p.fecha, await temasConEstado(p.asignatura));
    const deHoyPlan = dias.find((d) => d.fecha === db.hoy());
    const que = deHoyPlan?.repasoGeneral ? "Repaso general" : deHoyPlan?.temas.map((t) => t.doc.nombre.split(" - ")[0]).join(" · ");
    plan = `<a class="tarjeta fila-tarjeta" href="#/plan/${p.id}">
      <span class="icono-caja naranja">${ico("calendario")}</span>
      <span class="asig-cuerpo"><span class="asig-nombre">${esc(p.nombre)} · <b class="texto-naranja">${textoDias(diasHasta(p.fecha))}</b></span>
      <span class="sub">${esc(p.asignatura.split("|")[1])}${que ? " · Hoy: " + esc(que) : ""}</span></span>
      ${ico("chevron", "flecha-der")}</a>`;
  }

  // Continuar donde lo dejaste
  let continuar = "";
  const ultimo = pref("ultimo");
  const docUltimo = ultimo && docs.find((d) => d.id === ultimo);
  if (docUltimo) {
    continuar = `<a class="tarjeta fila-tarjeta" href="#/doc/${docUltimo.id}">
      <span class="icono-caja">${ico("play")}</span>
      <span class="asig-cuerpo"><span class="sub">Continuar donde lo dejaste</span>
      <span class="asig-nombre">${esc(docUltimo.nombre)}</span></span>${ico("chevron", "flecha-der")}</a>`;
  }

  // Asignaturas con materiales
  const asigs = (await db.listarAsignaturas()).filter((a) => docs.some((d) => d.asignaturas.includes(a.id)));
  const tarjetas = [];
  for (const a of asigs) tarjetas.push(htmlTarjetaAsignatura(a, await progresoAsignatura(a)));

  const pedirNombre = nombre ? "" : `<form class="tarjeta pedir-nombre" data-form="nombre">
      <label for="aj-nombre">¿Cómo te llamas? Así te saludo al entrar.</label>
      <div class="buscador"><input id="aj-nombre" maxlength="30" placeholder="Tu nombre" autocomplete="given-name" required>
      <button class="btn">Guardar</button></div></form>`;
  poner(null, `
    ${pedirNombre}
    <section class="saludo">
      <div class="saludo-izq">
        <h2 class="hola">Hola${nombre ? ", " + esc(nombre) : ""}</h2>
        <p class="animo">${deHoy.preguntas >= meta ? "¡Meta de hoy cumplida! 🎉" : "Sigue avanzando hacia tu meta"}</p>
        ${htmlPulso}
      </div>
      <div class="saludo-der">
        <span class="pastilla-racha">${ico("llama")}<b>${racha}</b> día${racha === 1 ? "" : "s"} seguido${racha === 1 ? "" : "s"}</span>
        ${htmlAnillo(deHoy.preguntas, meta)}
      </div>
    </section>
    ${lista.length
      ? `<a class="btn btn-repasar" href="#/repaso">${ico("playc")}<span>Repasar hoy</span><span class="contador">${lista.length}</span>${ico("chevron")}</a>`
      : `<a class="btn btn-repasar" href="#/examen">${ico("check")}<span>¡Al día! Hacer un examen</span>${ico("chevron")}</a>`}
    ${plan}
    ${continuar}
    <div class="lista-asig">${tarjetas.join("")}</div>
  `);
}

// ---------- Pantalla: Temas (años, buscador y materiales) ----------
// Ícono y color de cada año (como en el diseño)
const ESTILO_ANIO = [["birrete", "#12b5c2"], ["libro", "#2f7ff0"], ["matraz", "#9b4fe0"],
  ["estetoscopio", "#13bfa0"], ["microscopio", "#f2962e"], ["adn", "#e5408f"]];
async function vistaTemas() {
  const asigs = await db.listarAsignaturas();
  const docs = await db.listarDocumentos();
  const tarjetas = ANIOS.map((nombre, i) => {
    const n = asigs.filter((a) => a.anio === i + 1).length;
    const conMateriales = docs.some((d) => d.asignaturas.some((x) => x.startsWith(`${i + 1}|`)));
    const [icono, color] = ESTILO_ANIO[i];
    return `<a class="tarjeta anio${conMateriales ? " con-asig" : ""}" style="--c:${color}" href="#/anio/${i + 1}">
      <span class="anio-ico">${ico(icono)}</span>
      ${conMateriales ? `<span class="anio-check">${ico("check")}</span>` : ""}
      <span class="anio-pie"><span><span class="grande">${esc(nombre)}</span>
        <span class="sub">${n ? `${n} asignatura${n > 1 ? "s" : ""}` : "Vacío"}</span></span>
        <span class="anio-flecha">${ico("chevron")}</span></span></a>`;
  }).join("");
  poner("Temas", `
    <form class="buscador" data-ambito="todo">
      <input name="q" type="search" placeholder="Buscar en toda la carrera…" autocomplete="off" required>
      <button class="btn" aria-label="Buscar">${ico("buscar")}</button>
    </form>
    <h2>Elige un año</h2>
    <div class="rejilla">${tarjetas}</div>
    <button class="btn ancho solo-manual" data-accion="paquete">${ico("cargar")} Cargar paquete de Claude</button>
    <p class="nota centro">${docs.length} materiales cargados · <a href="#/biblioteca">Ver todos</a></p>`);
}

// ---------- Pantalla: Progreso (estadísticas e insignias) ----------
async function vistaProgresoGeneral() {
  const diario = await db.listarDiario();
  const { racha } = calcularRacha(diario);
  const respuestas = await db.todasLasRespuestas();
  const totalRespondidas = diario.reduce((s, d) => s + d.preguntas, 0);
  const totalBien = diario.reduce((s, d) => s + d.correctas, 0);
  const docs = (await db.listarDocumentos()).filter((d) => d.cuestionario?.length);
  let temasDominados = 0;
  for (const d of docs) if ((await estadoDe(d)).estado === "dominado") temasDominados++;
  const examenes = await db.listarExamenes();
  const mejorNota = examenes.reduce((m, e) => Math.max(m, e.nota), 0);
  const lista = insignias({ racha, totalRespondidas, temasDominados, mejorNota });
  const asigs = (await db.listarAsignaturas()).filter((a) => docs.some((d) => d.asignaturas.includes(a.id)));
  const filas = [];
  for (const a of asigs) {
    const p = await progresoAsignatura(a);
    filas.push(`<a class="tarjeta asig-tarjeta" href="${enlaceAsig(a.id)}/progreso">${htmlMiniatura(a.nombre, a.anio)}
      <span class="asig-cuerpo"><span class="asig-nombre">${esc(a.nombre)}</span>
      <span class="asig-barra"><span class="barra-progreso"><span class="en-camino" style="width:${p.pct}%"></span></span><b>${p.pct}%</b></span>
      <span class="sub">${p.bien} de ${p.total} preguntas dominadas</span></span>${ico("chevron", "flecha-der")}</a>`);
  }
  poner("Progreso", `
    <div class="cifras">
      <div class="tarjeta cifra">${ico("llama", "texto-naranja")}<b>${racha}</b><span>días seguidos</span></div>
      <div class="tarjeta cifra">${ico("check")}<b>${totalRespondidas}</b><span>respondidas</span></div>
      <div class="tarjeta cifra">${ico("trofeo")}<b>${totalRespondidas ? Math.round((totalBien / totalRespondidas) * 100) : 0}%</b><span>de aciertos</span></div>
    </div>
    <h2>Esta semana</h2>
    <div class="tarjeta">${htmlSemana(diario, db.hoy())}</div>
    <h2>Por asignatura</h2>
    ${filas.join("") || `<p class="vacio">Cuando respondas cuestionarios, aquí verás tu avance.</p>`}
    <h2>Insignias · ${lista.filter((x) => x.ok).length} de ${lista.length}</h2>
    <div class="insignias">${lista.map((x) => `<div class="insignia ${x.ok ? "ganada" : ""}" title="${esc(x.d)}">
      <span class="insignia-emoji">${x.e}</span><b>${esc(x.t)}</b><span class="sub">${esc(x.d)}</span></div>`).join("")}</div>
    <p class="nota centro">${respuestas.length} preguntas distintas practicadas.</p>`);
}

// ---------- Pantalla: Evaluaciones (repaso, examen y plan) ----------
async function vistaEvaluaciones() {
  const docs = (await db.listarDocumentos()).filter((d) => d.cuestionario?.length);
  const { lista } = preguntasDelRepaso(docs, await db.todasLasRespuestas(), metaDiaria());
  const planes = (await db.listarPlanes()).filter((p) => diasHasta(p.fecha) >= 0).sort((a, b) => a.fecha.localeCompare(b.fecha));
  const examenes = (await db.listarExamenes()).sort((a, b) => b.fecha - a.fecha).slice(0, 5);
  poner("Evaluaciones", `
    <a class="tarjeta fila-tarjeta" href="#/repaso"><span class="icono-caja">${ico("repaso")}</span>
      <span class="asig-cuerpo"><span class="asig-nombre">Repaso del día</span>
      <span class="sub">${lista.length ? `${lista.length} preguntas te esperan hoy` : "¡Estás al día!"}</span></span>${ico("chevron", "flecha-der")}</a>
    <a class="tarjeta fila-tarjeta" href="#/examen"><span class="icono-caja">${ico("examen")}</span>
      <span class="asig-cuerpo"><span class="asig-nombre">Examen de práctica</span>
      <span class="sub">Con cronómetro y nota de 2 a 5</span></span>${ico("chevron", "flecha-der")}</a>
    <a class="tarjeta fila-tarjeta" href="#/planes"><span class="icono-caja naranja">${ico("calendario")}</span>
      <span class="asig-cuerpo"><span class="asig-nombre">Plan para el examen</span>
      <span class="sub">${planes.length ? `${esc(planes[0].nombre)}: ${textoDias(diasHasta(planes[0].fecha))}` : "Pon la fecha de tu próxima prueba"}</span></span>${ico("chevron", "flecha-der")}</a>
    ${examenes.length ? `<h2>Tus últimas notas</h2><ul class="docs">${examenes
      .map((e) => `<li class="doc"><span><b class="nota-num n${e.nota}">${e.nota}</b> ${esc(e.titulo)}</span>
        <span class="sub">${new Date(e.fecha).toLocaleDateString("es")} · ${e.porcentaje} % · ${e.cantidad} preguntas</span></li>`).join("")}</ul>` : ""}`);
}

// ---------- Pantalla: Perfil (nombre y ajustes) ----------
async function vistaPerfil() {
  const docs = await db.listarDocumentos();
  let espacio = "";
  if (navigator.storage?.estimate) {
    try {
      const { usage } = await navigator.storage.estimate();
      espacio = ` · ${(usage / 1048576).toFixed(1)} MB usados`;
    } catch {}
  }
  const opcion = (v, t, actual) => `<option value="${v}" ${String(v) === String(actual) ? "selected" : ""}>${t}</option>`;
  poner("Perfil", `
    <section class="tarjeta perfil-cabeza">
      <img src="iconos/logo.webp" alt="" class="perfil-logo">
      <div><b>Finlay</b><span class="sub">Estudio médico · versión 1.7</span><span class="sub">${docs.length} materiales${espacio}</span></div>
    </section>
    <h2>Tus datos</h2>
    <div class="tarjeta ajustes">
      <label for="aj-nombre">Tu nombre<input id="aj-nombre" value="${esc(pref("nombre"))}" maxlength="30" placeholder="Para saludarte en el inicio"></label>
    </div>
    <h2>Ajustes</h2>
    <div class="tarjeta ajustes">
      <label for="aj-tema">Apariencia<select id="aj-tema">${opcion("hora", "Automática por la hora (clara de día, oscura de noche)", pref("tema", "hora"))}${opcion("claro", "Clara", pref("tema", "hora"))}${opcion("oscuro", "Oscura", pref("tema", "hora"))}${opcion("telefono", "Igual que el teléfono", pref("tema", "hora"))}</select></label>
      <label for="aj-escala">Tamaño de letra<select id="aj-escala">${opcion("1", "Normal", pref("escala", "1"))}${opcion("1.12", "Grande", pref("escala", "1"))}${opcion("1.25", "Muy grande", pref("escala", "1"))}</select></label>
      <label for="meta">Meta diaria de preguntas<select id="meta">${[5, 10, 15, 20, 30, 50, 60].map((v) => opcion(v, v, metaDiaria())).join("")}</select></label>
      <label for="velocidad">Velocidad de la voz<select id="velocidad">${[0.8, 0.9, 1, 1.15, 1.3, 1.5].map((v) => opcion(v, v + "×", velocidadVoz())).join("")}</select></label>
    </div>
    <h2>Tus materiales</h2>
    <a class="tarjeta fila-tarjeta" href="#/copia"><span class="icono-caja">${ico("copia")}</span>
      <span class="asig-cuerpo"><span class="asig-nombre">Copia y compartir</span><span class="sub">Guarda tu progreso o pásalo por Zapya</span></span>${ico("chevron", "flecha-der")}</a>
    <button class="tarjeta fila-tarjeta boton-fila" data-accion="paquete"><span class="icono-caja">${ico("cargar")}</span>
      <span class="asig-cuerpo"><span class="asig-nombre">Cargar paquete de Claude</span><span class="sub">Conferencias y cuestionarios nuevos</span></span>${ico("chevron", "flecha-der")}</button>
    <a class="tarjeta fila-tarjeta" href="#/ayuda"><span class="icono-caja">${ico("ayuda")}</span>
      <span class="asig-cuerpo"><span class="asig-nombre">Cómo usar Finlay</span><span class="sub">Guía rápida</span></span>${ico("chevron", "flecha-der")}</a>
    <button id="instalar" class="btn secundario" hidden>📲 Instalar Finlay en el teléfono</button>
    <p class="nota centro">Hecha para estudiantes de Medicina en Cuba, en honor a Carlos J. Finlay (1833–1915).</p>`);
  mostrarBotonInstalar();
}

// ---------- Menú ☰ ----------
const $menu = document.getElementById("menu");
function abrirMenu() {
  $menu.querySelector(".menu-panel").innerHTML = `
    <div class="menu-cabeza"><img src="iconos/logo.webp" alt=""><b>Finlay</b></div>
    <div class="menu-tema" role="group" aria-label="Apariencia">
      ${[["claro", "sol", "Claro"], ["oscuro", "luna", "Oscuro"], ["hora", "reloj", "Por la hora"]].map(([v, i, t]) =>
        `<button data-accion="tema" data-tema="${v}" class="${pref("tema", "hora") === v ? "activo" : ""}">${ico(i)}<span>${t}</span></button>`).join("")}
    </div>
    <a href="#/temas">${ico("buscar")} Buscar en toda la carrera</a>
    <a href="#/biblioteca">${ico("libro")} Todos los materiales</a>
    <a href="#/planes">${ico("calendario")} Plan para el examen</a>
    <button data-accion="paquete">${ico("cargar")} Cargar paquete de Claude</button>
    <a href="#/copia">${ico("copia")} Copia y compartir</a>
    <a href="#/perfil">${ico("ajustes")} Ajustes</a>
    <a href="#/ayuda">${ico("ayuda")} Cómo usar Finlay</a>`;
  $menu.hidden = false;
}
function cerrarMenu() {
  $menu.hidden = true;
}

// ---------- Apariencia: clara, oscura o automática por la hora ----------
function temaReal(eleccion = pref("tema", "hora")) {
  if (eleccion === "claro" || eleccion === "oscuro") return eleccion;
  if (eleccion === "telefono") return matchMedia("(prefers-color-scheme: dark)").matches ? "oscuro" : "claro";
  const h = new Date().getHours();
  return h >= 19 || h < 7 ? "oscuro" : "claro"; // de 7 de la noche a 7 de la mañana: oscuro
}
function aplicarTema() {
  const t = temaReal();
  if (document.documentElement.dataset.tema !== t) document.documentElement.dataset.tema = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t === "oscuro" ? "#071521" : "#e9f7f8");
}
function cambiarTema(valor) {
  guardarPref("tema", valor);
  aplicarTema();
  document.querySelectorAll(".menu-tema button").forEach((b) => b.classList.toggle("activo", b.dataset.tema === valor));
  const sel = document.getElementById("aj-tema");
  if (sel) sel.value = valor;
}
aplicarTema();
setInterval(aplicarTema, 60 * 1000);
document.addEventListener("visibilitychange", () => !document.hidden && aplicarTema());
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", aplicarTema);

// ---------- Barra inferior ----------
const PESTANAS = [
  ["inicio", "#/", "Inicio", "inicio"],
  ["temas", "#/temas", "Temas", "estudiar"],
  ["progreso", "#/progreso", "Progreso", "grafica"],
  ["evaluaciones", "#/evaluaciones", "Evaluaciones", "examen"],
  ["perfil", "#/perfil", "Perfil", "yo"],
];
const SECCION_DE_RUTA = {
  "": "inicio", temas: "temas", anio: "temas", asig: "temas", doc: "temas", leer: "temas", buscar: "temas", biblioteca: "temas",
  progreso: "progreso",
  evaluaciones: "evaluaciones", repaso: "evaluaciones", examen: "evaluaciones", "examen-hacer": "evaluaciones", planes: "evaluaciones", plan: "evaluaciones",
  perfil: "perfil", copia: "perfil", ayuda: "perfil",
};
function pintarNav(ruta) {
  const activa = SECCION_DE_RUTA[ruta] || "inicio";
  document.getElementById("nav").innerHTML = PESTANAS.map(([id, href, texto, icono]) =>
    `<a href="${href}" class="${id === activa ? "activa" : ""}" ${id === activa ? 'aria-current="page"' : ""}>${ico(icono)}<span>${texto}</span></a>`
  ).join("");
}

// ---------- Pantalla: un año (asignaturas separadas por semestre) ----------
const SEMESTRES = [
  [1, "1er semestre"],
  [2, "2do semestre"],
  [0, "Anual (todo el curso)"],
  [null, "Asignaturas"],
];

function selectorSemestre(nombre, valor, id = "") {
  return `<select name="${nombre}" ${id ? `id="${id}"` : ""} aria-label="Semestre">
    ${SEMESTRES.map(([v, t]) => `<option value="${v ?? ""}" ${(valor ?? null) === v ? "selected" : ""}>${t}</option>`).join("")}
  </select>`;
}

const leerSemestre = (v) => (v === "" ? null : Number(v));

async function vistaAnio(anio) {
  const asigs = await db.listarAsignaturas(anio);
  const tarjeta = async (a) => {
    const docs = await db.documentosDeAsignatura(a.id);
    const c = docs.filter((d) => d.tipo !== "libro").length;
    const l = docs.length - c;
    const preguntas = docs.reduce((s, d) => s + (d.cuestionario?.length || 0), 0);
    return `<a class="tarjeta asig-tarjeta" href="${enlaceAsig(a.id)}">${htmlMiniatura(a.nombre, a.anio)}
      <span class="asig-cuerpo"><span class="asig-nombre">${esc(a.nombre)}</span>
      <span class="sub">${c || l ? `${c} conferencias y talleres${l ? ` · ${l} libros` : ""}${preguntas ? ` · ${preguntas} preguntas` : ""}` : "Pronto: conferencias y cuestionarios"}</span></span>
      ${ico("chevron", "flecha-der")}</a>`;
  };
  let secciones = "";
  for (const [valor, titulo] of SEMESTRES) {
    const grupo = asigs.filter((a) => (a.semestre ?? null) === valor);
    if (!grupo.length) continue;
    secciones += `<h2 class="semestre">${titulo} <span class="sub">· ${grupo.length} asignatura${grupo.length > 1 ? "s" : ""}</span></h2>
      ${(await Promise.all(grupo.map(tarjeta))).join("")}`;
  }
  poner(
    ANIOS[anio - 1],
    `${secciones || `<p class="vacio">Todavía no hay asignaturas en ${ANIOS[anio - 1]}.</p>`}
     <h2 class="solo-manual">Añadir asignatura</h2>
     <form class="nueva-asig solo-manual" data-anio="${anio}">
       <input name="nombre" placeholder="Nombre (ej. Morfofisiología)" required maxlength="80">
       ${selectorSemestre("semestre", 1)}
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
  const lista = docs.filter((d) => (tipo === "libro" ? d.tipo === "libro" : d.tipo !== "libro"));

  const items = lista
    .map(
      (d) => `<li class="doc">
        <a href="#/doc/${d.id}" class="doc-nombre">${icono(d)} ${esc(d.nombre)}</a>
        <span class="sub">${d.paginas ? `${d.paginas} ${d.etiqueta === "diap." ? "diapositivas" : d.etiqueta === "parte" ? "partes" : "páginas"}` : "sin texto completo"}${d.asignaturas.length > 1 ? " · compartido en " + d.asignaturas.length + " asignaturas" : ""}${d.sinTexto ? ` · ⚠️ ${d.sinTexto} sin texto` : ""}</span>
        ${d.cuestionario || d.diapositivas || d.pdf ? `<span class="etiquetas">${d.diapositivas || d.pdf ? '<span class="chip">🖼️ Diapositivas</span>' : ""}${d.cuestionario ? `<span class="chip">❓ ${d.cuestionario.length} preguntas</span>` : ""}</span>` : ""}
        <span class="acciones solo-manual">
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
    `<p class="migas">${esc(ANIOS[asig.anio - 1])} · ${selectorSemestre("semestre", asig.semestre, "semestre-asig")}</p>
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
     <button class="btn ancho solo-manual" data-accion="cargar" data-asig="${esc(id)}" data-tipo="${tipo}">
       ＋ Cargar ${tipo === "libro" ? "libros" : "conferencias"} (PDF, Word, PowerPoint)</button>
     ${otrosLibros.length ? `<details class="compartir"><summary>📚 Usar un libro que ya cargaste en otra asignatura</summary>
        <ul>${otrosLibros.map((d) => `<li><button class="btn mini" data-accion="vincular" data-id="${d.id}" data-asig="${esc(id)}">＋</button> ${esc(d.nombre)}</li>`).join("")}</ul>
        <p class="nota">Así el libro no se guarda dos veces.</p></details>` : ""}
     <div class="acciones abajo">
       ${docs.some((d) => d.cuestionario?.length) ? `<a class="btn mini" href="#/examen/${encodeURIComponent(id)}">📝 Examen de esta asignatura</a>` : ""}
       <a class="btn mini" href="#/planes">📅 Poner fecha de examen</a>
     </div>
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
     ${tieneVisual(doc) ? `<img class="visor-diapo" id="leer-img" alt="${esc(doc.etiqueta)} ${pagina}" data-accion="ampliar">` : ""}
     <div class="pagina">${resaltar(texto, patrones).replace(/\n/g, "<br>")}</div>
     ${nav}`,
    `#/doc/${docId}/texto`
  );
  if (q) document.querySelector("[data-accion=volver]")?.setAttribute("data-destino", "historial");
  vistaLeer.texto = texto;
  if (tieneVisual(doc)) urlPagina(doc, pagina).then((u) => { const i = document.getElementById("leer-img"); if (u && i) i.src = u; else i?.remove(); });
  const primera = $app.querySelector("mark");
  if (primera) primera.scrollIntoView({ block: "center" });
}

// ---------- Pantalla: un documento (resumen, cuestionario y texto completo) ----------

async function vistaDoc(docId, pestana, irA = 0) {
  const doc = await db.obtenerDocumento(docId);
  if (!doc) return (location.hash = "#/");
  guardarPref("ultimo", docId);
  if (pestana !== "cuestionario") pestana = "conferencia";
  const asigActual = doc.asignaturas[0];
  const base = `#/doc/${docId}`;
  const nombreTipo = doc.tipo === "libro" ? "Libro" : doc.tipo === "taller" ? "Clase taller" : "Conferencia";
  const nPreg = doc.cuestionario?.length || 0;
  const pestanas = `<nav class="pestanas">
      <a href="${base}/conferencia" class="${pestana === "conferencia" ? "activa" : ""}">${nombreTipo}</a>
      <a href="${base}/cuestionario" class="${pestana === "cuestionario" ? "activa" : ""}">Cuestionario${nPreg ? ` (${nPreg})` : ""}</a>
    </nav>`;

  let cuerpo = "";
  if (pestana === "cuestionario") {
    cuerpo = nPreg
      ? await htmlCuestionario(doc)
      : `<div class="no-encontrado"><b>Todavía no hay cuestionario.</b>
          <p>Pulsa <b>📤 Exportar texto</b> y mándale el archivo a Claude: te devolverá el cuestionario.</p>
          <button class="btn mini" data-accion="exportar" data-id="${doc.id}">📤 Exportar texto</button></div>`;
  } else if (tieneVisual(doc)) {
    // Diapositivas con su formato original, una debajo de otra como en un lector de PDF
    const total = totalPaginas(doc);
    const palabra = doc.etiqueta === "diap." || doc.diapositivas ? "Diapositiva" : "Página";
    cuerpo = `<p class="sub diapo-info">${total} ${palabra === "Diapositiva" ? "diapositivas" : "páginas"} · toca una para ampliarla</p>
      <div class="diapos">${Array.from({ length: total }, (_, k) => k + 1).map((n) => `
        <figure class="diapo" id="d${n}">
          <img data-diapo="${n}" alt="${palabra} ${n}" data-accion="ampliar" width="960" height="720">
          <figcaption><span>${palabra} ${n}</span>
            <button class="btn-icono mini-voz" data-accion="leer-diapo" data-n="${n}" aria-label="Escuchar la ${palabra.toLowerCase()} ${n}">${ico("voz")}</button></figcaption>
        </figure>`).join("")}</div>`;
  } else if (doc.paginas) {
    // Sin imagen (Word o PowerPoint cargado desde el teléfono): el texto de cada página en una tarjeta
    const frags = await db.fragmentosDe(doc.id);
    const paginas = [...new Set(frags.map((x) => x.pagina))];
    const aviso = doc.origen === "paquete"
      ? `<div class="no-encontrado consejo"><b>Faltan las diapositivas de esta conferencia</b>
          <p>Carga el paquete <b>.zip</b> de ${esc(doc.asignaturas[0].split("|").slice(1).join("|"))} que te mandó Claude.
          Así se ve igual que el PDF. No pierdes tu progreso.</p>
          <button class="btn ancho" data-accion="paquete">${ico("cargar")} Cargar paquete .zip</button></div>`
      : `<div class="no-encontrado consejo"><b>Para verla con su formato original</b>
          <p>Ábrela en WPS u Office, elige <b>Exportar a PDF</b> y carga el PDF en Finlay.</p></div>`;
    cuerpo = `${aviso}
      <div class="diapos">${(await Promise.all(paginas.map(async (n) => `
        <figure class="diapo diapo-texto" id="d${n}">
          <div class="diapo-hoja">${esc(await db.textoDePagina(doc.id, n)).replace(/\n/g, "<br>")}</div>
          <figcaption><span>${esc(doc.etiqueta)} ${n}</span>
            <button class="btn-icono mini-voz" data-accion="leer-diapo" data-n="${n}" aria-label="Escuchar">${ico("voz")}</button></figcaption>
        </figure>`))).join("")}</div>`;
  } else {
    cuerpo = `<p class="vacio">Este material no tiene la conferencia completa.</p>`;
  }

  poner(
    doc.nombre,
    `<p class="migas">${esc(doc.asignaturas.map(nombreAsig).join(" · "))}</p>${pestanas}${cuerpo}
     ${pestana === "conferencia" && doc.paginas ? `<button class="btn mini abajo solo-manual" data-accion="exportar" data-id="${doc.id}">📤 Exportar texto para Claude</button>` : ""}`,
    enlaceAsig(asigActual) + (doc.tipo === "libro" ? "/libros" : "")
  );
  vistaDoc.doc = doc;
  if (pestana === "cuestionario") iniciarSesion(false);
  else if (tieneVisual(doc)) activarCarga($app, doc);
  if (irA) document.getElementById("d" + irA)?.scrollIntoView({ block: "start" });
}

// ---------- Motor de preguntas (sirve para el cuestionario, el repaso y el examen) ----------
let enPantalla = []; // posición en pantalla → { doc, i }
let modo = "normal"; // "normal" | "examen"
let alResponder = () => {};
const elegidasExamen = new Map();

function htmlTarjeta(k, previa = null, conOrigen = false) {
  const { doc, i } = enPantalla[k];
  const p = doc.cuestionario[i];
  const titulo = conOrigen ? `${k + 1}. ${esc(doc.nombre)} · ${NOMBRE_TIPO[p.tipo]}` : `${i + 1}. ${NOMBRE_TIPO[p.tipo]}`;
  return `<article class="pregunta" id="p${k}">
    <p class="sub">${titulo}${previa ? ` · la última vez: ${previa.ultima ? "✅" : "❌"}` : ""}</p>
    <p class="enunciado">${htmlEnunciado(p)}</p>
    ${htmlFigura(p.imagen, p.pie)}
    <div class="opciones">${htmlOpciones(p, k)}</div>
    <div class="explicacion" hidden></div>
  </article>`;
}

function mostrarCorreccion(k, r, sinResponder = false) {
  const { doc, i } = enPantalla[k];
  const p = doc.cuestionario[i];
  const parcial = r.total > 1 ? ` (${r.aciertos} de ${r.total} bien)` : "";
  const titulo = sinResponder ? "⚪ Sin responder." : r.correcta ? "✅ ¡Correcto!" : `❌ Incorrecto${parcial}.`;
  const caja = document.querySelector(`#p${k} .explicacion`);
  caja.innerHTML = `<b>${titulo}</b> ${esc(textoRespuesta(p))}
    ${p.explicacion ? `<p>${esc(p.explicacion)}</p>` : ""}
    ${p.fuente ? `<p class="fuente">📌 Fuente: ${esc(doc.nombre)}, ${esc(p.fuente)}</p>` : ""}
    <div class="acciones">
      ${!r.correcta ? botonGuia(k) : ""}
      <button class="btn mini" data-accion="leer-explicacion" data-i="${k}">🔊 Escuchar</button>
    </div>`;
  caja.hidden = false;
}

/** Botón que lleva a la parte del material donde está la respuesta. */
function botonGuia(k) {
  const { doc } = enPantalla[k];
  if (!doc.paginas) return "";
  return `<button class="btn mini btn-corrector" data-accion="guia" data-i="${k}">📖 Ver dónde está en ${doc.tipo === "libro" ? "el libro" : "la conferencia"}</button>`;
}

// ---------- Visor de corrección (se abre encima, sin perder la pregunta) ----------
const $visor = document.getElementById("visor");
let visorEstado = null;

function htmlConCorrector(texto, rango) {
  if (!rango) return esc(texto).replace(/\n/g, "<br>");
  const [a, b] = rango;
  return (esc(texto.slice(0, a)) + `<mark class="corrector" id="corrector">${esc(texto.slice(a, b))}</mark>` + esc(texto.slice(b)))
    .replace(/\n/g, "<br>");
}

async function abrirVisor(k) {
  const { doc, i } = enPantalla[k];
  const p = doc.cuestionario[i];
  mostrarProgreso("Buscando la respuesta en el material…");
  const lugar = await localizar(doc, p);
  mostrarProgreso(null);
  if (!lugar) return aviso("Este material no tiene el texto completo para mostrarte la parte.");
  const paginas = [...new Set((await db.fragmentosDe(doc.id)).map((f) => f.pagina))];
  visorEstado = { doc, p, paginas, lugar, actual: lugar.pagina };
  if ($visor.hidden) history.pushState({ visor: true }, "");
  $visor.hidden = false;
  document.body.classList.add("sin-scroll");
  await pintarVisor();
}

async function pintarVisor() {
  const { doc, p, paginas, lugar, actual } = visorEstado;
  const esLaMarcada = actual === lugar.pagina;
  const texto = esLaMarcada ? lugar.texto : await db.textoDePagina(doc.id, actual);
  const idx = paginas.indexOf(actual);
  const nav = `<div class="paginador">
      ${idx > 0 ? `<button class="btn mini" data-accion="visor-pag" data-p="${paginas[idx - 1]}">◀ Anterior</button>` : "<span></span>"}
      <span>${esc(doc.etiqueta)} ${actual}</span>
      ${idx < paginas.length - 1 ? `<button class="btn mini" data-accion="visor-pag" data-p="${paginas[idx + 1]}">Siguiente ▶</button>` : "<span></span>"}
    </div>`;
  document.getElementById("visor-cuerpo").innerHTML = `
    <div class="respuesta-correcta"><b>✏️ Respuesta correcta:</b> ${esc(textoRespuesta(p).replace(/^(La respuesta correcta es|Las correctas son:|Respuestas?:)\s*/, ""))}</div>
    <p class="cita">${cita(doc, doc.etiqueta, actual)}</p>
    ${tieneVisual(doc) ? `<img class="visor-diapo" id="visor-img" alt="${esc(doc.etiqueta)} ${actual}" data-accion="ampliar">` : ""}
    ${esLaMarcada
      ? lugar.rango
        ? `<p class="nota">La parte <mark class="corrector">marcada en verde</mark> es donde está la respuesta.</p>
           <button class="btn mini" data-accion="visor-leer">🔊 Escuchar la parte marcada</button>`
        : `<p class="nota">No pude ubicar la frase exacta: revisa esta página.</p>`
      : `<button class="btn mini" data-accion="visor-pag" data-p="${lugar.pagina}">✏️ Volver a la parte marcada (${esc(doc.etiqueta)} ${lugar.pagina})</button>`}
    ${nav}
    ${tieneVisual(doc) ? `<p class="sub">Texto de la diapositiva:</p>` : ""}
    <div class="pagina">${htmlConCorrector(texto, esLaMarcada ? lugar.rango : null)}</div>
    ${nav}`;
  if (tieneVisual(doc)) urlPagina(doc, actual).then((u) => { const i = document.getElementById("visor-img"); if (u && i) i.src = u; else i?.remove(); });
  const marca = document.getElementById("corrector");
  const caja = $visor.querySelector(".visor-caja");
  if (marca) marca.scrollIntoView({ block: "center" });
  else caja.scrollTop = 0;
}

function cerrarVisor(desdeHistorial = false) {
  if ($visor.hidden) return;
  voz.detener();
  $visor.hidden = true;
  document.body.classList.remove("sin-scroll");
  visorEstado = null;
  if (!desdeHistorial && history.state?.visor) history.back();
}

// El botón "atrás" del teléfono cierra el visor en vez de salir de la pantalla
window.addEventListener("popstate", () => cerrarLupa(true) || cerrarVisor(true));
document.addEventListener("keydown", (e) => e.key === "Escape" && cerrarVisor());

async function responder(k, valor) {
  const { doc, i } = enPantalla[k];
  const p = doc.cuestionario[i];
  const tarjeta = document.getElementById("p" + k);
  if (modo === "examen") {
    // En el examen solo se marca la elección; se corrige todo al entregar
    elegidasExamen.set(k, valor);
    tarjeta.querySelectorAll(".opcion").forEach((b) => b.classList.toggle("elegida", b.dataset.r === String(valor)));
    alResponder(k);
    if (sesion) actualizarMapa();
    return;
  }
  const r = corregir(p, tarjeta, valor);
  if (!r) return aviso("Responde todas las partes antes de comprobar.");
  preguntaRespondida();
  if (p.tipo !== "abierta") mostrarCorreccion(k, r);
  else if (!r.correcta) tarjeta.querySelector(".explicacion .acciones")?.insertAdjacentHTML("afterbegin", botonGuia(k));
  await db.guardarRespuesta(doc.id, i, r.correcta);
  alResponder(k, r);
}

function verRespuesta(k) {
  const { doc, i } = enPantalla[k];
  const p = doc.cuestionario[i];
  const tarjeta = document.getElementById("p" + k);
  tarjeta.querySelector("[data-accion=ver-respuesta]").remove();
  const caja = tarjeta.querySelector(".explicacion");
  caja.innerHTML = `<p><b>Respuesta:</b> ${esc(p.respuesta).replace(/\n/g, "<br>")}</p>
    ${p.explicacion ? `<p>${esc(p.explicacion)}</p>` : ""}
    ${p.fuente ? `<p class="fuente">📌 Fuente: ${esc(doc.nombre)}, ${esc(p.fuente)}</p>` : ""}
    <p class="sub">¿La sabías?</p>
    <div class="acciones">
      <button class="btn mini" data-accion="autoevaluar" data-i="${k}" data-r="si">✅ La sabía</button>
      <button class="btn mini peligro" data-accion="autoevaluar" data-i="${k}" data-r="no">❌ No la sabía</button>
      <button class="btn mini" data-accion="leer-explicacion" data-i="${k}">🔊 Escuchar</button>
    </div>`;
  caja.hidden = false;
}


// ---------- Una pregunta por pantalla (cuestionario, repaso y examen) ----------
let sesion = null;

function iniciarSesion(examen = false) {
  const tarjetas = [...$app.querySelectorAll(".pregunta")];
  sesion = null;
  if (tarjetas.length < 2) return;
  const barra = document.createElement("div");
  barra.className = "sesion-barra";
  barra.innerHTML = `<span id="ses-pos"></span><span class="barra-progreso"><span class="en-camino" id="ses-avance"></span></span>`;
  tarjetas[0].before(barra);
  const nav = document.createElement("div");
  nav.className = "sesion-nav";
  nav.innerHTML = `<button class="btn secundario" data-accion="ses-ant">${ico("atras")} Anterior</button>
    <button class="btn" data-accion="ses-sig">Siguiente ${ico("chevron")}</button>`;
  tarjetas[tarjetas.length - 1].after(nav);
  if (examen) {
    const mapa = document.createElement("div");
    mapa.className = "sesion-mapa";
    mapa.innerHTML = tarjetas.map((t, i) => `<button data-accion="ses-ir" data-i="${i}" aria-label="Ir a la pregunta ${i + 1}">${i + 1}</button>`).join("");
    nav.after(mapa);
  }
  sesion = { tarjetas, actual: 0, examen };
  mostrarPregunta(0, false);
}

function mostrarPregunta(i, desplazar = true) {
  if (!sesion) return;
  const { tarjetas } = sesion;
  sesion.actual = Math.max(0, Math.min(i, tarjetas.length - 1));
  tarjetas.forEach((t, k) => (t.hidden = k !== sesion.actual));
  document.getElementById("ses-pos").textContent = `Pregunta ${sesion.actual + 1} de ${tarjetas.length}`;
  document.getElementById("ses-avance").style.width = `${((sesion.actual + 1) / tarjetas.length) * 100}%`;
  const ant = $app.querySelector("[data-accion=ses-ant]");
  const sig = $app.querySelector("[data-accion=ses-sig]");
  ant.disabled = sesion.actual === 0;
  sig.hidden = sesion.actual === tarjetas.length - 1;
  sig.classList.remove("listo");
  if (sesion.examen) actualizarMapa();
  if (desplazar) $app.querySelector(".sesion-barra").scrollIntoView({ block: "start", behavior: "smooth" });
}

function actualizarMapa() {
  $app.querySelectorAll("[data-accion=ses-ir]").forEach((b) => {
    const k = Number(b.dataset.i);
    b.classList.toggle("actual", k === sesion.actual);
    b.classList.toggle("respondida", respondidaEnExamen(Number(sesion.tarjetas[k].id.slice(1))));
  });
}

/** Tras responder: resalta "Siguiente" para avanzar. */
function preguntaRespondida() {
  if (!sesion || sesion.examen) return;
  $app.querySelector("[data-accion=ses-sig]")?.classList.add("listo");
}

/** Muestra todas las preguntas (por ejemplo, al revisar un examen entregado). */
function salirSesion() {
  if (!sesion) return;
  sesion.tarjetas.forEach((t) => (t.hidden = false));
  $app.querySelectorAll(".sesion-barra, .sesion-nav, .sesion-mapa").forEach((e) => e.remove());
  sesion = null;
}

// ---------- Cuestionario de un documento ----------
async function htmlCuestionario(doc) {
  modo = "normal";
  enPantalla = doc.cuestionario.map((_, i) => ({ doc, i }));
  const resp = new Map((await db.respuestasDe(doc.id)).map((r) => [r.indice, r]));
  const filtro = vistaDoc.filtro || "todas";
  const visibles = doc.cuestionario
    .map((p, i) => ({ p, i }))
    .filter(({ p, i }) => filtro === "todas" || (filtro === "falladas" ? resp.get(i)?.ultima === false : p.tipo === filtro));
  const tipos = new Set(doc.cuestionario.map((p) => p.tipo));
  const chips = [["todas", "Todas"], ...Object.entries(NOMBRE_TIPO).filter(([k]) => tipos.has(k)), ["falladas", "❗ Las que fallé"]]
    .map(([k, t]) => `<button class="chip ${filtro === k ? "activa" : ""}" data-accion="filtro" data-filtro="${k}">${t}</button>`)
    .join("");
  alResponder = async () => {
    const r = await db.respuestasDe(doc.id);
    document.getElementById("marcador").textContent =
      `Respondidas ${r.length} de ${doc.cuestionario.length} · Correctas ${r.filter((x) => x.ultima).length}`;
  };
  const bien = [...resp.values()].filter((r) => r.ultima).length;
  return `<p class="marcador" id="marcador">Respondidas ${resp.size} de ${doc.cuestionario.length} · Correctas ${bien}</p>
    <div class="chips">${chips}</div>
    ${visibles.map(({ i }) => htmlTarjeta(i, resp.get(i))).join("") ||
      `<p class="vacio">No hay preguntas en este grupo. ${filtro === "falladas" ? "¡Bien hecho! 🎉" : ""}</p>`}
    <button class="btn mini peligro abajo" data-accion="reiniciar">Empezar de cero este cuestionario</button>`;
}

// ---------- Pantalla: repaso del día ----------
async function vistaRepaso() {
  modo = "normal";
  const docs = (await db.listarDocumentos()).filter((d) => d.cuestionario?.length);
  const respuestas = await db.todasLasRespuestas();
  const { lista } = preguntasDelRepaso(docs, respuestas, metaDiaria());
  enPantalla = lista;
  if (!lista.length) {
    return poner(
      "Repaso del día",
      docs.length
        ? `<div class="panel centro"><p class="grande">🎉 ¡Estás al día!</p><p>No te toca repasar nada hoy. Vuelve mañana o haz un <a href="#/examen">📝 examen de práctica</a>.</p></div>`
        : `<p class="vacio">Todavía no tienes cuestionarios. Carga un paquete de Claude para empezar.</p>`,
      "#/"
    );
  }
  let hechas = 0;
  let bien = 0;
  alResponder = async (k, r) => {
    hechas++;
    if (r.correcta) bien++;
    document.getElementById("marcador").textContent = `Repaso de hoy: ${hechas} de ${lista.length} · Correctas ${bien}`;
    if (hechas === lista.length) {
      const { racha } = calcularRacha(await db.listarDiario());
      document.getElementById("fin").innerHTML = `<div class="panel centro">
        <p class="grande">🎉 ¡Repaso terminado!</p>
        <p>Acertaste ${bien} de ${lista.length}. 🔥 Racha: ${racha} día${racha === 1 ? "" : "s"}.</p>
        <p class="nota">Las que fallaste volverán mañana; las que acertaste, dentro de unos días.</p>
        <a class="btn" href="#/">Volver al inicio</a></div>`;
      $app.querySelector("[data-accion=ses-sig]")?.setAttribute("hidden", "");
      document.getElementById("fin").scrollIntoView({ behavior: "smooth" });
    }
  };
  poner(
    "Repaso del día",
    `<p class="marcador" id="marcador">Repaso de hoy: 0 de ${lista.length}</p>
     <p class="nota">Preguntas elegidas para hoy: primero las que te toca repasar y luego algunas nuevas.</p>
     ${lista.map((_, k) => htmlTarjeta(k, null, true)).join("")}
     <div id="fin"></div>`,
    "#/evaluaciones"
  );
  iniciarSesion(false);
}

// ---------- Pantalla: modo examen ----------
async function opcionesDeAmbito() {
  const docs = (await db.listarDocumentos()).filter((d) => d.cuestionario?.length);
  const asigs = await db.listarAsignaturas();
  const opciones = [`<option value="todo">Toda la carrera</option>`];
  for (let a = 1; a <= 6; a++) {
    const delAnio = asigs.filter((x) => x.anio === a && docs.some((d) => d.asignaturas.includes(x.id)));
    if (!delAnio.length) continue;
    opciones.push(`<option value="anio:${a}">${ANIOS[a - 1]} (completo)</option>`);
    delAnio.forEach((x) => opciones.push(`<option value="${esc(x.id)}">&nbsp;&nbsp;${esc(ANIOS[a - 1])} › ${esc(x.nombre)}</option>`));
  }
  return { docs, opciones: opciones.join("") };
}

async function vistaExamenInicio(ambitoInicial) {
  const { docs, opciones } = await opcionesDeAmbito();
  const historial = (await db.listarExamenes()).sort((a, b) => b.fecha - a.fecha).slice(0, 8);
  poner(
    "Modo examen",
    docs.length
      ? `<form class="form-examen">
          <label>¿De qué?<select name="ambito">${opciones}</select></label>
          <label>¿Cuántas preguntas?<select name="n">${[10, 20, 30, 50].map((n) => `<option ${n === 20 ? "selected" : ""}>${n}</option>`).join("")}</select></label>
          <label class="check"><input type="checkbox" name="reloj" checked> Con cronómetro (1 minuto y medio por pregunta)</label>
          <button class="btn ancho">📝 Empezar examen</button>
        </form>
        <p class="nota">Las respuestas se corrigen al entregar. Nota según la escala cubana: 5 Excelente (90 % o más), 4 Bien (80 %), 3 Aprobado (70 %), 2 Desaprobado.</p>
        ${historial.length ? `<h2>Tus últimos exámenes</h2><ul class="docs">${historial
          .map((e) => `<li class="doc"><span><b class="nota-num n${e.nota}">${e.nota}</b> ${esc(e.titulo)}</span>
             <span class="sub">${new Date(e.fecha).toLocaleDateString("es")} · ${e.porcentaje} % · ${e.cantidad} preguntas</span></li>`)
          .join("")}</ul>` : ""}`
      : `<p class="vacio">Todavía no tienes cuestionarios. Carga un paquete de Claude para empezar.</p>`,
    "#/"
  );
  const sel = $app.querySelector("select[name=ambito]");
  if (sel && ambitoInicial) sel.value = ambitoInicial;
}

let relojExamen = null;

async function vistaExamen(ambito, cantidad, conReloj) {
  const docs = (await documentosDelAmbito(ambito)).filter((d) => d.cuestionario?.length);
  const lista = preguntasDeExamen(docs, cantidad);
  if (!lista.length) return poner("Modo examen", `<p class="vacio">No hay preguntas para este examen.</p>`, "#/examen");
  modo = "examen";
  enPantalla = lista;
  elegidasExamen.clear();
  const titulo = `Examen de ${nombreAmbito(ambito)}`;
  alResponder = () => contarExamen();
  poner(
    "Examen",
    `<div class="barra-examen"><span id="contador">Respondidas 0 de ${lista.length}</span><span id="reloj"></span></div>
     <div id="resultado-examen"></div>
     <p class="migas">${esc(titulo)} · ${lista.length} preguntas</p>
     ${lista.map((_, k) => htmlTarjeta(k, null, true)).join("")}
     <button class="btn ancho" data-accion="entregar">📤 Entregar examen</button>`,
    "#/examen"
  );
  $app.classList.add("modo-examen");
  iniciarSesion(true);
  vistaExamen.datos = { titulo, ambito, lista };
  if (conReloj) {
    let segundos = lista.length * 90;
    const pintar = () => {
      const r = document.getElementById("reloj");
      if (r) r.textContent = `⏱ ${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, "0")}`;
    };
    pintar();
    relojExamen = setInterval(() => {
      segundos--;
      pintar();
      if (segundos <= 0) {
        aviso("⏱ Se acabó el tiempo. Corrigiendo…");
        entregarExamen();
      }
    }, 1000);
  }
}

function respondidaEnExamen(k) {
  if (elegidasExamen.has(k)) return true;
  const t = document.getElementById("p" + k);
  return [...t.querySelectorAll("input")].some((x) => (x.type === "text" || !x.type ? x.value.trim() : x.checked)) ||
    [...t.querySelectorAll("select")].some((s) => s.value !== "");
}

function contarExamen() {
  const c = document.getElementById("contador");
  if (c) c.textContent = `Respondidas ${enPantalla.filter((_, k) => respondidaEnExamen(k)).length} de ${enPantalla.length}`;
  if (sesion?.examen) actualizarMapa();
}

async function entregarExamen() {
  if (modo !== "examen") return;
  clearInterval(relojExamen);
  modo = "revision";
  salirSesion();
  $app.classList.remove("modo-examen");
  let puntos = 0;
  const fallados = new Map();
  for (const [k, { doc, i }] of enPantalla.entries()) {
    const p = doc.cuestionario[i];
    const tarjeta = document.getElementById("p" + k);
    tarjeta.querySelectorAll(".elegida").forEach((x) => x.classList.remove("elegida"));
    const inmediata = esInmediata(p);
    let r;
    let sinResponder = false;
    if (inmediata && !elegidasExamen.has(k)) {
      // Sin responder: se muestra cuál era la correcta
      corregir(p, tarjeta, p.tipo === "multiple" ? "-1" : String(!p.respuesta));
      tarjeta.querySelectorAll(".mal").forEach((x) => x.classList.remove("mal"));
      r = { correcta: false, aciertos: 0, total: 1 };
      sinResponder = true;
    } else {
      r = corregir(p, tarjeta, elegidasExamen.get(k));
      if (!r) {
        tarjeta.querySelectorAll("input, select, button").forEach((x) => (x.disabled = true));
        r = { correcta: false, aciertos: 0, total: 1 };
        sinResponder = !respondidaEnExamen(k);
      }
    }
    puntos += r.aciertos / r.total;
    mostrarCorreccion(k, r, sinResponder);
    await db.guardarRespuesta(doc.id, i, r.correcta);
    if (!r.correcta) fallados.set(doc.id, { doc, n: (fallados.get(doc.id)?.n || 0) + 1 });
  }
  const { titulo, ambito, lista } = vistaExamen.datos;
  const porcentaje = Math.round((puntos / lista.length) * 100);
  const n = nota(porcentaje);
  await db.guardarExamen({ fecha: Date.now(), titulo, ambito, cantidad: lista.length, porcentaje, nota: n.nota });
  document.querySelector("[data-accion=entregar]")?.remove();
  document.getElementById("reloj").textContent = `Nota: ${n.nota}`;
  document.getElementById("resultado-examen").innerHTML = `<div class="panel centro">
      <p class="nota-grande n${n.nota}">${n.nota}</p>
      <p class="grande">${n.texto}</p>
      <p>${porcentaje} % de respuestas correctas (${puntos.toFixed(1).replace(".0", "")} de ${lista.length}).</p>
      ${fallados.size ? `<p><b>Temas para repasar:</b></p><ul class="lista-temas">${[...fallados.values()]
        .sort((a, b) => b.n - a.n)
        .map(({ doc, n }) => `<li><a href="#/doc/${doc.id}/resumen">${esc(doc.nombre)}</a> — ${n} fallo${n > 1 ? "s" : ""}</li>`)
        .join("")}</ul>` : "<p>¡Sin fallos! 🎉</p>"}
      <p class="nota">Abajo puedes ver la corrección de cada pregunta.</p>
      <a class="btn" href="#/examen/${encodeURIComponent(ambito)}">Hacer otro examen</a>
    </div>`;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---------- Pantalla: plan para el examen ----------
async function temasConEstado(asigId) {
  const docs = (await db.documentosDeAsignatura(asigId)).filter((d) => d.tipo !== "libro" || d.cuestionario?.length);
  const temas = await Promise.all(
    docs.map(async (doc) => (doc.cuestionario?.length ? { doc, ...(await estadoDe(doc)) } : { doc, estado: "sin-empezar", pct: 0 }))
  );
  const orden = { repasar: 0, "sin-empezar": 1, "en-camino": 2, dominado: 3 };
  return temas.sort((a, b) => orden[a.estado] - orden[b.estado] || a.pct - b.pct ||
    a.doc.nombre.localeCompare(b.doc.nombre, "es", { numeric: true }));
}

function textoDias(n) {
  return n === 0 ? "¡es hoy!" : n === 1 ? "mañana" : n < 0 ? "ya pasó" : `en ${n} días`;
}

async function vistaPlanes() {
  const planes = (await db.listarPlanes()).sort((a, b) => a.fecha.localeCompare(b.fecha));
  const asigs = await db.listarAsignaturas();
  poner(
    "Plan para el examen",
    `${planes.length ? `<ul class="docs">${planes
        .map((p) => `<li class="doc"><a class="doc-nombre" href="#/plan/${p.id}">📅 ${esc(p.nombre)} — ${esc(nombreAsig(p.asignatura))}</a>
          <span class="sub">${new Date(p.fecha + "T00:00:00").toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" })} · ${textoDias(diasHasta(p.fecha))}</span>
          <span class="acciones"><button class="btn mini peligro" data-accion="borrar-plan" data-id="${p.id}">Borrar</button></span></li>`)
        .join("")}</ul>` : `<p class="vacio">Todavía no has puesto ninguna fecha de examen.</p>`}
     ${asigs.length ? `<h2>Añadir un examen</h2>
     <form class="form-plan">
       <label>Asignatura<select name="asignatura">${asigs.map((a) => `<option value="${esc(a.id)}">${esc(nombreAsig(a.id))}</option>`).join("")}</select></label>
       <label>¿Qué examen?<input name="nombre" value="Prueba final" required maxlength="60"></label>
       <label>Fecha<input name="fecha" type="date" required min="${db.hoy()}"></label>
       <button class="btn ancho">📅 Crear plan de estudio</button>
     </form>` : `<p class="nota">Primero añade tus asignaturas.</p>`}`,
    "#/"
  );
}

async function vistaPlan(id) {
  const plan = (await db.listarPlanes()).find((p) => p.id === id);
  if (!plan) return (location.hash = "#/planes");
  const temas = await temasConEstado(plan.asignatura);
  const dias = repartirPlan(plan.fecha, temas);
  const faltan = diasHasta(plan.fecha);
  const hoyStr = db.hoy();
  poner(
    plan.nombre,
    `<div class="panel centro"><p class="grande">📅 ${esc(plan.nombre)}</p>
       <p>${esc(nombreAsig(plan.asignatura))}</p>
       <p class="cuenta">${faltan > 0 ? `Faltan <b>${faltan}</b> día${faltan === 1 ? "" : "s"}` : textoDias(faltan)}</p></div>
     ${temas.length ? "" : `<p class="vacio">Esta asignatura todavía no tiene conferencias.</p>`}
     ${dias.map((d) => `<section class="dia ${d.fecha === hoyStr ? "hoy" : d.fecha < hoyStr ? "pasado" : ""}">
        <p class="sub">${d.fecha === hoyStr ? "👉 HOY · " : ""}${new Date(d.fecha + "T00:00:00").toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" })}</p>
        ${d.repasoGeneral
          ? `<p>🔁 Repaso general: <a href="#/examen/${encodeURIComponent(plan.asignatura)}">haz un examen de práctica</a> y repasa los temas en 🔴.</p>`
          : `<ul class="lista-temas">${d.temas.map((t) => `<li><a href="#/doc/${t.doc.id}">${esc(t.doc.nombre)}</a> <span class="sub">${ESTADOS[t.estado]}</span></li>`).join("")}</ul>`}
      </section>`).join("")}
     <p class="nota">El plan pone primero los temas más flojos y se actualiza según tus resultados en los cuestionarios.</p>`,
    "#/planes"
  );
}

/** Lo que toca hoy según el examen más cercano (para la pantalla de inicio). */
async function planDeHoy() {
  const planes = (await db.listarPlanes()).filter((p) => diasHasta(p.fecha) >= 0).sort((a, b) => a.fecha.localeCompare(b.fecha));
  if (!planes.length) return "";
  const plan = planes[0];
  const dias = repartirPlan(plan.fecha, await temasConEstado(plan.asignatura));
  const deHoy = dias.find((d) => d.fecha === db.hoy());
  const que = deHoy?.repasoGeneral ? "repaso general" : deHoy?.temas.map((t) => t.doc.nombre).join(", ");
  return `<a class="plan-hoy" href="#/plan/${plan.id}">📅 <b>${esc(plan.nombre)}</b> de ${esc(plan.asignatura.split("|")[1])}: ${textoDias(diasHasta(plan.fecha))}
    ${que ? `<br><span class="sub">Hoy toca: ${esc(que)}</span>` : ""}</a>`;
}

// ---------- Pantalla: copia de seguridad y compartir ----------
async function compartirArchivo(nombre, contenido, tipo) {
  // contenido puede ser texto (JSON) o un Blob (paquete .zip con diapositivas)
  const tamano = typeof contenido === "string" ? contenido.length : contenido.size;
  // En el APK de Android: el teléfono pregunta si guardar o enviar (Zapya, WhatsApp, Claude…)
  if (window.FinlayAndroid) {
    if (typeof contenido === "string") {
      window.FinlayAndroid.guardar(nombre, contenido, tipo);
    } else {
      // Los archivos binarios pasan al teléfono por trozos en base64
      const bytes = new Uint8Array(await contenido.arrayBuffer());
      const TROZO = 384 * 1024;
      window.FinlayAndroid.iniciarArchivo();
      for (let i = 0; i < bytes.length; i += TROZO) {
        const parte = bytes.subarray(i, i + TROZO);
        let bin = "";
        for (let j = 0; j < parte.length; j += 8192) bin += String.fromCharCode.apply(null, parte.subarray(j, j + 8192));
        window.FinlayAndroid.agregarTrozo(btoa(bin));
      }
      window.FinlayAndroid.terminarArchivo(nombre, tipo);
    }
    return;
  }
  const archivo = new File([contenido], nombre, { type: tipo });
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
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  aviso(`Guardado en Descargas: ${nombre} (${Math.ceil(tamano / 1024)} KB)`);
}

async function vistaCopia() {
  const { opciones } = await opcionesDeAmbito();
  const docs = await db.listarDocumentos();
  poner(
    "Copia y compartir",
    `<section class="panel">
       <p class="grande">💾 Copia de seguridad</p>
       <p>Guarda <b>todo</b> (materiales, diapositivas, cuestionarios y tu progreso) en un solo archivo. Sirve para no perder nada o para pasarlo a otro teléfono.</p>
       <button class="btn ancho" data-accion="copia-completa" ${docs.length ? "" : "disabled"}>💾 Guardar copia completa</button>
     </section>
     <section class="panel">
       <p class="grande">📲 Compartir con un compañero</p>
       <p>Crea un archivo con los materiales, diapositivas y cuestionarios (sin tu progreso). Pásalo por <b>Zapya, Bluetooth o WhatsApp</b>: no gasta datos si usas Zapya o Bluetooth. Tu compañero lo carga en su Finlay con 📥.</p>
       <select id="ambito-compartir">${opciones.replace('<option value="todo">Toda la carrera</option>', "")}</select>
       <button class="btn ancho" data-accion="compartir" ${docs.length ? "" : "disabled"}>📤 Compartir</button>
       <p class="nota">Solo se comparten las asignaturas que tienen cuestionarios.</p>
     </section>
     <section class="panel">
       <p class="grande">📥 Cargar una copia o un paquete</p>
       <button class="btn ancho" data-accion="paquete">📥 Elegir archivo</button>
     </section>`,
    "#/"
  );
}

async function exportarPaquete(ambito, conProgreso) {
  mostrarProgreso("Preparando el archivo…");
  try {
    const docs = await documentosDelAmbito(ambito);
    const fragmentosPorDoc = new Map();
    for (const d of docs) fragmentosPorDoc.set(d.id, await db.fragmentosDe(d.id));
    const asignaturas = (await db.listarAsignaturas()).filter((a) =>
      ambito === "todo" || (ambito.startsWith("anio:") ? a.anio === Number(ambito.slice(5)) : a.id === ambito));
    const imagenes = {};
    for (const d of docs)
      for (const x of [...(d.cuestionario || []), ...(d.resumen || [])])
        if (x.imagen && !imagenes[x.imagen]) {
          const datos = await db.obtenerImagen(x.imagen);
          if (datos) imagenes[x.imagen] = datos;
        }
    const paquete = crearPaquete({
      imagenes,
      asignaturas,
      titulo: conProgreso ? "Copia de seguridad de Finlay" : `Finlay: ${nombreAmbito(ambito)}`,
      docs,
      fragmentosPorDoc,
      respuestas: conProgreso ? await db.todasLasRespuestas() : null,
      diario: conProgreso ? await db.listarDiario() : null,
    });
    const base = conProgreso
      ? `finlay-copia-${db.hoy()}`
      : `finlay-${normalizar(nombreAmbito(ambito)).trim().replace(/\s+/g, "-")}`;
    if (!docs.some((d) => d.diapositivas || d.pdf)) {
      mostrarProgreso(null);
      await compartirArchivo(base + ".json", JSON.stringify(paquete), "application/json");
      return;
    }
    // Con diapositivas o PDF: un .zip con paquete.json + las imágenes y PDF originales
    const JSZip = await cargarJSZip();
    const zip = new JSZip();
    for (let k = 0; k < docs.length; k++) {
      const d = docs[k];
      const m = paquete.materiales[k];
      if (d.diapositivas) {
        const carpeta = `diapositivas/${String(k + 1).padStart(3, "0")}`;
        let total = 0;
        for (let n = 1; n <= d.diapositivas; n++) {
          if (n % 10 === 1) mostrarProgreso(`Preparando diapositivas de ${d.nombre}\n${n} de ${d.diapositivas}`);
          const blob = await db.obtenerDiapositiva(d.id, n);
          if (!blob) continue;
          zip.file(`${carpeta}/${String(n).padStart(3, "0")}.webp`, blob);
          total = n;
        }
        if (total) m.diapositivas = { carpeta, total };
      }
      if (d.pdf) {
        const blob = await db.obtenerArchivo(d.id);
        if (blob) {
          m.pdf = `archivos/${String(k + 1).padStart(3, "0")}.pdf`;
          zip.file(m.pdf, blob);
        }
      }
    }
    zip.file("paquete.json", JSON.stringify(paquete), { compression: "DEFLATE" });
    mostrarProgreso("Juntando todo en un archivo…");
    const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
    mostrarProgreso(null);
    await compartirArchivo(base + ".zip", blob, "application/zip");
  } catch (e) {
    mostrarProgreso(null);
    alert("No se pudo crear el archivo: " + e.message);
  }
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
            (d) => `<li class="doc"><a class="doc-nombre" href="#/doc/${d.id}">${icono(d)} ${esc(d.nombre)}</a>
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
      <li><b>Inicio:</b> tu racha 🔥, la meta del día, el botón <b>Repasar hoy</b>, tu próximo examen y tus asignaturas con su progreso.</li>
      <li><b>Temas:</b> elige el año y la asignatura. Cada tema tiene <b>Resumen</b>, <b>Cuestionario</b> y la conferencia <b>Completa</b>. Aquí está también el buscador.</li>
      <li><b>Cuestionarios:</b> una pregunta por pantalla. Responde y toca <b>Siguiente</b>. Si fallas, <b>📖 Ver dónde está</b> te lleva a la parte exacta de la conferencia, marcada en verde.</li>
      <li><b>Progreso:</b> tus días seguidos, lo que respondiste esta semana, cuánto dominas cada asignatura y tus insignias.</li>
      <li><b>Evaluaciones:</b> el <b>repaso del día</b> (lo que fallas vuelve pronto), el <b>examen de práctica</b> con nota de 2 a 5 y el <b>plan para el examen</b>.</li>
      <li><b>Perfil:</b> tu nombre, apariencia (clara u oscura), tamaño de letra, meta diaria, voz y la <b>copia de seguridad</b>.</li>
      <li><b>Menú ☰</b> (arriba a la derecha): buscar, todos los materiales, cargar paquete y más.</li>
      <li>Para cargar tus propios archivos, entra en una asignatura y toca <b>＋ Cargar</b>. Finlay lee el texto dentro del teléfono, sin subir nada.</li>
      <li>Si la voz no suena en español, instala la voz española en Ajustes del teléfono → Idioma → Texto a voz.</li>
    </ol>
    <p class="nota">Meta diaria de preguntas:
      <select id="meta">${[5, 10, 15, 20, 30, 50].map((v) => `<option value="${v}" ${v === metaDiaria() ? "selected" : ""}>${v}</option>`).join("")}</select></p>
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
      const esPdf = tipoDeArchivo(archivo.name) === "pdf";
      if (!conTexto.length && !esPdf) throw new Error("No tiene texto que se pueda leer.");

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
        primera: conTexto[0]?.n ?? 1,
        pdf: esPdf,
        etiqueta: paginas[0].etiqueta,
        sinTexto: paginas.length - conTexto.length,
        fecha: Date.now(),
      };
      await db.guardarDocumento(doc, fragmentos);
      if (esPdf) await db.guardarArchivo(doc.id, archivo);
      existentes.push(doc);
      cargados++;
      if (!conTexto.length) {
        errores.push(`${archivo.name}: es un PDF escaneado (fotos de páginas). Puedes verlo, pero el buscador y los cuestionarios no funcionan con él.`);
      } else if (doc.sinTexto > paginas.length * 0.3) {
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
  // En Android se puede compartir directo a la app de Claude, WhatsApp, etc.
  await compartirArchivo(nombre, texto, "text/plain");
}

// ---------- Eventos ----------
document.addEventListener("submit", async (ev) => {
  const f = ev.target;
  ev.preventDefault();
  if (f.classList.contains("buscador")) {
    const q = f.q.value.trim();
    if (q) location.hash = `#/buscar/${encodeURIComponent(f.dataset.ambito)}?q=${encodeURIComponent(q)}`;
  } else if (f.dataset.form === "nombre") {
    guardarPref("nombre", f.querySelector("input").value.trim());
    router();
  } else if (f.classList.contains("form-examen")) {
    location.hash = `#/examen-hacer/${encodeURIComponent(f.ambito.value)}?n=${f.n.value}&reloj=${f.reloj.checked ? 1 : 0}`;
  } else if (f.classList.contains("form-plan")) {
    const id = await db.guardarPlan({ asignatura: f.asignatura.value, nombre: f.nombre.value.trim(), fecha: f.fecha.value });
    location.hash = `#/plan/${id}`;
  } else if (f.classList.contains("nueva-asig")) {
    const nombre = f.nombre.value.trim().replace(/\|/g, "-");
    if (!nombre) return;
    const asig = await db.crearAsignatura(Number(f.dataset.anio), nombre, leerSemestre(f.semestre.value));
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
  } else if (accion === "responder" || accion === "autoevaluar" || accion === "comprobar") {
    responder(Number(b.dataset.i), b.dataset.r);
  } else if (accion === "ver-respuesta") {
    verRespuesta(Number(b.dataset.i));
  } else if (accion === "leer-resumen") {
    const d = vistaDoc.doc;
    voz.leer(`Resumen de ${d.nombre}. ` + d.resumen.map((s) => `${s.titulo || ""}. ${s.texto}`).join(" "), velocidadVoz());
  } else if (accion === "leer-explicacion") {
    const { doc: d, i: idx } = enPantalla[Number(b.dataset.i)];
    const p = d.cuestionario[idx];
    const enunciado = p.tipo === "completar" ? p.pregunta.replace(/_{3,}/g, ", espacio en blanco, ") : p.pregunta;
    const extra = p.tipo === "vf" && p.afirmaciones ? p.afirmaciones.map((a) => a.texto).join(". ") + ". " : "";
    voz.leer(`${enunciado}. ${extra}${textoRespuesta(p)} ${p.explicacion || ""}`, velocidadVoz());
  } else if (accion === "volver") {
    const d = b.dataset.destino;
    if (d === "historial") history.back();
    else if (d) location.hash = d;
  } else if (accion === "leer-diapo") {
    const d = vistaDoc.doc;
    const t = await db.textoDePagina(d.id, Number(b.dataset.n));
    if (t.trim()) voz.leer(t, velocidadVoz());
    else aviso("Esta diapositiva no tiene texto para leer.");
  } else if (accion === "ses-sig") {
    mostrarPregunta(sesion.actual + 1);
  } else if (accion === "ses-ant") {
    mostrarPregunta(sesion.actual - 1);
  } else if (accion === "ses-ir") {
    mostrarPregunta(Number(b.dataset.i));
  } else if (accion === "menu") {
    abrirMenu();
  } else if (accion === "tema") {
    cambiarTema(b.dataset.tema);
  } else if (accion === "cerrar-menu") {
    if (ev.target === b) cerrarMenu();
  } else if (accion === "ampliar") {
    if (b.src) ampliar(b.src);
  } else if (accion === "cerrar-lupa") {
    cerrarLupa();
  } else if (accion === "guia") {
    abrirVisor(Number(b.dataset.i));
  } else if (accion === "cerrar-visor") {
    cerrarVisor();
  } else if (accion === "visor-pag") {
    visorEstado.actual = Number(b.dataset.p);
    pintarVisor();
  } else if (accion === "visor-leer") {
    const { lugar } = visorEstado;
    voz.leer(lugar.texto.slice(lugar.rango[0], lugar.rango[1]), velocidadVoz());
  } else if (accion === "entregar") {
    const sinResponder = enPantalla.filter((_, k) => !respondidaEnExamen(k)).length;
    if (!sinResponder || confirm(`Te quedan ${sinResponder} preguntas sin responder. ¿Entregar de todas formas?`)) entregarExamen();
  } else if (accion === "borrar-plan") {
    if (confirm("¿Borrar este plan de examen?")) {
      await db.borrarPlan(Number(id));
      router();
    }
  } else if (accion === "copia-completa") {
    exportarPaquete("todo", true);
  } else if (accion === "compartir") {
    exportarPaquete(document.getElementById("ambito-compartir").value, false);
  } else if (accion === "escuchar-asig") {
    const docs = (await db.documentosDeAsignatura(asig))
      .filter((d) => d.resumen?.length)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { numeric: true }));
    voz.leer(docs.map((d) => `${d.nombre}. ` + d.resumen.map((s) => `${s.titulo || ""}. ${s.texto}`).join(" ")).join(" . Siguiente tema. "), velocidadVoz());
    aviso("🎧 Escuchando los resúmenes. Mantén la pantalla encendida.");
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
      (r.asignaturas ? `• Asignaturas: ${r.asignaturas}\n` : "") +
      (r.quitadas ? `• Asignaturas quitadas: ${r.quitadas.join(", ")}\n` : "") +
      (r.imagenes ? `• Imágenes: ${r.imagenes}\n` : "") +
      `• Materiales nuevos: ${r.nuevos}\n• Materiales actualizados: ${r.actualizados}\n` +
      (r.diapositivas ? `• Diapositivas: ${r.diapositivas}\n` : "") + `• Preguntas: ${r.preguntas}`
    );
    const anios = [...new Set([...datos.materiales, ...(datos.asignaturas || [])].map((m) => Number(m.anio)))];
    location.hash = anios.length === 1 ? `#/anio/${anios[0]}` : "#/";
    router();
  } catch (e) {
    mostrarProgreso(null);
    console.error(e);
    alert("No se pudo cargar el paquete:\n" + (e?.name === "QuotaExceededError" ? "No queda espacio en el teléfono." : e.message));
  }
});

document.addEventListener("input", () => modo === "examen" && contarExamen());
document.addEventListener("change", (ev) => {
  if (modo === "examen") contarExamen();
  if (ev.target.id === "aj-nombre") {
    guardarPref("nombre", ev.target.value.trim());
    aviso("Nombre guardado");
  }
  if (ev.target.id === "aj-tema") cambiarTema(ev.target.value);
  if (ev.target.id === "aj-escala") {
    guardarPref("escala", ev.target.value === "1" ? "" : ev.target.value);
    document.documentElement.style.setProperty("--escala", ev.target.value);
  }
  if (ev.target.id === "semestre-asig") {
    const id = decodeURIComponent(location.hash.split("/")[2]);
    db.cambiarSemestre(id, leerSemestre(ev.target.value)).then(() => aviso("Semestre guardado"));
  }
  if (ev.target.id === "meta") {
    guardarMeta(Number(ev.target.value));
    aviso("Meta diaria guardada");
  }
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
  if (!$visor.hidden) cerrarVisor(true);
  voz.detener();
  clearInterval(relojExamen);
  $app.classList.remove("modo-examen");
  modo = "normal";
  const [ruta, consulta = ""] = location.hash.slice(1).split("?");
  const partes = ruta.split("/").filter(Boolean).map(decodeURIComponent);
  const q = new URLSearchParams(consulta).get("q") || "";
  cerrarMenu();
  sesion = null;
  liberarDiapositivas();
  pintarNav(partes[0] || "");
  try {
    if (partes[0] === "temas") await vistaTemas();
    else if (partes[0] === "progreso") await vistaProgresoGeneral();
    else if (partes[0] === "evaluaciones") await vistaEvaluaciones();
    else if (partes[0] === "perfil") await vistaPerfil();
    else if (partes[0] === "anio") await vistaAnio(Number(partes[1]));
    else if (partes[0] === "asig") await vistaAsignatura(partes[1], partes[2]);
    else if (partes[0] === "buscar") await vistaBuscar(partes[1], q);
    else if (partes[0] === "leer") await vistaLeer(partes[1], Number(partes[2]), q);
    else if (partes[0] === "doc") {
      if (vistaDoc.docId !== partes[1]) vistaDoc.filtro = "todas";
      vistaDoc.docId = partes[1];
      await vistaDoc(partes[1], partes[2], Number(new URLSearchParams(consulta).get("p")) || 0);
    }
    else if (partes[0] === "biblioteca") await vistaBiblioteca();
    else if (partes[0] === "repaso") await vistaRepaso();
    else if (partes[0] === "examen") await vistaExamenInicio(partes[1]);
    else if (partes[0] === "examen-hacer") {
      const ps = new URLSearchParams(consulta);
      await vistaExamen(partes[1], Number(ps.get("n")) || 20, ps.get("reloj") === "1");
    }
    else if (partes[0] === "planes") await vistaPlanes();
    else if (partes[0] === "plan") await vistaPlan(Number(partes[1]));
    else if (partes[0] === "copia") await vistaCopia();
    else if (partes[0] === "ayuda") vistaAyuda();
    else await vistaInicio();
  } catch (e) {
    console.error(e);
    poner("Error", `<p class="vacio">Algo salió mal: ${esc(e.message)}</p><a class="btn" href="#/">Volver al inicio</a>`);
  }
}

window.addEventListener("hashchange", router);
router().then(cargarPaquetesIncluidos);

// En el APK pueden venir paquetes dentro de la app: se cargan solos la primera vez
async function cargarPaquetesIncluidos() {
  if (!window.FinlayAndroid) return; // solo el APK trae paquetes dentro
  let lista;
  try {
    const r = await fetch("paquetes/lista.json", { cache: "no-store" });
    if (!r.ok) return;
    lista = await r.json();
  } catch {
    return;
  }
  let hechos = {};
  try { hechos = JSON.parse(localStorage.getItem("finlay.incluidos") || "{}"); } catch {}
  const pendientes = lista.filter((p) => hechos[p.archivo] !== p.version);
  if (!pendientes.length) return;
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  try {
    for (const [i, p] of pendientes.entries()) {
      mostrarProgreso(`Preparando las diapositivas (${i + 1} de ${pendientes.length})…\nSolo pasa una vez.`);
      const blob = await (await fetch("paquetes/" + p.archivo)).blob();
      const datos = await leerPaquete(blob);
      await importarPaquete(datos, (t) => t && mostrarProgreso(`(${i + 1} de ${pendientes.length})\n${t}`));
      hechos[p.archivo] = p.version;
      try { localStorage.setItem("finlay.incluidos", JSON.stringify(hechos)); } catch {}
    }
    mostrarProgreso(null);
    aviso("✅ Diapositivas listas");
  } catch (e) {
    mostrarProgreso(null);
    console.error(e);
    alert("No se pudieron preparar las diapositivas:\n" + (e?.name === "QuotaExceededError" ? "No queda espacio en el teléfono." : e.message));
  }
  router();
}

if ("serviceWorker" in navigator && !window.FinlayAndroid) {
  navigator.serviceWorker.register("./sw.js").catch((e) => console.warn("Sin modo sin conexión:", e));
}
