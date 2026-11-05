// Tiempo de estudio: UNA sola tabla de sesiones y UNA sola función de cálculo.
//
// Cada sesión es un tramo { i: inicio (ms), f: fin (ms), e: true si es estimado }.
// - Mientras la app está abierta y en uso, el tramo abierto se alarga y se guarda cada 15 s
//   y también al pasar a segundo plano (visibilitychange/pagehide). Si la app se cierra de golpe,
//   como mucho se pierden 15 s.
// - Todas las cifras (hoy, gráfica, franjas del día, totales) salen de analizar(), que corta cada
//   tramo en las horas locales: así un tramo de 11:50 a 12:10 cuenta 10 min en la mañana y 10 en la
//   tarde, y la suma de las franjas siempre es igual al total.
// - Los días con preguntas respondidas pero sin tiempo guardado (de antes de que existiera este
//   registro) reciben un tiempo estimado a partir de la hora de las respuestas.

export const CLAVE = "finlay.sesiones";
const CLAVE_MARCAS = "finlay.marcas";     // hora de cada respuesta (para estimar si falta tiempo)
const TICK = 15000;                       // cada cuánto se guarda
const PAUSA = 5 * 60000;                  // sin tocar la pantalla 5 min = deja de contar
const UNIR = 60000;                       // tramos separados por menos de 1 min se unen
const DIAS_GUARDADOS = 400;
export const SEG_ESTIMADO_POR_PREGUNTA = 45;
const MAX_ENTRE_RESPUESTAS = 90;          // al estimar, un hueco entre respuestas cuenta como mucho 90 s

export const FRANJAS = [
  { id: "madrugada", nombre: "Madrugada", emoji: "🌙", de: 0, a: 6 },
  { id: "manana", nombre: "Mañana", emoji: "🌅", de: 6, a: 12 },
  { id: "tarde", nombre: "Tarde", emoji: "☀️", de: 12, a: 18 },
  { id: "noche", nombre: "Noche", emoji: "🌆", de: 18, a: 24 },
];
const franjaDeHora = (h) => FRANJAS.findIndex((x) => h >= x.de && h < x.a);

/** Fecha local "AAAA-MM-DD" (igual que db.hoy) */
export function fechaLocal(ms) {
  const d = new Date(ms);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
/** Medianoche local del día "AAAA-MM-DD" (en ms) */
export function inicioDelDia(fecha) {
  const [a, m, d] = fecha.split("-").map(Number);
  return new Date(a, m - 1, d).getTime();
}
function siguienteHora(ms) {
  const d = new Date(ms);
  d.setMinutes(60, 0, 0);
  return d.getTime();
}

// ---------- Guardado ----------
function leer(clave) {
  try { return JSON.parse(localStorage.getItem(clave) || "[]"); } catch { return []; }
}
function escribir(clave, v) {
  try { localStorage.setItem(clave, JSON.stringify(v)); } catch {}
}
export function sesiones() {
  return leer(CLAVE);
}
function guardarSesiones(lista) {
  const limite = Date.now() - DIAS_GUARDADOS * 86400000;
  escribir(CLAVE, lista.filter((t) => t.f > limite));
}

// ---------- Registro mientras se usa la app ----------
let ultimaActividad = 0;
let abierto = false; // ¿el último tramo guardado es el que está en curso?

function extender(ahora, desdeActividad) {
  const lista = sesiones();
  const ultimo = lista[lista.length - 1];
  if (abierto && ultimo && !ultimo.e && !ultimo.m && ahora - ultimo.f <= PAUSA + TICK) {
    ultimo.f = Math.max(ultimo.f, ahora);
  } else if (desdeActividad) {
    if (ultimo && !ultimo.e && !ultimo.m && ahora - ultimo.f <= UNIR) ultimo.f = ahora; // pausa corta: mismo tramo
    else lista.push({ i: ahora, f: ahora });
    abierto = true;
  } else return;
  guardarSesiones(lista);
}
function cerrar() {
  if (!abierto) return;
  const fin = Math.min(Date.now(), ultimaActividad + PAUSA);
  const lista = sesiones();
  const ultimo = lista[lista.length - 1];
  if (ultimo && !ultimo.e && !ultimo.m) ultimo.f = Math.max(ultimo.f, fin);
  guardarSesiones(lista);
  abierto = false;
}
export function marcarActividad() {
  const ahora = Date.now();
  const antes = ultimaActividad;
  ultimaActividad = ahora;
  // no escribir en cada movimiento: solo si empieza un tramo o pasaron unos segundos
  if (!abierto || ahora - antes > 5000) extender(ahora, true);
}
/** Cada respuesta deja su hora (para estimar el tiempo si alguna vez faltara) */
export function marcarRespuesta() {
  marcarActividad();
  const marcas = leer(CLAVE_MARCAS);
  marcas.push(Date.now());
  const limite = Date.now() - 120 * 86400000;
  escribir(CLAVE_MARCAS, marcas.filter((t) => t > limite));
}
export function marcasDeRespuestas() {
  return leer(CLAVE_MARCAS);
}

export function iniciarRegistro() {
  for (const e of ["pointerdown", "keydown", "scroll", "touchstart", "wheel"])
    addEventListener(e, marcarActividad, { passive: true, capture: true });
  setInterval(() => {
    if (document.hidden) return;
    if (Date.now() - ultimaActividad > PAUSA) return cerrar();
    extender(Date.now(), false);
  }, TICK);
  document.addEventListener("visibilitychange", () => (document.hidden ? cerrar() : marcarActividad()));
  addEventListener("pagehide", cerrar);
  addEventListener("freeze", cerrar);
  if (!document.hidden) marcarActividad();
}

// ---------- Estimación para días sin tiempo guardado ----------
/**
 * Tramos estimados a partir de la hora de las respuestas: cada respuesta cuenta el hueco desde la
 * anterior (como mucho 90 s), y la primera de cada grupo 45 s.
 */
export function tramosDesdeRespuestas(horas) {
  const t = [...horas].sort((a, b) => a - b);
  const salida = [];
  t.forEach((h, k) => {
    const hueco = k ? (h - t[k - 1]) / 1000 : Infinity;
    const seg = hueco <= MAX_ENTRE_RESPUESTAS ? hueco : SEG_ESTIMADO_POR_PREGUNTA;
    const ultimo = salida[salida.length - 1];
    if (ultimo && h - seg * 1000 <= ultimo.f) ultimo.f = h;
    else salida.push({ i: h - seg * 1000, f: h, e: true });
  });
  return salida;
}

/**
 * Para cada día con preguntas (según el diario) que no tiene tiempo registrado, crea tramos
 * estimados. Usa la hora real de las respuestas de ese día; si se conocen menos horas que preguntas,
 * reparte el resto entre las horas conocidas; si no se conoce ninguna, lo pone a las 12:00.
 */
export function estimarFaltantes(tramos, diario, horasDeRespuestas) {
  const conTiempo = new Map();
  for (const t of tramos) {
    let c = t.i;
    while (c < t.f) {
      const corte = Math.min(t.f, siguienteHora(c));
      conTiempo.set(fechaLocal(c), (conTiempo.get(fechaLocal(c)) || 0) + (corte - c) / 1000);
      c = corte;
    }
  }
  const porDia = new Map();
  for (const h of horasDeRespuestas) {
    const f = fechaLocal(h);
    if (!porDia.has(f)) porDia.set(f, []);
    porDia.get(f).push(h);
  }
  const extra = [];
  for (const d of diario) {
    if (!d.preguntas || (conTiempo.get(d.fecha) || 0) >= 1) continue;
    const horas = [...new Set(porDia.get(d.fecha) || [])];
    let nuevos = horas.length ? tramosDesdeRespuestas(horas) : [];
    const faltan = d.preguntas - horas.length;
    if (faltan > 0) {
      const seg = faltan * SEG_ESTIMADO_POR_PREGUNTA * 1000;
      if (nuevos.length) {
        // alarga los tramos conocidos, repartiendo el tiempo de las preguntas sin hora
        const total = nuevos.reduce((s, t) => s + (t.f - t.i), 0) || 1;
        nuevos = nuevos.map((t) => ({ ...t, i: t.i - seg * ((t.f - t.i) / total) }));
      } else {
        const mediodia = inicioDelDia(d.fecha) + 12 * 3600000;
        nuevos = [{ i: mediodia, f: mediodia + seg, e: true }];
      }
    }
    // que no se salga del día
    const desde = inicioDelDia(d.fecha);
    for (const t of nuevos) extra.push({ ...t, i: Math.max(desde, t.i) });
  }
  return extra;
}

// ---------- La función de cálculo (fuente única) ----------
/**
 * Reparte los tramos entre días, horas y franjas, cortando en cada hora local.
 * desde/hasta (ms) limitan el período. Devuelve segundos.
 */
export function analizar(tramos, { desde = -Infinity, hasta = Infinity } = {}) {
  const porDia = {};
  const porHora = new Array(24).fill(0);
  const porFranja = new Array(FRANJAS.length).fill(0);
  let total = 0, estimado = 0, horaAproximada = 0;
  const seg1 = (ms) => Math.round(ms / 1000) * 1000; // en segundos enteros: las sumas cuadran exactas
  for (const t of tramos) {
    let c = seg1(Math.max(t.i, desde));
    const fin = seg1(Math.min(t.f, hasta));
    while (c < fin) {
      const corte = Math.min(fin, siguienteHora(c));
      const seg = (corte - c) / 1000;
      const h = new Date(c).getHours();
      const f = fechaLocal(c);
      porDia[f] = (porDia[f] || 0) + seg;
      porHora[h] += seg;
      porFranja[franjaDeHora(h)] += seg;
      total += seg;
      if (t.e) estimado += seg;
      if (t.m) horaAproximada += seg;
      c = corte;
    }
  }
  return { total, porDia, porHora, porFranja, estimado, horaAproximada };
}

/** Minutos enteros de varias partes que suman exactamente los minutos redondeados del total */
export function minutosRepartidos(segundos) {
  const total = Math.round(segundos.reduce((s, x) => s + x, 0) / 60);
  const exactos = segundos.map((s) => s / 60);
  const base = exactos.map(Math.floor);
  let resto = total - base.reduce((s, x) => s + x, 0);
  const orden = exactos.map((x, k) => [x - Math.floor(x), k]).sort((a, b) => b[0] - a[0]);
  for (let j = 0; resto > 0 && j < orden.length; j++, resto--) base[orden[j][1]]++;
  return { total, partes: base };
}

/** "1 h 5 min" a partir de minutos enteros */
export function textoMinutos(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`;
}

// ---------- Datos viejos (antes de esta versión) ----------
/**
 * Convierte el tiempo guardado por día (finlay.tiempo) en tramos, colocados a la hora de las
 * respuestas de ese día (o según finlay.horas). Se hace una sola vez.
 */
export function migrarDatosViejos(horasDeRespuestas) {
  let viejo = {}, horas = {};
  try { viejo = JSON.parse(localStorage.getItem("finlay.tiempo") || "{}"); } catch {}
  try { horas = JSON.parse(localStorage.getItem("finlay.horas") || "{}"); } catch {}
  if (localStorage.getItem("finlay.sesiones.migrado") || !Object.keys(viejo).length) {
    try { localStorage.setItem("finlay.sesiones.migrado", "1"); } catch {}
    return 0;
  }
  const porDia = new Map();
  for (const h of horasDeRespuestas) {
    const f = fechaLocal(h);
    if (!porDia.has(f)) porDia.set(f, []);
    porDia.get(f).push(h);
  }
  const totalHoras = Object.values(horas).reduce((s, x) => s + x, 0);
  const nuevos = [];
  for (const [fecha, seg] of Object.entries(viejo)) {
    if (!seg) continue;
    const resp = (porDia.get(fecha) || []).sort((a, b) => a - b);
    if (resp.length) {
      // grupos de respuestas separados por más de 10 min; cada grupo recibe su parte del tiempo
      const grupos = [];
      for (const h of resp) {
        const g = grupos[grupos.length - 1];
        if (g && h - g[g.length - 1] < 600000) g.push(h); else grupos.push([h]);
      }
      for (const g of grupos) {
        const parte = (seg * g.length) / resp.length;
        const fin = g[g.length - 1];
        nuevos.push({ i: Math.max(inicioDelDia(fecha), fin - parte * 1000), f: fin, m: true });
      }
    } else {
      // sin respuestas ese día: se reparte según las horas en que suele estudiar (o a mediodía)
      const base = inicioDelDia(fecha);
      const reparto = totalHoras ? Object.entries(horas) : [["12", 1]];
      const suma = totalHoras || 1;
      for (const [h, v] of reparto) {
        const parte = (seg * v) / suma;
        if (parte < 1) continue;
        const i = base + Number(h) * 3600000;
        nuevos.push({ i, f: i + Math.min(parte, 3600) * 1000, m: true });
      }
    }
  }
  const lista = [...nuevos, ...sesiones()].sort((a, b) => a.i - b.i);
  guardarSesiones(lista);
  try { localStorage.setItem("finlay.sesiones.migrado", "1"); } catch {}
  return nuevos.length;
}
