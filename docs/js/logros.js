// Juego: puntos, niveles médicos, logros con medallas, trofeos y celebraciones.
// Todo se guarda en el teléfono (localStorage) y sale de lo que el estudiante de verdad hace.

const CLAVE = "finlay.juego";
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ---------- Estado guardado ----------
function leer() {
  let e = {};
  try { e = JSON.parse(localStorage.getItem(CLAVE) || "{}"); } catch {}
  return {
    puntos: 0, pruebas: 0, perfectas: 0, leidas: [], noche: false, madrugada: false,
    examen5: false, bonoRacha: "", desbloqueados: {}, sembrado: false, ...e,
  };
}
function guardar(e) {
  try { localStorage.setItem(CLAVE, JSON.stringify(e)); } catch {}
}
export function estado() {
  return leer();
}

/** La primera vez, da los puntos de lo que ya se había estudiado antes de esta versión. */
export function sembrar(correctasPrevias) {
  const e = leer();
  if (e.sembrado) return;
  e.puntos += correctasPrevias * PUNTOS.correcta;
  e.sembrado = true;
  guardar(e);
}

// ---------- Puntos ----------
export const PUNTOS = { correcta: 10, terminar: 30, perfecta: 50, rachaPorDia: 5, rachaMax: 30 };

function sumar(e, n) {
  const antes = nivelDe(e.puntos).n;
  e.puntos += n;
  if (nivelDe(e.puntos).n > antes) subioNivel = nivelDe(e.puntos);
}
let subioNivel = null;

/** Cada respuesta del cuestionario o del repaso. */
export function respuesta(correcta, racha, hoy) {
  const e = leer();
  if (correcta) sumar(e, PUNTOS.correcta);
  // Bono de racha: una vez al día, al responder la primera pregunta
  if (e.bonoRacha !== hoy && racha > 0) {
    e.bonoRacha = hoy;
    sumar(e, Math.min(racha, PUNTOS.rachaMax) * PUNTOS.rachaPorDia);
  }
  const h = new Date().getHours();
  if (h >= 22) e.noche = true;
  if (h < 6) e.madrugada = true;
  guardar(e);
}

/** Respuestas del examen (se corrigen todas al entregar). */
export function respuestasDeExamen(correctas, nota) {
  const e = leer();
  sumar(e, correctas * PUNTOS.correcta);
  if (nota === 5) e.examen5 = true;
  guardar(e);
}

/** Se terminó una prueba completa (cuestionario, repaso o examen). Devuelve los bonos. */
export function pruebaTerminada(acertadas, total) {
  const e = leer();
  let bono = PUNTOS.terminar;
  e.pruebas++;
  if (total && acertadas === total) {
    e.perfectas++;
    bono += PUNTOS.perfecta;
  }
  sumar(e, bono);
  guardar(e);
  return bono;
}

export function conferenciaLeida(docId) {
  const e = leer();
  if (e.leidas.includes(docId)) return false;
  e.leidas.push(docId);
  guardar(e);
  return true;
}

// ---------- Niveles con nombres médicos ----------
export const NIVELES = [
  { n: 1, nombre: "Estudiante de primer año", desde: 0, emoji: "🎒" },
  { n: 2, nombre: "Interno", desde: 1500, emoji: "🩺" },
  { n: 3, nombre: "Residente", desde: 4000, emoji: "🥼" },
  { n: 4, nombre: "Especialista", desde: 8000, emoji: "⚕️" },
  { n: 5, nombre: "Profesor", desde: 14000, emoji: "🎓" },
  { n: 6, nombre: "Eminencia médica", desde: 22000, emoji: "🏅" },
];
export function nivelDe(puntos) {
  let actual = NIVELES[0];
  for (const nv of NIVELES) if (puntos >= nv.desde) actual = nv;
  const sig = NIVELES[actual.n] || null;
  const pct = sig ? Math.round(((puntos - actual.desde) / (sig.desde - actual.desde)) * 100) : 100;
  return { ...actual, siguiente: sig, pct, faltan: sig ? sig.desde - puntos : 0 };
}

// ---------- Logros con medallas ----------
// ctx: { pruebas, perfectas, racha, correctas, leidas, noche, madrugada, examen5, asig: {completas, mejor}, anios: [...] }
const faltan = (n, una, varias) => `Te faltan ${n} ${n === 1 ? una : varias}`;
export const LOGROS = [
  { id: "prueba1", nombre: "Primera prueba", medalla: "bronce", emoji: "📝", que: "Termina tu primer cuestionario completo",
    meta: 1, valor: (c) => c.pruebas, falta: (r) => faltan(r, "prueba", "pruebas") },
  { id: "prueba10", nombre: "Constante", medalla: "plata", emoji: "📚", que: "Termina 10 pruebas completas",
    meta: 10, valor: (c) => c.pruebas, falta: (r) => faltan(r, "prueba", "pruebas") },
  { id: "cien1", nombre: "Primer 100 %", medalla: "plata", emoji: "💯", que: "Saca todo bien en una prueba",
    meta: 1, valor: (c) => c.perfectas, falta: () => "Responde bien todas las preguntas de una prueba" },
  { id: "cien5", nombre: "Perfeccionista", medalla: "oro", emoji: "🌟", que: "Saca 100 % en 5 pruebas",
    meta: 5, valor: (c) => c.perfectas, falta: (r) => faltan(r, "prueba perfecta", "pruebas perfectas") },
  { id: "racha3", nombre: "Encendido", medalla: "bronce", emoji: "🔥", que: "Estudia 3 días seguidos",
    meta: 3, valor: (c) => c.racha, falta: (r) => faltan(r, "día de racha", "días de racha") },
  { id: "racha7", nombre: "Semana completa", medalla: "plata", emoji: "📅", que: "Estudia 7 días seguidos",
    meta: 7, valor: (c) => c.racha, falta: (r) => faltan(r, "día de racha", "días de racha") },
  { id: "racha30", nombre: "Constancia de hierro", medalla: "oro", emoji: "🏋️", que: "Estudia 30 días seguidos",
    meta: 30, valor: (c) => c.racha, falta: (r) => faltan(r, "día de racha", "días de racha") },
  { id: "leer1", nombre: "Lector", medalla: "bronce", emoji: "📖", que: "Lee una conferencia hasta la última diapositiva",
    meta: 1, valor: (c) => c.leidas, falta: () => "Llega a la última diapositiva de una conferencia" },
  { id: "leer10", nombre: "Ratón de biblioteca", medalla: "plata", emoji: "🐭", que: "Lee 10 conferencias completas",
    meta: 10, valor: (c) => c.leidas, falta: (r) => faltan(r, "conferencia", "conferencias") },
  { id: "bien100", nombre: "100 respuestas correctas", medalla: "plata", emoji: "✅", que: "Acierta 100 preguntas",
    meta: 100, valor: (c) => c.correctas, falta: (r) => faltan(r, "respuesta correcta", "respuestas correctas") },
  { id: "bien500", nombre: "500 respuestas correctas", medalla: "oro", emoji: "🧠", que: "Acierta 500 preguntas",
    meta: 500, valor: (c) => c.correctas, falta: (r) => faltan(r, "respuesta correcta", "respuestas correctas") },
  { id: "asig1", nombre: "Asignatura dominada", medalla: "oro", emoji: "🎯", que: "Termina todas las pruebas de una asignatura",
    meta: 1, valor: (c) => c.asig.completas, falta: (_, c) => c.asig.mejor || "Termina todos los cuestionarios de una asignatura" },
  { id: "noche", nombre: "Búho nocturno", medalla: "bronce", emoji: "🦉", que: "Estudia de noche (después de las 10 pm)",
    meta: 1, valor: (c) => (c.noche ? 1 : 0), falta: () => "Responde una pregunta después de las 10 de la noche" },
  { id: "madrugada", nombre: "Madrugador", medalla: "plata", emoji: "🌅", que: "Estudia de madrugada (antes de las 6 am)",
    meta: 1, valor: (c) => (c.madrugada ? 1 : 0), falta: () => "Responde una pregunta antes de las 6 de la mañana" },
  { id: "nota5", nombre: "Excelente", medalla: "oro", emoji: "🏆", que: "Saca 5 en un examen de práctica",
    meta: 1, valor: (c) => (c.examen5 ? 1 : 0), falta: () => "Saca 5 en un examen de práctica" },
];
const ANIOS = ["1er año", "2do año", "3er año", "4to año", "5to año", "6to año"];
/** Trofeos especiales: completar un año entero de la carrera */
export function trofeos(ctx) {
  return ANIOS.map((t, i) => {
    const a = ctx.anios[i] || { total: 0, completas: 0 };
    return {
      id: "anio" + (i + 1), nombre: `Trofeo de ${t}`, medalla: "trofeo", emoji: "🏆",
      que: `Termina todas las pruebas de todas las asignaturas de ${t}`,
      meta: Math.max(1, a.total), actual: a.completas, ok: a.total > 0 && a.completas >= a.total,
      falta: a.total ? faltan(a.total - a.completas, "asignatura", "asignaturas") : "Este año todavía no tiene asignaturas",
    };
  });
}

/** Lista de logros con su estado (para la pantalla Logros). */
export function listaDeLogros(ctx) {
  const e = leer();
  const lista = LOGROS.map((l) => {
    const actual = Math.min(l.meta, l.valor(ctx));
    const ok = !!e.desbloqueados[l.id] || actual >= l.meta;
    return { ...l, actual, ok, fecha: e.desbloqueados[l.id], faltaTexto: ok ? "" : l.falta(l.meta - actual, ctx) };
  });
  const trof = trofeos(ctx).map((t) => ({ ...t, ok: !!e.desbloqueados[t.id] || t.ok, fecha: e.desbloqueados[t.id], faltaTexto: t.falta }));
  return { logros: lista, trofeos: trof };
}

/** Revisa qué logros nuevos se ganaron, los guarda y avisa con una animación. Devuelve los nuevos. */
export function revisar(ctx, avisar = true) {
  const e = leer();
  const { logros, trofeos: trof } = listaDeLogros(ctx);
  const nuevos = [...logros, ...trof].filter((l) => l.ok && !e.desbloqueados[l.id]);
  if (!nuevos.length && !subioNivel) return [];
  for (const l of nuevos) e.desbloqueados[l.id] = Date.now();
  guardar(e);
  if (avisar) {
    for (const l of nuevos) avisoLogro(`${l.medalla === "trofeo" ? "¡Trofeo especial!" : "¡Logro desbloqueado!"}`, l.nombre, l.emoji, l.medalla);
    if (subioNivel) avisoLogro("¡Subiste de nivel!", subioNivel.nombre, subioNivel.emoji, "nivel");
  }
  subioNivel = null;
  return nuevos;
}

// ---------- Aviso animado (aparece en cualquier pantalla) ----------
const cola = [];
let mostrando = false;
export function avisoLogro(titulo, nombre, emoji, medalla) {
  cola.push({ titulo, nombre, emoji, medalla });
  if (!mostrando) siguienteAviso();
}
function siguienteAviso() {
  const a = cola.shift();
  if (!a) return (mostrando = false);
  mostrando = true;
  const el = document.createElement("div");
  el.className = `aviso-logro medalla-${a.medalla}`;
  el.setAttribute("role", "status");
  el.innerHTML = `<span class="aviso-logro-medalla">${a.emoji}</span>
    <span><small>${esc(a.titulo)}</small><b>${esc(a.nombre)}</b></span>`;
  document.body.appendChild(el);
  tono([784, 988, 1175], 0.1, 0.12);
  requestAnimationFrame(() => el.classList.add("visible"));
  setTimeout(() => {
    el.classList.remove("visible");
    setTimeout(() => { el.remove(); siguienteAviso(); }, 450);
  }, 3200);
}

// ---------- Sonidos ----------
let audio = null;
function tono(notas, paso = 0.12, volumen = 0.16) {
  try {
    if (localStorage.getItem("finlay.sonido") === "0") return;
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    audio.resume?.();
    notas.forEach((f, i) => {
      const o = audio.createOscillator();
      const g = audio.createGain();
      const t = audio.currentTime + i * paso;
      o.type = "triangle";
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(volumen, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      o.connect(g).connect(audio.destination);
      o.start(t);
      o.stop(t + 0.45);
    });
  } catch {}
}

// ---------- Pantalla de celebración ----------
export function mensajeSegun(pct) {
  if (pct >= 90) return { titulo: "¡Excelente, futuro doctor!", emoji: "🏆", animo: "Dominas este tema. ¡Sigue brillando!" };
  if (pct >= 70) return { titulo: "¡Muy bien, sigue así!", emoji: "⭐", animo: "Vas por buen camino. Repasa lo que fallaste y llegarás al 100 %." };
  return { titulo: "¡No te rindas, cada intento cuenta!", emoji: "💪", animo: "Revisa dónde está cada respuesta (📖) y vuelve a intentarlo." };
}

/**
 * Muestra la celebración al terminar una prueba.
 * datos: { titulo, acertadas, total, pct, puntosGanados, nuevos: [logros], nota?, otraVez?: href }
 */
export function celebrar(datos) {
  const pct = datos.pct ?? Math.round((datos.acertadas / Math.max(1, datos.total)) * 100);
  const m = mensajeSegun(pct);
  const e = leer();
  const nv = nivelDe(e.puntos);
  const capa = document.createElement("div");
  capa.className = "celebracion";
  capa.setAttribute("role", "dialog");
  capa.setAttribute("aria-label", m.titulo);
  capa.innerHTML = `<canvas class="confeti"></canvas>
    <div class="celebracion-tarjeta">
      <div class="celebracion-emoji">${m.emoji}</div>
      <h2>${esc(m.titulo)}</h2>
      <p class="celebracion-sub">${esc(datos.titulo || "")}</p>
      <div class="celebracion-nota">${datos.nota ? `<b class="nota-num n${datos.nota}">${datos.nota}</b>` : ""}
        <span><b>${pct} %</b> de aciertos · ${datos.acertadas} de ${datos.total}</span></div>
      <p class="celebracion-puntos">+${datos.puntosGanados} puntos</p>
      <div class="nivel-barra-caja"><span>${nv.emoji} ${esc(nv.nombre)}</span>
        <span class="nivel-barra"><span style="width:${nv.pct}%"></span></span>
        <span class="sub">${nv.siguiente ? `${nv.faltan} puntos para ${esc(nv.siguiente.nombre)}` : "¡Nivel máximo!"}</span></div>
      ${datos.nuevos?.length ? `<div class="celebracion-logros"><b>Logros desbloqueados</b>${datos.nuevos.map((l) =>
        `<span class="logro-mini medalla-${l.medalla}">${l.emoji} ${esc(l.nombre)}</span>`).join("")}</div>` : ""}
      <p class="nota">${esc(m.animo)}</p>
      <div class="celebracion-botones">
        ${datos.otraVez ? `<a class="btn secundario" href="${datos.otraVez}" data-cerrar>Otra vez</a>` : ""}
        <button class="btn btn-grande-mini" data-cerrar>Continuar</button>
      </div>
    </div>`;
  document.body.appendChild(capa);
  capa.addEventListener("click", (ev) => {
    if (ev.target.closest("[data-cerrar]")) cerrar();
  });
  const cerrar = () => {
    capa.classList.add("saliendo");
    setTimeout(() => capa.remove(), 300);
  };
  requestAnimationFrame(() => capa.classList.add("visible"));
  if (pct >= 70) tono([523, 659, 784, 1047, 784, 1047], 0.13, 0.18);
  else tono([523, 440, 349], 0.2, 0.2); // nota baja: tres notas que bajan
  confeti(capa.querySelector("canvas"), pct >= 90 ? 160 : pct >= 70 ? 100 : 45, pct >= 70);
  return capa;
}

/** Confeti (o estrellas) que cae unos segundos. Ligero: un solo lienzo. */
function confeti(lienzo, cantidad, colores) {
  const ctx = lienzo.getContext("2d");
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const ajustar = () => {
    lienzo.width = innerWidth * dpr;
    lienzo.height = innerHeight * dpr;
  };
  ajustar();
  const paleta = colores ? ["#2ee6dc", "#14b8c4", "#facc15", "#f2962e", "#e5408f", "#9b4fe0", "#4ade80"] : ["#facc15", "#fde68a", "#ffffff"];
  const piezas = Array.from({ length: cantidad }, () => ({
    x: Math.random() * lienzo.width, y: -Math.random() * lienzo.height * 0.6,
    vx: (Math.random() - 0.5) * 3 * dpr, vy: (2 + Math.random() * 4) * dpr,
    r: (4 + Math.random() * 6) * dpr, giro: Math.random() * 6, vg: (Math.random() - 0.5) * 0.3,
    color: paleta[Math.floor(Math.random() * paleta.length)], estrella: !colores || Math.random() < 0.25,
  }));
  const inicio = performance.now();
  const paso = (t) => {
    if (!lienzo.isConnected) return;
    const dt = t - inicio;
    ctx.clearRect(0, 0, lienzo.width, lienzo.height);
    ctx.globalAlpha = dt > 3000 ? Math.max(0, 1 - (dt - 3000) / 1200) : 1;
    for (const p of piezas) {
      p.x += p.vx; p.y += p.vy; p.vy += 0.04 * dpr; p.giro += p.vg;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.giro); ctx.fillStyle = p.color;
      if (p.estrella) {
        ctx.beginPath();
        for (let k = 0; k < 10; k++) {
          const rr = k % 2 ? p.r * 0.45 : p.r;
          ctx.lineTo(Math.cos((k * Math.PI) / 5) * rr, Math.sin((k * Math.PI) / 5) * rr);
        }
        ctx.fill();
      } else ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2);
      ctx.restore();
    }
    if (dt < 4200) requestAnimationFrame(paso);
    else ctx.clearRect(0, 0, lienzo.width, lienzo.height);
  };
  requestAnimationFrame(paso);
}
