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
import { activarZoom } from "./zoom.js";
import { pref, guardarPref, htmlMiniatura, imagenAsignatura, descripcionAsignatura, htmlAnillo, htmlAnilloPct, htmlSemana, insignias, favoritos, esFavorito, alternarFavorito, textoPuntos } from "./inicio.js";
import * as juego from "./logros.js";
import * as tiempo from "./tiempo.js";
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
    $cabecera.innerHTML = `<a href="#/perfil" class="marca-foto">${htmlAvatar("marca-retrato")}</a>
      <div class="marca-texto"><span class="marca-nombre">Finlay</span><span class="marca-sub">Estudio Médico</span>
        <span class="marca-estado"><i></i>Funciona sin internet</span></div>
      <a class="btn-icono" href="#/ajustes" aria-label="Configuración">${ico("ajustes")}</a>`;
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
const zoomLupa = activarZoom($lupa.querySelector(".lupa-caja"), $lupa.querySelector("img"));
function ampliar(src) {
  $lupa.querySelector("img").src = src;
  $lupa.hidden = false;
  zoomLupa.reiniciar();
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

/** Foto del estudiante (si la puso) o el retrato de Finlay */
function htmlAvatar(clase, conInicial = false) {
  const foto = pref("foto");
  if (foto) return `<img class="${clase}" src="${foto}" alt="Tu foto">`;
  const n = pref("nombre").trim();
  if (conInicial && n) return `<span class="${clase} avatar-inicial">${esc(n[0].toUpperCase())}</span>`;
  return `<img class="${clase}" src="iconos/retrato-finlay.webp" alt="Carlos J. Finlay">`;
}

/**
 * Tiempo de estudio: TODAS las pantallas usan esto (la misma tabla de sesiones y la misma función),
 * más los tramos estimados para los días que tienen preguntas pero no tiempo guardado.
 */
async function datosDeTiempo() {
  const diario = await db.listarDiario();
  const respuestas = await db.todasLasRespuestas();
  const horas = [...tiempo.marcasDeRespuestas(), ...respuestas.map((r) => r.fecha).filter(Boolean)];
  const reales = tiempo.sesiones();
  const tramos = [...reales, ...tiempo.estimarFaltantes(reales, diario, horas)];
  return { tramos, diario, respuestas, analizar: (op) => tiempo.analizar(tramos, op) };
}
const minutos = (seg) => Math.round(seg / 60);

/** Datos que necesitan los logros y trofeos */
async function contextoLogros() {
  const docs = (await db.listarDocumentos()).filter((d) => d.cuestionario?.length);
  const respuestas = await db.todasLasRespuestas();
  const porDoc = new Map();
  for (const r of respuestas) porDoc.set(r.docId, (porDoc.get(r.docId) || 0) + 1);
  const completo = (d) => (porDoc.get(d.id) || 0) >= d.cuestionario.length;
  const diario = await db.listarDiario();
  const { racha } = calcularRacha(diario);
  const asigs = await db.listarAsignaturas();
  let completas = 0;
  let mejor = null;
  const anios = ANIOS.map(() => ({ total: 0, completas: 0 }));
  for (const a of asigs) {
    const suyos = docs.filter((d) => d.asignaturas.includes(a.id));
    const hechos = suyos.filter(completo).length;
    const lista = suyos.length > 0 && hechos === suyos.length;
    if (lista) completas++;
    else if (suyos.length && (!mejor || suyos.length - hechos < mejor.n)) mejor = { n: suyos.length - hechos, a };
    if (anios[a.anio - 1]) {
      anios[a.anio - 1].total++;
      if (lista) anios[a.anio - 1].completas++;
    }
  }
  const e = juego.estado();
  return {
    pruebas: e.pruebas, perfectas: e.perfectas, leidas: e.leidas.length, noche: e.noche, madrugada: e.madrugada, examen5: e.examen5,
    racha, correctas: diario.reduce((s, d) => s + d.correctas, 0), anios,
    asig: { completas, mejor: mejor ? `Te faltan ${mejor.n} cuestionario${mejor.n > 1 ? "s" : ""} en ${mejor.a.nombre}` : "" },
  };
}
async function revisarLogros(avisar = true) {
  try { return juego.revisar(await contextoLogros(), avisar); } catch (e) { console.error(e); return []; }
}
/** Al terminar una prueba completa: bonos, logros y pantalla de celebración */
async function terminarPrueba({ titulo, acertadas, total, pct, nota: n, puntosInicio, otraVez }) {
  juego.pruebaTerminada(acertadas, total);
  const nuevos = await revisarLogros(false);
  juego.celebrar({ titulo, acertadas, total, pct, nota: n, puntosGanados: juego.estado().puntos - puntosInicio, nuevos, otraVez });
  celebrado = true;
}
let celebrado = false;

/** Datos del progreso de todo lo estudiado (se usan en Inicio, Progreso y Perfil) */
async function resumenDeEstudio() {
  const docs = await db.listarDocumentos();
  const conPreguntas = docs.filter((d) => d.cuestionario?.length);
  const respuestas = await db.todasLasRespuestas();
  const ids = new Set(conPreguntas.map((d) => d.id));
  const totalPreguntas = conPreguntas.reduce((s, d) => s + d.cuestionario.length, 0);
  const dominadas = respuestas.filter((r) => r.ultima && ids.has(r.docId)).length;
  const diario = await db.listarDiario();
  const { racha, hoy } = calcularRacha(diario);
  const examenes = await db.listarExamenes();
  let temasDominados = 0;
  for (const d of conPreguntas) if ((await estadoDe(d)).estado === "dominado") temasDominados++;
  const correctas = diario.reduce((s, d) => s + d.correctas, 0);
  const respondidas = diario.reduce((s, d) => s + d.preguntas, 0);
  return {
    docs, conPreguntas, respuestas, diario, racha, hoy, examenes, temasDominados, correctas, respondidas,
    pct: totalPreguntas ? Math.round((dominadas / totalPreguntas) * 100) : 0,
    nivel: juego.nivelDe(juego.estado().puntos),
    puntos: juego.estado().puntos,
  };
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
  const r = await resumenDeEstudio();
  const meta = metaDiaria();
  const { lista } = preguntasDelRepaso(r.conPreguntas, r.respuestas, meta);

  const pctMeta = Math.min(100, Math.round((r.hoy.preguntas / meta) * 100));
  const t = await datosDeTiempo();
  const segHoy = t.analizar({ desde: tiempo.inicioDelDia(db.hoy()) }).total;
  const segTotal = t.analizar().total;
  const verPg = pref("verProgreso", "hoy");
  // "Continuar estudiando": la última conferencia abierta, o el repaso, o los temas
  const docUltimo = pref("ultimo") && docs.find((d) => d.id === pref("ultimo"));
  const continuar = docUltimo ? `#/doc/${docUltimo.id}` : lista.length ? "#/repaso" : "#/temas";

  // Hoy en tu plan
  const plan = [];
  if (lista.length) {
    const docRep = lista[0].doc || docs.find((d) => d.id === lista[0].docId);
    const [anio, nombreA] = (docRep?.asignaturas[0] || "|").split("|");
    plan.push(`<a class="tarjeta plan-tarjeta" href="#/repaso">${htmlMiniatura(nombreA || "", anio)}
      <span class="asig-cuerpo"><span class="asig-nombre">Repaso del día</span>
      <span class="sub">${lista.length} preguntas · unos ${Math.max(1, Math.round(lista.length * 0.6))} min</span></span>
      <span class="flecha-circulo">${ico("chevron")}</span></a>`);
  }
  const planes = (await db.listarPlanes()).filter((p) => diasHasta(p.fecha) >= 0).sort((a, b) => a.fecha.localeCompare(b.fecha));
  if (planes.length) {
    const p = planes[0];
    const dias = repartirPlan(p.fecha, await temasConEstado(p.asignatura));
    const deHoyPlan = dias.find((d) => d.fecha === db.hoy());
    const que = deHoyPlan?.repasoGeneral ? "Repaso general" : deHoyPlan?.temas.map((t) => t.doc.nombre.split(" - ")[0]).join(" · ");
    const [anioP, nombreP] = p.asignatura.split("|");
    plan.push(`<a class="tarjeta plan-tarjeta" href="#/plan/${p.id}">${htmlMiniatura(nombreP, anioP)}
      <span class="asig-cuerpo"><span class="asig-nombre">${esc(p.nombre)} · <b class="texto-naranja">${textoDias(diasHasta(p.fecha))}</b></span>
      <span class="sub">${que ? "Hoy: " + esc(que) : esc(nombreP)}</span></span>
      <span class="flecha-circulo">${ico("chevron")}</span></a>`);
  }
  plan.push(`<a class="tarjeta plan-tarjeta" href="${lista.length ? "#/repaso" : "#/examen"}">
      <span class="icono-caja">${ico("trofeo")}</span>
      <span class="asig-cuerpo"><span class="asig-nombre">Meta de hoy: ${r.hoy.preguntas} de ${meta} preguntas</span>
      <span class="barra-progreso"><span class="en-camino" style="width:${pctMeta}%"></span></span></span>
      <span class="flecha-circulo">${ico("chevron")}</span></a>`);

  const asigs = (await db.listarAsignaturas()).filter((a) => docs.some((d) => d.asignaturas.includes(a.id)));
  const tarjetas = [];
  for (const a of asigs) tarjetas.push(htmlTarjetaAsignatura(a, await progresoAsignatura(a)));

  const pedirNombre = nombre ? "" : `<form class="tarjeta pedir-nombre" data-form="nombre">
      <label for="aj-nombre">¿Cómo te llamas? Así te saludo al entrar.</label>
      <div class="buscador"><input id="aj-nombre" maxlength="30" placeholder="Tu nombre" autocomplete="given-name" required>
      <button class="btn">Guardar</button></div></form>`;
  poner(null, `
    ${pedirNombre}
    <section class="saludo2">
      <div><h2 class="hola">Hola${nombre ? ", " + esc(nombre) : ""} <span class="mano">👋</span></h2>
      <p class="animo">${r.hoy.preguntas >= meta ? "¡Meta de hoy cumplida! 🎉" : "Sigue avanzando hacia tu meta"}</p></div>
      <a class="racha-fuego ${r.racha ? "" : "apagado"}" href="#/progreso/logros" style="--tam:${(1 + Math.min(r.racha, 30) / 30).toFixed(2)}"
        title="${r.racha} días seguidos"><span class="fuego">🔥</span><b>${r.racha}</b><span>día${r.racha === 1 ? "" : "s"}</span></a>
    </section>
    <section class="tarjeta progreso-general">
      <div class="pg-cabeza"><span class="pg-titulo">Tu progreso</span>
        <span class="pg-pestanas" role="tablist">
          <button role="tab" data-accion="pg-ver" data-ver="hoy" class="${verPg === "hoy" ? "activa" : ""}">Hoy</button>
          <button role="tab" data-accion="pg-ver" data-ver="total" class="${verPg === "total" ? "activa" : ""}">Todo el tiempo</button>
        </span></div>
      <a class="pg-fila" data-panel="hoy" href="#/progreso" ${verPg === "hoy" ? "" : "hidden"}>${htmlAnilloPct(pctMeta, "meta de hoy")}
        <span class="pg-datos">
          <span>${ico("reloj")}<b>${tiempo.textoMinutos(minutos(segHoy))}</b><span>Estudio hoy</span></span>
          <span>${ico("check")}<b>${r.hoy.preguntas}</b><span>Preguntas hoy · ${r.hoy.correctas} bien</span></span>
          <span class="pg-racha">${ico("llama")}<b>${r.racha}</b><span>Días racha</span></span>
        </span></a>
      <a class="pg-fila" data-panel="total" href="#/progreso" ${verPg === "total" ? "" : "hidden"}>${htmlAnilloPct(r.pct, "dominado")}
        <span class="pg-datos">
          <span>${ico("reloj")}<b>${tiempo.textoMinutos(minutos(segTotal))}</b><span>Tiempo en la app</span></span>
          <span>${ico("estudiar")}<b>${docs.length}</b><span>Temas · ${r.respondidas} respuestas</span></span>
          <span>${ico("examen")}<b>${r.examenes.length}</b><span>Evaluaciones</span></span>
        </span></a>
      <p class="pg-nota sub">${verPg === "hoy" ? "Se reinicia cada día a las 12 de la noche." : "Todo lo que has estudiado desde que usas Finlay."}</p>
    </section>
    <a class="btn btn-grande" href="${continuar}"><span>Continuar estudiando
      ${docUltimo ? `<small>${esc(docUltimo.nombre)}</small>` : ""}</span>${ico("chevron")}</a>
    <div class="titulo-seccion"><h2>Hoy en tu plan</h2><a href="#/evaluaciones">Ver todo ${ico("chevron")}</a></div>
    ${plan.join("")}
    <div class="titulo-seccion"><h2>Tus asignaturas</h2><a href="#/temas">Ver todas ${ico("chevron")}</a></div>
    <div class="lista-asig">${tarjetas.join("")}</div>
  `);
}

// ---------- Pantalla: Temas (años, buscador y materiales) ----------
// Ícono y color de cada año (como en el diseño)
const ESTILO_ANIO = [["birrete", "#12b5c2"], ["libro", "#2f7ff0"], ["matraz", "#9b4fe0"],
  ["estetoscopio", "#13bfa0"], ["microscopio", "#f2962e"], ["adn", "#e5408f"]];
async function vistaTemas(filtro) {
  if (filtro === undefined) filtro = pref("filtroAnio", "todas");
  else guardarPref("filtroAnio", filtro === "todas" ? "" : filtro);
  const asigs = await db.listarAsignaturas();
  const docs = await db.listarDocumentos();
  const chips = [["todas", "Todas"], ...ANIOS.map((n, i) => [String(i + 1), n])]
    .map(([v, t]) => `<a class="chip-filtro ${v === filtro ? "activo" : ""}" href="#/temas/${v}">${t}</a>`).join("");
  const elegidas = asigs
    .filter((a) => filtro === "todas" || a.anio === Number(filtro))
    .sort((a, b) => a.anio - b.anio || (a.semestre ?? 9) - (b.semestre ?? 9) || a.nombre.localeCompare(b.nombre, "es"));
  let lista = "";
  let anioActual = 0;
  for (const a of elegidas) {
    if (filtro === "todas" && a.anio !== anioActual) {
      anioActual = a.anio;
      lista += `<div class="titulo-seccion"><h2>${ANIOS[a.anio - 1]}</h2><a href="#/anio/${a.anio}">Ver año ${ico("chevron")}</a></div>`;
    }
    const suyos = docs.filter((d) => d.asignaturas.includes(a.id));
    const c = suyos.filter((d) => d.tipo !== "libro").length;
    const preg = suyos.reduce((s, d) => s + (d.cuestionario?.length || 0), 0);
    lista += `<a class="tarjeta asig-tarjeta" href="${enlaceAsig(a.id)}">${htmlMiniatura(a.nombre, a.anio)}
      <span class="asig-cuerpo"><span class="asig-nombre">${esc(a.nombre)}</span>
      ${descripcionAsignatura(a.nombre, a.anio) ? `<span class="asig-desc">${esc(descripcionAsignatura(a.nombre, a.anio))}</span>` : ""}
      <span class="asig-cuenta">${suyos.length ? `${c} conferencias y talleres${preg ? ` · ${preg} preguntas` : ""}` : "Pronto: conferencias y cuestionarios"}</span></span>
      ${ico("chevron", "flecha-der")}</a>`;
  }
  poner("Temas", `
    <form class="buscador" data-ambito="todo">
      <input name="q" type="search" placeholder="Buscar en toda la carrera…" autocomplete="off" required>
      <button class="btn" aria-label="Buscar">${ico("buscar")}</button>
    </form>
    <nav class="filtros" aria-label="Filtrar por año">${chips}</nav>
    ${lista || `<p class="vacio">Todavía no hay asignaturas en este año.</p>`}
    <button class="btn ancho solo-manual" data-accion="paquete">${ico("cargar")} Cargar paquete de Claude</button>`);
  document.querySelector(".chip-filtro.activo")?.scrollIntoView({ inline: "center", block: "nearest" });
}

// ---------- Pantalla: Progreso (estadísticas e insignias) ----------
async function vistaProgresoGeneral(pestana = "estadisticas") {
  if (pestana === undefined) pestana = "estadisticas";
  const r = await resumenDeEstudio();
  const lista = insignias({ racha: r.racha, totalRespondidas: r.respondidas, temasDominados: r.temasDominados,
    mejorNota: r.examenes.reduce((m, e) => Math.max(m, e.nota), 0) });
  const pestanas = `<nav class="pestanas-pildora">
    <a href="#/progreso" class="${pestana !== "logros" ? "activa" : ""}">Estadísticas</a>
    <a href="#/progreso/logros" class="${pestana === "logros" ? "activa" : ""}">Logros</a></nav>`;
  if (pestana === "logros") {
    const { logros, trofeos } = juego.listaDeLogros(await contextoLogros());
    const nv = r.nivel;
    const tarjetaLogro = (l) => `<div class="logro ${l.ok ? "ganado" : ""} medalla-${l.medalla}">
        <span class="logro-medalla">${l.emoji}</span>
        <span class="logro-texto"><b>${esc(l.nombre)}</b><span class="sub">${esc(l.que)}</span>
          ${l.ok ? `<span class="logro-ok">${l.medalla === "trofeo" ? "Trofeo ganado" : "Medalla de " + l.medalla}${l.fecha ? " · " + new Date(l.fecha).toLocaleDateString("es") : ""}</span>`
            : `<span class="logro-falta">${esc(l.faltaTexto)}</span>
               ${l.meta > 1 ? `<span class="logro-barra"><span style="width:${Math.round((l.actual / l.meta) * 100)}%"></span></span>` : ""}`}</span></div>`;
    return poner("Mi progreso", `${pestanas}
      <section class="tarjeta nivel-tarjeta">
        <span class="nivel-emoji">${nv.emoji}</span>
        <span class="nivel-info"><span class="sub">Nivel ${nv.n} de 6</span><b>${esc(nv.nombre)}</b>
          <span class="nivel-barra"><span style="width:${nv.pct}%"></span></span>
          <span class="sub">${r.puntos} puntos · ${nv.siguiente ? `${nv.faltan} para ${esc(nv.siguiente.nombre)}` : "¡Nivel máximo!"}</span></span>
      </section>
      <div class="niveles-camino">${juego.NIVELES.map((x) => `<span class="${x.n <= nv.n ? "hecho" : ""}" title="${esc(x.nombre)} (${x.desde} puntos)">${x.emoji}</span>`).join("")}</div>
      <h2>Medallas · ${logros.filter((x) => x.ok).length} de ${logros.length}</h2>
      <div class="logros">${[...logros].sort((x, y) => y.ok - x.ok).map(tarjetaLogro).join("")}</div>
      <h2>Trofeos especiales · ${trofeos.filter((x) => x.ok).length} de ${trofeos.length}</h2>
      <div class="logros">${trofeos.map(tarjetaLogro).join("")}</div>
      <details class="tarjeta como-puntos"><summary><b>¿Cómo gano puntos?</b></summary>
        <ul><li>✅ Respuesta correcta: <b>+${juego.PUNTOS.correcta}</b></li>
          <li>🏁 Terminar una prueba completa: <b>+${juego.PUNTOS.terminar}</b></li>
          <li>💯 Sacar 100 % en la prueba: <b>+${juego.PUNTOS.perfecta}</b> más</li>
          <li>🔥 Racha: cada día, <b>+${juego.PUNTOS.rachaPorDia}</b> por cada día seguido (hasta ${juego.PUNTOS.rachaMax})</li></ul></details>`, "#/perfil");
  }
  // Áreas más fuertes: porcentaje dominado de cada asignatura
  const asigs = (await db.listarAsignaturas()).filter((a) => r.conPreguntas.some((d) => d.asignaturas.includes(a.id)));
  const areas = [];
  for (const a of asigs) areas.push({ a, p: await progresoAsignatura(a) });
  areas.sort((x, y) => y.p.pct - x.p.pct);
  const colores = ["#2dd4cf", "#a3e635", "#c084fc", "#f2962e", "#e5408f", "#2f7ff0"];
  // ---------- Actividad: últimos 7 o 30 días ----------
  // Todo sale de la misma tabla de sesiones y de la misma función (tiempo.analizar).
  const t = await datosDeTiempo();
  const nDias = pestana === "30" ? 30 : 7;
  const fechaDe = (k) => {
    const d = new Date(db.hoy() + "T12:00:00");
    d.setDate(d.getDate() - k);
    return { d, f: tiempo.fechaLocal(d.getTime()) };
  };
  const desde = tiempo.inicioDelDia(fechaDe(nDias - 1).f);
  const desdeAntes = tiempo.inicioDelDia(fechaDe(2 * nDias - 1).f);
  const periodo = t.analizar({ desde });
  const anterior = t.analizar({ desde: desdeAntes, hasta: desde });
  const todo = t.analizar();
  const diaDe = (k, an) => {
    const { d, f } = fechaDe(k);
    const reg = t.diario.find((x) => x.fecha === f);
    return { f, d, n: reg?.preguntas || 0, ok: reg?.correctas || 0, seg: an.porDia[f] || 0 };
  };
  const dias = [];
  for (let k = nDias - 1; k >= 0; k--) dias.push(diaDe(k, periodo));
  const previos = [];
  for (let k = 2 * nDias - 1; k >= nDias; k--) previos.push(diaDe(k, anterior));
  const suma = (l, c) => l.reduce((s2, x) => s2 + x[c], 0);
  const nTot = suma(dias, "n"), okTot = suma(dias, "ok");
  // Franjas: los minutos de cada una suman exactamente los minutos del período
  const franjasMin = tiempo.minutosRepartidos(periodo.porFranja);
  const minTot = franjasMin.total;
  const activos = dias.filter((x) => x.n || x.seg >= 60).length;
  const promedio = activos ? Math.round(minTot / activos) : 0;
  const mejor = [...dias].sort((x, y) => y.n - x.n || y.seg - x.seg)[0];
  const nPrev = suma(previos, "n");
  const hayAntes = nPrev > 0 || anterior.total >= 60;
  const dif = nTot - nPrev;
  const nombreDia = (x, largo = false) => x.d.toLocaleDateString("es", largo ? { weekday: "long", day: "numeric", month: "long" } : { weekday: "short", day: "numeric" }).replace(".", "");
  const comparacion = !hayAntes
    ? (nDias === 7 ? "Tu primera semana 🎉" : "Tus primeros 30 días 🎉")
    : `${dif > 0 ? "+" : dif < 0 ? "−" : "="}${dif ? Math.abs(dif) : ""} vs ${nDias === 7 ? "semana pasada" : "30 días anteriores"}`;
  const franjas = tiempo.FRANJAS.map((x, k) => ({ ...x, min: franjasMin.partes[k], rango: `${x.de}:00–${x.a === 24 ? "0" : x.a}:00` }));
  const maxFranja = Math.max(1, ...franjas.map((x) => x.min));
  const favorita = minTot ? [...franjas].sort((x, y) => y.min - x.min)[0] : null;

  // Todo el tiempo (sin repetir lo de arriba)
  const totalPreguntas = t.diario.reduce((s2, x) => s2 + x.preguntas, 0);
  const aciertosPorDoc = new Map();
  for (const x of t.respuestas) aciertosPorDoc.set(x.docId, (aciertosPorDoc.get(x.docId) || 0) + (x.aciertos || 0));
  const [idMejorTema, aciertosMejor] = [...aciertosPorDoc.entries()].sort((x, y) => y[1] - x[1])[0] || [];
  const mejorTema = idMejorTema && aciertosMejor ? r.docs.find((d) => d.id === idMejorTema) : null;
  const fechasEstudio = [...new Set(t.diario.filter((x) => x.preguntas).map((x) => x.fecha)
    .concat(Object.entries(todo.porDia).filter(([, v]) => v >= 60).map(([f]) => f)))].sort();
  let rachaLarga = 0, seguidos = 0, anteriorF = null;
  for (const f of fechasEstudio) {
    seguidos = anteriorF && (inicioDia(f) - inicioDia(anteriorF)) / 86400000 === 1 ? seguidos + 1 : 1;
    rachaLarga = Math.max(rachaLarga, seguidos);
    anteriorF = f;
  }
  function inicioDia(f) { return new Date(f + "T12:00:00").getTime(); }
  const notaMedia = r.examenes.length ? (r.examenes.reduce((s2, x) => s2 + x.nota, 0) / r.examenes.length).toFixed(1).replace(".0", "") : "—";
  vistaProgresoGeneral.dias = dias;

  poner("Mi progreso", `${pestanas}
    <section class="tarjeta progreso-general sin-enlace">
      <span class="pg-fila">${htmlAnilloPct(r.pct, "Progreso total")}
        <span class="pg-datos">
          <span class="pg-racha">${ico("llama")}<b>${r.racha}</b><span>Días racha</span></span>
          <span>${ico("reloj")}<b>${tiempo.textoMinutos(minutos(todo.total))}</b><span>Tiempo en la app</span></span>
          <span>${ico("trofeo")}<b>${lista.filter((x) => x.ok).length}</b><span>Logros</span></span>
        </span></span>
    </section>

    <div class="titulo-seccion"><h2>Tu actividad</h2>
      <span class="pg-pestanas"><a href="#/progreso" class="${nDias === 7 ? "activa" : ""}">7 días</a><a href="#/progreso/30" class="${nDias === 30 ? "activa" : ""}">30 días</a></span></div>
    <div class="act-resumen">
      <div class="tarjeta act-dato"><span class="sub">Preguntas</span><b>${nTot}</b>
        <span class="act-cambio ${!hayAntes ? "primera" : dif >= 0 ? "sube" : "baja"}">${comparacion}</span></div>
      <div class="tarjeta act-dato"><span class="sub">Aciertos</span><b>${nTot ? Math.round((okTot / nTot) * 100) : 0}%</b><span class="sub">${okTot} bien · ${nTot - okTot} mal</span></div>
      <div class="tarjeta act-dato"><span class="sub">Tiempo de estudio</span><b>${tiempo.textoMinutos(minTot)}</b>
        <span class="sub">${activos ? `${tiempo.textoMinutos(promedio)} por día estudiado` : "Aún no has estudiado en estos días"}</span></div>
      <div class="tarjeta act-dato"><span class="sub">Días activos</span><b>${activos} <small>de ${nDias}</small></b>
        <span class="act-puntos">${dias.map((x) => `<i class="${x.n || x.seg >= 60 ? "si" : ""}"></i>`).join("")}</span></div>
    </div>
    <div class="tarjeta act-grafica">
      <div class="act-leyenda"><span><i class="ley-bien"></i>Correctas</span><span><i class="ley-mal"></i>Incorrectas</span><span><i class="ley-min"></i>Minutos</span></div>
      ${graficaActividad(dias, nDias)}
      <p class="act-detalle" id="act-detalle">${mejor && (mejor.n || mejor.seg >= 60)
        ? `⭐ Tu mejor día: <b>${esc(nombreDia(mejor, true))}</b> · ${mejor.n} preguntas · ${tiempo.textoMinutos(minutos(mejor.seg))}. <span class="sub">Toca una barra para ver cada día.</span>`
        : "Todavía no hay actividad en estos días. ¡Responde unas preguntas!"}</p>
      ${periodo.estimado >= 60 ? `<p class="sub act-estimado">ℹ️ ${tiempo.textoMinutos(minutos(periodo.estimado))} son un cálculo aproximado a partir de la hora de tus respuestas (días de antes de que Finlay guardara el tiempo).</p>` : ""}
    </div>

    <h2>¿Cuándo estudias más?</h2>
    <div class="tarjeta franjas">${franjas.map((x) => `<div class="franja ${favorita === x ? "favorita" : ""}">
        <span class="franja-nombre">${x.emoji} ${x.nombre}<span class="sub">${x.rango}</span></span>
        <span class="franja-barra"><span style="width:${Math.round((x.min / maxFranja) * 100)}%"></span></span>
        <b>${tiempo.textoMinutos(x.min)}</b></div>`).join("")}
      <p class="franja-total"><span>Total</span><b>${tiempo.textoMinutos(minTot)}</b></p>
      ${periodo.horaAproximada >= 60 ? `<p class="sub act-estimado">ℹ️ De ${tiempo.textoMinutos(minutos(periodo.horaAproximada))} medidos por la versión anterior de Finlay no se guardó la hora exacta: se colocaron según la hora de tus respuestas.</p>` : ""}
      <p class="sub">${favorita ? `Estudias más por la <b>${favorita.nombre.toLowerCase()}</b>. Repasa a esa hora: es cuando mejor te concentras.` : "Cuando estudies unos días, aquí verás a qué hora estudias más."}</p></div>

    <h2>Áreas más fuertes</h2>
    <div class="tarjeta areas">${areas.length ? areas.map(({ a, p }, i) => `<a class="area" href="${enlaceAsig(a.id)}/progreso">
        <span class="area-nombre">${esc(a.nombre)}<span class="sub">${p.bien} de ${p.total} preguntas dominadas</span></span>
        <span class="area-barra"><span style="width:${p.pct}%;background:${colores[i % colores.length]}"></span></span><b>${p.pct}%</b></a>`).join("")
      : `<p class="vacio">Cuando respondas cuestionarios, aquí verás en qué asignaturas vas mejor.</p>`}</div>

    <h2>Todo el tiempo</h2>
    <div class="totales">
      <div class="tarjeta">${ico("check")}<b>${totalPreguntas}</b><span class="sub">preguntas respondidas</span></div>
      <div class="tarjeta">${ico("llama")}<b>${rachaLarga} día${rachaLarga === 1 ? "" : "s"}</b><span class="sub">racha más larga</span></div>
      <div class="tarjeta">${ico("examen")}<b>${notaMedia}</b><span class="sub">nota media${r.examenes.length ? ` · ${r.examenes.length} examen${r.examenes.length === 1 ? "" : "es"}` : " (sin exámenes aún)"}</span></div>
      <div class="tarjeta total-tema">${ico("trofeo")}<b>${mejorTema ? `${aciertosMejor} aciertos` : "—"}</b>
        <span class="sub">${mejorTema ? `tema con más aciertos: ${esc(mejorTema.nombre)}` : "tema con más aciertos"}</span></div>
    </div>`, "#/perfil");
}

/** Gráfica de actividad: barras (correctas + incorrectas) y línea de minutos, con ejes */
function graficaActividad(dias, nDias) {
  const W = 340, H = 220, izq = 30, der = 30, arriba = 24, abajo = 30;
  const ancho = W - izq - der, alto = H - arriba - abajo;
  const minDia = dias.map((x) => Math.round(x.seg / 60));
  // Eje de minutos: múltiplos de 5 (0, 5, 10, 15…), como mucho 5 tramos
  const pasoM = 5 * Math.max(1, Math.ceil(Math.max(...minDia, 1) / 25));
  const lineas = Math.max(1, Math.ceil(Math.max(...minDia, 1) / pasoM));
  const maxM = pasoM * lineas;
  // Eje de preguntas: paso "redondo" (1, 2, 5, 10, 20, 25, 50…) con las mismas líneas
  const PASOS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
  const pasoN = PASOS.find((p) => p * lineas >= Math.max(...dias.map((x) => x.n), 1)) || 1000;
  const maxN = pasoN * lineas;
  const paso = ancho / dias.length;
  const bw = Math.max(3, paso * (nDias === 7 ? 0.5 : 0.62));
  const y = (v, max) => arriba + alto - (v / max) * alto;
  let svg = "";
  for (let i = 0; i <= lineas; i++) {
    const yy = arriba + (alto * i) / lineas;
    svg += `<line x1="${izq}" y1="${yy}" x2="${W - der}" y2="${yy}" class="g-rejilla"/>
      <text x="${izq - 5}" y="${yy + 3}" text-anchor="end" class="g-eje">${pasoN * (lineas - i)}</text>
      <text x="${W - der + 5}" y="${yy + 3}" class="g-eje g-eje-min">${pasoM * (lineas - i)}</text>`;
  }
  const puntos = [];
  let toques = "";
  dias.forEach((x, i) => {
    const cx = izq + paso * i + paso / 2;
    const yOk = y(x.ok, maxN), yN = y(x.n, maxN);
    if (x.ok) svg += `<rect x="${cx - bw / 2}" y="${yOk}" width="${bw}" height="${arriba + alto - yOk}" rx="${Math.min(4, bw / 3)}" class="g-bien"/>`;
    if (x.n - x.ok) svg += `<rect x="${cx - bw / 2}" y="${yN}" width="${bw}" height="${yOk - yN}" rx="${Math.min(4, bw / 3)}" class="g-mal"/>`;
    puntos.push([cx, y(minDia[i], maxM)]);
    const etiqueta = nDias === 7 ? x.d.toLocaleDateString("es", { weekday: "short" }).replace(".", "")
      : i % 5 === 4 || i === dias.length - 1 ? String(x.d.getDate()) : "";
    if (etiqueta) svg += `<text x="${cx}" y="${H - abajo + 16}" text-anchor="middle" class="g-dia ${i === dias.length - 1 ? "g-hoy" : ""}">${esc(etiqueta)}</text>`;
    toques += `<rect x="${izq + paso * i}" y="${arriba}" width="${paso}" height="${alto + 20}" class="g-toque" data-accion="act-dia" data-i="${i}"/>`;
  });
  const linea = `<polyline points="${puntos.map((p) => p.join(",")).join(" ")}" class="g-linea"/>` +
    (nDias === 7 ? puntos.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="3.2" class="g-punto"/>`).join("") : "");
  return `<svg class="g-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Preguntas y minutos de estudio por día">
    <text x="4" y="9" class="g-eje g-titulo-eje">preg.</text><text x="${W - 4}" y="9" text-anchor="end" class="g-eje g-eje-min g-titulo-eje">min</text>
    ${svg}${linea}${toques}</svg>`;
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
  const r = await resumenDeEstudio();
  const nombre = pref("nombre").trim();
  const fila = (href, icono, texto, extra = "") =>
    `<a class="menu-fila" href="${href}">${ico(icono)}<span>${texto}</span>${extra}${ico("chevron", "flecha-der")}</a>`;
  poner("Perfil", `
    <section class="perfil-arriba">
      <label class="perfil-avatar" title="Cambiar foto">${htmlAvatar("avatar-grande", true)}
        <span class="avatar-lapiz">${ico("lapiz")}</span>
        <input type="file" id="aj-foto" accept="image/*" hidden></label>
      <b class="perfil-nombre">${esc(nombre || "Estudiante")}</b>
      <span class="sub">${r.nivel.emoji} ${esc(r.nivel.nombre)}</span>
      <span class="perfil-nivel"><span class="nivel-barra"><span style="width:${r.nivel.pct}%"></span></span>
        <span class="sub">${r.nivel.siguiente ? `${r.nivel.faltan} puntos para ${esc(r.nivel.siguiente.nombre)}` : "¡Nivel máximo!"}</span></span>
    </section>
    <div class="perfil-cifras">
      <a class="tarjeta" href="#/progreso/logros"><span class="emoji">${r.nivel.emoji}</span><span><b>Nivel ${r.nivel.n}</b><span class="sub">${esc(r.nivel.nombre)}</span></span></a>
      <a class="tarjeta" href="#/progreso/logros"><span class="emoji">💎</span><span><b>${textoPuntos(r.puntos)}</b><span class="sub">Puntos</span></span></a>
    </div>
    <nav class="tarjeta menu-lista">
      ${fila("#/progreso", "grafica", "Mi progreso")}
      ${fila("#/biblioteca/favoritos", "corazon", "Mis favoritos", favoritos().length ? `<span class="globo">${favoritos().length}</span>` : "")}
      ${fila("#/copia", "copia", "Copia y compartir")}
      ${fila("#/planes", "calendario", "Plan para el examen")}
      ${fila("#/ajustes", "ajustes", "Configuración")}
      ${fila("#/ayuda", "ayuda", "Ayuda: cómo usar Finlay")}
    </nav>
    <button id="instalar" class="btn secundario" hidden>📲 Instalar Finlay en el teléfono</button>
    <p class="nota centro">Hecha para estudiantes de Medicina en Cuba, en honor a Carlos J. Finlay (1833–1915).</p>`);
  mostrarBotonInstalar();
}

async function vistaAjustes() {
  const docs = await db.listarDocumentos();
  let espacio = "";
  if (navigator.storage?.estimate) {
    try {
      const { usage } = await navigator.storage.estimate();
      espacio = ` · ${(usage / 1048576).toFixed(1)} MB usados`;
    } catch {}
  }
  const opcion = (v, t, actual) => `<option value="${v}" ${String(v) === String(actual) ? "selected" : ""}>${t}</option>`;
  const tema = pref("tema", "hora");
  const interruptor = (id, icono, texto, encendido, sub = "") => `<label class="fila-interruptor" for="${id}">${ico(icono)}
      <span>${texto}${sub ? `<span class="sub">${sub}</span>` : ""}</span>
      <input type="checkbox" role="switch" id="${id}" ${encendido ? "checked" : ""}><span class="interruptor"></span></label>`;
  poner("Configuración", `
    <h2>Cuenta</h2>
    <div class="tarjeta menu-lista">
      <label class="menu-fila cuenta" for="aj-nombre">${htmlAvatar("avatar-chico", true)}
        <span><input id="aj-nombre" value="${esc(pref("nombre"))}" maxlength="30" placeholder="Escribe tu nombre"><span class="sub">Toca para cambiar tu nombre</span></span></label>
      <label class="menu-fila" for="aj-foto">${ico("camara")}<span>${pref("foto") ? "Cambiar foto" : "Poner tu foto"}</span>${ico("chevron", "flecha-der")}
        <input type="file" id="aj-foto" accept="image/*" hidden></label>
      ${pref("foto") ? `<button class="menu-fila" data-accion="quitar-foto">${ico("cerrar")}<span>Quitar la foto</span></button>` : ""}
    </div>
    <h2>Preferencias</h2>
    <div class="tarjeta menu-lista">
      ${interruptor("aj-auto", "reloj", "Cambiar color según la hora", tema === "hora", "Claro de día, oscuro de 7 pm a 7 am")}
      ${interruptor("aj-oscuro", "luna", "Modo oscuro", temaReal() === "oscuro", tema === "hora" ? "Ahora lo decide la hora" : "")}
      ${interruptor("aj-sonido", "voz", "Sonido al responder", pref("sonido", "1") === "1", "Un tono al acertar o fallar")}
      <label class="fila-select" for="aj-escala">${ico("lupa")}<span>Tamaño de letra</span><select id="aj-escala">${opcion("1", "Normal", pref("escala", "1"))}${opcion("1.12", "Grande", pref("escala", "1"))}${opcion("1.25", "Muy grande", pref("escala", "1"))}</select></label>
      <label class="fila-select" for="meta">${ico("trofeo")}<span>Meta diaria de preguntas</span><select id="meta">${[5, 10, 15, 20, 30, 50, 60].map((v) => opcion(v, v, metaDiaria())).join("")}</select></label>
      <label class="fila-select" for="velocidad">${ico("voz")}<span>Velocidad de la voz</span><select id="velocidad">${[0.8, 0.9, 1, 1.15, 1.3, 1.5].map((v) => opcion(v, v + "×", velocidadVoz())).join("")}</select></label>
    </div>
    <h2>Tus materiales</h2>
    <div class="tarjeta menu-lista">
      <a class="menu-fila" href="#/copia">${ico("copia")}<span>Copia y compartir</span>${ico("chevron", "flecha-der")}</a>
      <button class="menu-fila solo-manual" data-accion="paquete">${ico("cargar")}<span>Cargar paquete de Claude</span>${ico("chevron", "flecha-der")}</button>
    </div>
    <h2>Información</h2>
    <div class="tarjeta menu-lista">
      <details class="menu-fila acerca"><summary>${ico("info")}<span>Acerca de Finlay</span>${ico("chevron", "flecha-der")}</summary>
        <p>Finlay · Estudio médico · versión 1.9.3 · ${docs.length} materiales${espacio}.</p>
        <p>Hecha para estudiantes de Medicina en Cuba, en honor a Carlos J. Finlay (1833–1915), el médico cubano que descubrió que el mosquito transmite la fiebre amarilla.</p></details>
      <details class="menu-fila acerca"><summary>${ico("examen")}<span>Términos de uso</span>${ico("chevron", "flecha-der")}</summary>
        <p>Finlay es gratis y funciona sin internet. Las respuestas salen solo de las conferencias y libros cargados, con su página o diapositiva. Tus datos se quedan en tu teléfono: Finlay no los envía a ningún lado.</p></details>
    </div>`, "#/perfil");
}

/** Guarda la foto del estudiante, reducida a 256 px para que ocupe poco */
async function guardarFoto(archivo) {
  try {
    const img = await createImageBitmap(archivo);
    const lado = Math.min(img.width, img.height);
    const lienzo = document.createElement("canvas");
    lienzo.width = lienzo.height = 256;
    lienzo.getContext("2d").drawImage(img, (img.width - lado) / 2, (img.height - lado) / 2, lado, lado, 0, 0, 256, 256);
    guardarPref("foto", lienzo.toDataURL("image/jpeg", 0.85));
    aviso("📷 Foto guardada");
    router();
  } catch {
    alert("No se pudo abrir esa imagen. Prueba con otra foto.");
  }
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
  ["biblioteca", "#/biblioteca", "Biblioteca", "biblioteca"],
  ["evaluaciones", "#/evaluaciones", "Evaluaciones", "examen"],
  ["perfil", "#/perfil", "Perfil", "yo"],
];
const SECCION_DE_RUTA = {
  "": "inicio", temas: "temas", anio: "temas", asig: "temas", buscar: "temas",
  biblioteca: "biblioteca", doc: "biblioteca", leer: "biblioteca",
  evaluaciones: "evaluaciones", repaso: "evaluaciones", examen: "evaluaciones", "examen-hacer": "evaluaciones", planes: "evaluaciones", plan: "evaluaciones",
  perfil: "perfil", progreso: "perfil", copia: "perfil", ayuda: "perfil", ajustes: "perfil",
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
      ${descripcionAsignatura(a.nombre, a.anio) ? `<span class="asig-desc">${esc(descripcionAsignatura(a.nombre, a.anio))}</span>` : ""}
      <span class="asig-cuenta">${c || l ? `${c} conferencias y talleres${l ? ` · ${l} libros` : ""}${preguntas ? ` · ${preguntas} preguntas` : ""}` : "Pronto: conferencias y cuestionarios"}</span></span>
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
    cuerpo = `<div class="avance-diapo" data-total="${total}" data-doc="${doc.id}">
        <span class="barra-progreso"><span class="en-camino" id="avance-barra" style="width:${(100 / total).toFixed(1)}%"></span></span>
        <span id="avance-num">1 / ${total}</span></div>
      <p class="sub diapo-info">${total} ${palabra === "Diapositiva" ? "diapositivas" : "páginas"} · toca una para ampliarla</p>
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
    `<div class="doc-cabeza"><p class="migas">${esc(doc.asignaturas.map(nombreAsig).join(" · "))}</p>
      <button class="btn-fav ${esFavorito(doc.id) ? "activo" : ""}" data-accion="favorito" data-id="${doc.id}" aria-pressed="${esFavorito(doc.id)}" aria-label="Guardar en favoritos">${ico("corazon")}</button></div>${pestanas}${cuerpo}
     ${pestana === "conferencia" && doc.paginas ? `<button class="btn mini abajo solo-manual" data-accion="exportar" data-id="${doc.id}">📤 Exportar texto para Claude</button>` : ""}`,
    enlaceAsig(asigActual) + (doc.tipo === "libro" ? "/libros" : "")
  );
  vistaDoc.doc = doc;
  if (pestana === "cuestionario") iniciarSesion(false);
  else if (tieneVisual(doc)) activarCarga($app, doc);
  // Vuelve a la diapositiva donde se quedó (si no se pidió otra)
  if (!irA && pestana === "conferencia") irA = Number(pref("pos-" + docId)) || 0;
  if (irA > 1) document.getElementById("d" + irA)?.scrollIntoView({ block: "start" });
  actualizarAvance();
}

/** Tono corto al responder: dos notas que suben si aciertas, una grave si fallas */
let audio = null;
function sonar(bien) {
  if (pref("sonido", "1") !== "1") return;
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    audio.resume?.();
    // Acierto: dos notas que suben. Error: "buzz-buzz" que baja (tono medio, que sí suena en el altavoz del teléfono)
    const notas = bien
      ? [{ f: 660, tipo: "sine", vol: 0.25, dur: 0.18 }, { f: 880, tipo: "sine", vol: 0.25, dur: 0.22 }]
      : [{ f: 466, tipo: "square", vol: 0.12, dur: 0.16 }, { f: 349, tipo: "square", vol: 0.12, dur: 0.28 }];
    notas.forEach((n, i) => {
      const o = audio.createOscillator();
      const g = audio.createGain();
      const t = audio.currentTime + i * (bien ? 0.12 : 0.17);
      o.type = n.tipo;
      o.frequency.value = n.f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(n.vol, t + 0.015);
      g.gain.setValueAtTime(n.vol, t + n.dur * 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, t + n.dur);
      o.connect(g).connect(audio.destination);
      o.start(t);
      o.stop(t + n.dur + 0.05);
    });
    // En el teléfono, además, vibra un poquito al fallar
    if (!bien) window.FinlayAndroid?.vibrar ? window.FinlayAndroid.vibrar(70) : navigator.vibrate?.([60, 40, 60]);
  } catch {}
}

/** Barra de avance de la conferencia: qué diapositiva estás viendo y dónde te quedaste */
let esperaAvance = null;
function actualizarAvance() {
  const caja = document.querySelector(".avance-diapo");
  if (!caja) return;
  const total = Number(caja.dataset.total);
  const tope = caja.getBoundingClientRect().bottom + 20;
  let actual = 1;
  for (const f of document.querySelectorAll(".diapo")) {
    if (f.getBoundingClientRect().top <= tope) actual = Number(f.id.slice(1)) || actual;
    else break;
  }
  // Al llegar al final de la página cuenta como la última diapositiva
  if (innerHeight + scrollY >= document.documentElement.scrollHeight - 40 && document.querySelector(`#d${total} img[src]`)) actual = total;
  document.getElementById("avance-num").textContent = `${actual} / ${total}`;
  document.getElementById("avance-barra").style.width = `${((actual / total) * 100).toFixed(1)}%`;
  clearTimeout(esperaAvance);
  esperaAvance = setTimeout(() => guardarPref("pos-" + caja.dataset.doc, actual > 1 && actual < total ? String(actual) : ""), 400);
  if (actual === total && total > 1 && juego.conferenciaLeida(caja.dataset.doc)) revisarLogros();
}
addEventListener("scroll", () => requestAnimationFrame(actualizarAvance), { passive: true });
$app.addEventListener("load", (e) => e.target.matches?.("img[data-diapo]") && requestAnimationFrame(actualizarAvance), true);

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
  const titulo = sinResponder ? "⚪ Sin responder." : r.correcta ? `${ico("check", "ok-ico")} ¡Correcto!` : `❌ Incorrecto${parcial}.`;
  const caja = document.querySelector(`#p${k} .explicacion`);
  caja.classList.toggle("es-correcta", !!r.correcta && !sinResponder);
  caja.classList.toggle("es-incorrecta", !r.correcta && !sinResponder);
  caja.innerHTML = `<b class="correccion-titulo">${titulo}</b> <span class="correccion-texto">${esc(textoRespuesta(p))}</span>
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
  tiempo.marcarRespuesta();
  const { doc, i } = enPantalla[k];
  const p = doc.cuestionario[i];
  const tarjeta = document.getElementById("p" + k);
  if (modo === "examen" && vistaExamen.alMomento) {
    // Examen corregido al momento: se corrige ya, con sonido; al entregar se cuenta tal cual
    if (resultadosExamen.has(k)) return;
    const r = corregir(p, tarjeta, valor);
    if (!r) return aviso("Responde todas las partes antes de comprobar.");
    sonar(r.correcta);
    resultadosExamen.set(k, r);
    elegidasExamen.set(k, valor ?? true);
    if (p.tipo !== "abierta") mostrarCorreccion(k, r);
    preguntaRespondida();
    alResponder(k);
    if (sesion) actualizarMapa();
    return;
  }
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
  sonar(r.correcta);
  preguntaRespondida();
  if (p.tipo !== "abierta") mostrarCorreccion(k, r);
  else if (!r.correcta) tarjeta.querySelector(".explicacion .acciones")?.insertAdjacentHTML("afterbegin", botonGuia(k));
  await db.guardarRespuesta(doc.id, i, r.correcta);
  juego.respuesta(r.correcta, calcularRacha(await db.listarDiario()).racha, db.hoy());
  celebrado = false;
  await alResponder(k, r);
  if (!celebrado) revisarLogros();
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

let relojSesion = null;
function iniciarSesion(examen = false) {
  const tarjetas = [...$app.querySelectorAll(".pregunta")];
  sesion = null;
  if (tarjetas.length < 2) return;
  const barra = document.createElement("div");
  barra.className = "sesion-barra";
  barra.innerHTML = `<div class="ses-arriba"><span id="ses-pos" class="pildora"></span>
    ${examen ? "" : `<span class="ses-reloj">${ico("reloj")}<span id="ses-reloj">00:00</span></span>`}</div>
    <span class="barra-progreso"><span class="en-camino" id="ses-avance"></span></span>`;
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
  clearInterval(relojSesion);
  if (!examen) {
    const inicio = Date.now();
    relojSesion = setInterval(() => {
      const el = document.getElementById("ses-reloj");
      if (!el) return clearInterval(relojSesion);
      const seg = Math.floor((Date.now() - inicio) / 1000);
      el.textContent = `${String(Math.floor(seg / 60)).padStart(2, "0")}:${String(seg % 60).padStart(2, "0")}`;
    }, 1000);
  }
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
  const puntosInicio = juego.estado().puntos;
  let antes = resp.size;
  alResponder = async () => {
    const r = await db.respuestasDe(doc.id);
    const bienAhora = r.filter((x) => x.ultima).length;
    document.getElementById("marcador").textContent =
      `Respondidas ${r.length} de ${doc.cuestionario.length} · Correctas ${bienAhora}`;
    if (r.length >= doc.cuestionario.length && antes < doc.cuestionario.length)
      await terminarPrueba({ titulo: doc.nombre, acertadas: bienAhora, total: doc.cuestionario.length, puntosInicio });
    antes = r.length;
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
  const puntosInicio = juego.estado().puntos;
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
      await terminarPrueba({ titulo: "Repaso del día", acertadas: bien, total: lista.length, puntosInicio });
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
          <label class="check"><input type="checkbox" name="momento" ${pref("examenMomento", "1") === "1" ? "checked" : ""}> Corregir cada respuesta al momento (con sonido al acertar o fallar)</label>
          <button class="btn ancho">📝 Empezar examen</button>
        </form>
        <p class="nota">Si quitas «Corregir al momento», el examen es como el real: no sabes si fallaste hasta entregar. Nota según la escala cubana: 5 Excelente (90 % o más), 4 Bien (80 %), 3 Aprobado (70 %), 2 Desaprobado.</p>
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

const resultadosExamen = new Map(); // respuestas ya corregidas al momento (k → resultado)
async function vistaExamen(ambito, cantidad, conReloj, alMomento = false) {
  vistaExamen.puntosInicio = juego.estado().puntos;
  vistaExamen.alMomento = alMomento;
  resultadosExamen.clear();
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
  $app.classList.toggle("examen-al-momento", alMomento);
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
    if (resultadosExamen.has(k)) {
      r = resultadosExamen.get(k);
    } else if (inmediata && !elegidasExamen.has(k)) {
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
    if (!resultadosExamen.has(k) || p.tipo === "abierta") mostrarCorreccion(k, r, sinResponder);
    await db.guardarRespuesta(doc.id, i, r.correcta);
    if (!r.correcta) fallados.set(doc.id, { doc, n: (fallados.get(doc.id)?.n || 0) + 1 });
  }
  const { titulo, ambito, lista } = vistaExamen.datos;
  const porcentaje = Math.round((puntos / lista.length) * 100);
  const n = nota(porcentaje);
  const bienExamen = enPantalla.filter((_, k) => document.querySelector(`#p${k} .explicacion.es-correcta`)).length;
  juego.respuestasDeExamen(bienExamen, n.nota);
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
  await terminarPrueba({ titulo, acertadas: bienExamen, total: lista.length, pct: porcentaje, nota: n.nota,
    puntosInicio: vistaExamen.puntosInicio, otraVez: `#/examen/${encodeURIComponent(ambito)}` });
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
async function vistaBiblioteca(filtro = "todo") {
  const todos = (await db.listarDocumentos()).sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { numeric: true }));
  const favs = favoritos();
  const FILTROS = [["todo", "Todo"], ["conferencia", "Conferencias"], ["taller", "Clases taller"], ["libro", "Libros"], ["favoritos", "❤ Favoritos"]];
  const docs = todos.filter((d) => filtro === "todo" || (filtro === "favoritos" ? favs.includes(d.id) : (d.tipo || "conferencia") === filtro));
  if (filtro === "favoritos") docs.sort((a, b) => favs.indexOf(a.id) - favs.indexOf(b.id));
  poner("Biblioteca médica", `
    <form class="buscador" data-ambito="todo">
      <input name="q" type="search" placeholder="Buscar en todos los materiales…" autocomplete="off" required>
      <button class="btn" aria-label="Buscar">${ico("buscar")}</button>
    </form>
    <nav class="filtros">${FILTROS.map(([v, t]) => `<a class="chip-filtro ${v === filtro ? "activo" : ""}" href="#/biblioteca/${v}">${t}</a>`).join("")}</nav>
    ${docs.length ? `<div class="biblio">${docs.map((d) => {
      const [anio, nombreA] = d.asignaturas[0].split("|");
      const portada = imagenAsignatura(nombreA, anio);
      const color = (ESTILO_ANIO[Number(anio) - 1] || ESTILO_ANIO[0])[1];
      const tipo = d.tipo === "libro" ? "Libro" : d.tipo === "taller" ? "Clase taller" : "Conferencia";
      const total = totalPaginas(d);
      const unidad = d.diapositivas || d.etiqueta === "diap." ? "diapositivas" : "páginas";
      return `<a class="biblio-tarjeta" href="#/doc/${d.id}" style="--c:${color}">
        <span class="biblio-arriba">
          ${portada ? `<img src="${portada}" alt="">` : `<span class="biblio-icono">${ico(d.tipo === "libro" ? "libro" : "conferencia")}</span>`}
          <span class="biblio-tipo">${ico(d.tipo === "libro" ? "libro" : d.tipo === "taller" ? "taller" : "conferencia")}${tipo}</span>
          ${favs.includes(d.id) ? `<span class="biblio-fav">${ico("corazon")}</span>` : ""}
        </span>
        <b class="biblio-titulo">${esc(d.nombre)}</b>
        <span class="biblio-asig">${esc(nombreA)}</span>
        <span class="biblio-datos">${total ? `<span>${ico("conferencia")}${total} ${unidad}</span>` : ""}
          ${d.cuestionario?.length ? `<span>${ico("examen")}${d.cuestionario.length} preguntas</span>` : ""}</span></a>`;
    }).join("")}</div>`
    : `<p class="vacio">${filtro === "favoritos" ? "Todavía no tienes favoritos. Abre una conferencia y toca ❤ para guardarla aquí." : "No hay materiales de este tipo todavía."}</p>`}`);
}

function vistaAyuda() {
  poner(
    "Cómo usar Finlay",
    `<ol class="ayuda">
      <li><b>Inicio:</b> tu progreso general, tu racha 🔥, el botón <b>Continuar estudiando</b> (vuelve a la diapositiva donde te quedaste) y lo que te toca hoy.</li>
      <li><b>Temas:</b> elige el año arriba y luego la asignatura. Cada conferencia tiene sus <b>diapositivas</b>, como en el PDF, y su <b>Cuestionario</b>. Aquí está también el buscador.</li>
      <li><b>Biblioteca:</b> todas las conferencias, clases taller y libros con su portada. Toca ❤ en una conferencia para guardarla en <b>Favoritos</b>.</li>
      <li><b>Cuestionarios:</b> una pregunta por pantalla. Responde y toca <b>Siguiente</b>. Si fallas, <b>📖 Ver dónde está</b> te lleva a la parte exacta de la conferencia, marcada en verde.</li>
      <li><b>Evaluaciones:</b> el <b>repaso del día</b> (lo que fallas vuelve pronto), el <b>examen de práctica</b> con nota de 2 a 5 y el <b>plan para el examen</b>.</li>
      <li><b>Perfil:</b> tu foto, nivel y puntos, <b>Mi progreso</b> (estadísticas, tiempo de estudio y logros), favoritos y la <b>copia de seguridad</b>.</li>
      <li><b>Configuración</b> (⚙ en el inicio): tu nombre y foto, modo oscuro o automático por la hora, sonido, tamaño de letra, meta diaria y voz.</li>
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
    guardarPref("examenMomento", f.momento.checked ? "1" : "0");
    location.hash = `#/examen-hacer/${encodeURIComponent(f.ambito.value)}?n=${f.n.value}&reloj=${f.reloj.checked ? 1 : 0}&momento=${f.momento.checked ? 1 : 0}`;
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
  } else if (accion === "act-dia") {
    const x = vistaProgresoGeneral.dias?.[Number(b.dataset.i)];
    if (x) {
      document.querySelectorAll(".g-toque.elegido").forEach((t) => t.classList.remove("elegido"));
      b.classList.add("elegido");
      document.getElementById("act-detalle").innerHTML = `${ico("calendario", "ico-detalle")} <b>${esc(x.d.toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" }))}</b> · ` +
        (x.n || x.seg >= 60 ? `${x.n} preguntas (${x.ok} bien${x.n ? `, ${Math.round((x.ok / x.n) * 100)} %` : ""}) · ${tiempo.textoMinutos(minutos(x.seg))} de estudio` : "no estudiaste este día");
    }
  } else if (accion === "pg-ver") {
    guardarPref("verProgreso", b.dataset.ver === "hoy" ? "" : b.dataset.ver);
    const caja = b.closest(".progreso-general");
    caja.querySelectorAll("[data-accion=pg-ver]").forEach((x) => x.classList.toggle("activa", x === b));
    caja.querySelectorAll("[data-panel]").forEach((x) => (x.hidden = x.dataset.panel !== b.dataset.ver));
    caja.querySelector(".pg-nota").textContent = b.dataset.ver === "hoy" ? "Se reinicia cada día a las 12 de la noche." : "Todo lo que has estudiado desde que usas Finlay.";
  } else if (accion === "tema") {
    cambiarTema(b.dataset.tema);
  } else if (accion === "favorito") {
    const ahora = alternarFavorito(b.dataset.id);
    b.classList.toggle("activo", ahora);
    b.setAttribute("aria-pressed", ahora);
    aviso(ahora ? "❤ Guardada en Mis favoritos" : "Quitada de Mis favoritos");
  } else if (accion === "quitar-foto") {
    guardarPref("foto", "");
    router();
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
  if (ev.target.id === "aj-auto") {
    cambiarTema(ev.target.checked ? "hora" : temaReal());
    router();
  }
  if (ev.target.id === "aj-oscuro") {
    cambiarTema(ev.target.checked ? "oscuro" : "claro");
    router();
  }
  if (ev.target.id === "aj-sonido") guardarPref("sonido", ev.target.checked ? "1" : "0");
  if (ev.target.id === "aj-foto" && ev.target.files[0]) guardarFoto(ev.target.files[0]);
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
  clearInterval(relojSesion);
  $app.classList.remove("modo-examen");
  modo = "normal";
  const [ruta, consulta = ""] = location.hash.slice(1).split("?");
  const partes = ruta.split("/").filter(Boolean).map(decodeURIComponent);
  const q = new URLSearchParams(consulta).get("q") || "";
  cerrarMenu();
  document.querySelectorAll(".celebracion").forEach((c) => c.remove()); // al cambiar de pantalla se cierra
  sesion = null;
  liberarDiapositivas();
  pintarNav(partes[0] || "");
  try {
    if (partes[0] === "temas") await vistaTemas(partes[1]);
    else if (partes[0] === "progreso") await vistaProgresoGeneral(partes[1]);
    else if (partes[0] === "ajustes") await vistaAjustes();
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
    else if (partes[0] === "biblioteca") await vistaBiblioteca(partes[1]);
    else if (partes[0] === "repaso") await vistaRepaso();
    else if (partes[0] === "examen") await vistaExamenInicio(partes[1]);
    else if (partes[0] === "examen-hacer") {
      const ps = new URLSearchParams(consulta);
      await vistaExamen(partes[1], Number(ps.get("n")) || 20, ps.get("reloj") === "1", ps.get("momento") === "1");
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

tiempo.iniciarRegistro();
(async () => {
  // Una sola vez: pasar el tiempo guardado por versiones anteriores a la tabla de sesiones
  const respuestas = await db.todasLasRespuestas();
  tiempo.migrarDatosViejos(respuestas.map((r) => r.fecha).filter(Boolean));
})();
(async () => {
  if (juego.estado().sembrado) return;
  const diario = await db.listarDiario();
  juego.sembrar(diario.reduce((s, d) => s + d.correctas, 0));
  revisarLogros(false); // los logros de antes se guardan sin llenar la pantalla de avisos
})();
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
