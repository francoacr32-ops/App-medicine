// Lectura en voz alta con la voz que ya trae el teléfono (gratis y sin internet).

const sintesis = window.speechSynthesis;
// En el APK de Android la voz la pone el teléfono a través del puente FinlayAndroid
const android = window.FinlayAndroid || null;
let alCambiar = () => {};
let cola = [];
let hablando = false;

export const disponible = !!sintesis || !!android;

if (android) {
  window.__finlayVozFin = () => {
    if (hablando) {
      hablando = false;
      alCambiar(false);
    }
  };
}

export function onCambio(fn) {
  alCambiar = fn;
}

function vozEspanol() {
  const voces = sintesis.getVoices();
  const preferidas = ["es-US", "es-MX", "es-419", "es-ES"];
  for (const lang of preferidas) {
    const v = voces.find((x) => x.lang.replace("_", "-") === lang);
    if (v) return v;
  }
  return voces.find((x) => x.lang.toLowerCase().startsWith("es")) || null;
}

/** Corta el texto en frases cortas: Chrome en Android corta los textos largos. */
function trocear(texto) {
  const frases = texto.replace(/\s+/g, " ").match(/[^.!?;:]+[.!?;:]*\s*/g) || [texto];
  const trozos = [];
  let actual = "";
  for (const f of frases) {
    if ((actual + f).length > 220 && actual) {
      trozos.push(actual);
      actual = "";
    }
    actual += f;
  }
  if (actual.trim()) trozos.push(actual);
  return trozos;
}

export function leer(texto, velocidad = 1) {
  if (android) {
    detener();
    if (!android.vozDisponible()) return;
    hablando = true;
    alCambiar(true);
    android.hablar(String(texto).replace(/\s+/g, " "), velocidad);
    return;
  }
  if (!sintesis) return;
  detener();
  const voz = vozEspanol();
  cola = trocear(texto).map((t) => {
    const u = new SpeechSynthesisUtterance(t);
    u.lang = voz ? voz.lang : "es-ES";
    if (voz) u.voice = voz;
    u.rate = velocidad;
    return u;
  });
  if (!cola.length) return;
  hablando = true;
  alCambiar(true);
  const ultimo = cola[cola.length - 1];
  ultimo.onend = () => {
    hablando = false;
    alCambiar(false);
  };
  cola.forEach((u) => {
    u.onerror = () => {
      hablando = false;
      alCambiar(false);
    };
    sintesis.speak(u);
  });
}

export function detener() {
  if (android) {
    android.detener();
    if (hablando) {
      hablando = false;
      alCambiar(false);
    }
    return;
  }
  if (!sintesis) return;
  cola = [];
  sintesis.cancel();
  if (hablando) {
    hablando = false;
    alCambiar(false);
  }
}

export function estaHablando() {
  return hablando;
}

// Algunas versiones de Chrome cargan las voces tarde
if (sintesis) sintesis.onvoiceschanged = () => {};
