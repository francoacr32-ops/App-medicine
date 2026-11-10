// Seguridad de Finlay: una sola llave de administrador.
//  - La app trae la llave PÚBLICA: con ella comprueba que un paquete, un mensaje o un código
//    de profesor fue firmado por el administrador. No sirve para firmar.
//  - La llave PRIVADA solo la tiene el administrador, en un archivo (.llave) que carga en su
//    teléfono. Con ella se abre el modo administrador y se firma lo que se publica.
// Firma: ECDSA P-256 con SHA-256 (WebCrypto), sin internet.

const PUBLICA = { kty: "EC", crv: "P-256", x: "eMv9H5EF2RTT7nV1Qi7qN1VlcCVnHuvEqyA006n7yp8", y: "QtRSFmlMVF5NhrE6p6LPWCmdVpeaaP3BaDelHN2DQ78" };
const ALG = { name: "ECDSA", namedCurve: "P-256" };
const FIRMA = { name: "ECDSA", hash: "SHA-256" };
const GUARDADA = "finlay.admin.llave";

const subtle = globalThis.crypto?.subtle;
const utf8 = (t) => new TextEncoder().encode(t);
const aB64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const deB64 = (t) => Uint8Array.from(atob(String(t).replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

let publica = null;
let privada = null; // solo en el teléfono del administrador

async function llavePublica() {
  if (!publica) publica = await subtle.importKey("jwk", PUBLICA, ALG, false, ["verify"]);
  return publica;
}

/** ¿La firma (base64url) de este texto es del administrador? */
export async function verificar(texto, firma) {
  if (!subtle || !firma) return false;
  try {
    return await subtle.verify(FIRMA, await llavePublica(), deB64(firma), utf8(texto));
  } catch {
    return false;
  }
}

/** Firma un texto con la llave del administrador (solo en modo administrador). */
export async function firmar(texto) {
  if (!privada) throw new Error("Solo el administrador puede firmar.");
  return aB64(await subtle.sign(FIRMA, privada, utf8(texto)));
}

export const esAdmin = () => !!privada;

/** Al abrir la app: si este teléfono tiene guardada la llave de administrador, se activa. */
export async function iniciar() {
  if (!subtle) return false;
  try {
    const jwk = JSON.parse(localStorage.getItem(GUARDADA) || "null");
    if (jwk) await activar(jwk);
  } catch {
    privada = null;
  }
  return esAdmin();
}

async function activar(jwk) {
  const llave = await subtle.importKey("jwk", jwk, ALG, false, ["sign"]);
  // Debe ser la pareja de la llave pública que trae la app
  const prueba = "finlay-" + Date.now();
  const firma = aB64(await subtle.sign(FIRMA, llave, utf8(prueba)));
  if (!(await verificar(prueba, firma))) throw new Error("Esta llave no es la del administrador de Finlay.");
  privada = llave;
}

/** Carga el archivo .llave y deja este teléfono en modo administrador. */
export async function cargarLlave(textoArchivo) {
  if (!subtle) throw new Error("Este teléfono no permite comprobar firmas.");
  let datos;
  try { datos = JSON.parse(textoArchivo); } catch { throw new Error("El archivo no es una llave de Finlay."); }
  if (datos?.formato !== "finlay-llave-admin" || !datos.jwk) throw new Error("El archivo no es una llave de Finlay.");
  await activar(datos.jwk);
  localStorage.setItem(GUARDADA, JSON.stringify(datos.jwk));
  return true;
}

/** Sale del modo administrador y borra la llave de este teléfono. */
export function quitarLlave() {
  privada = null;
  try { localStorage.removeItem(GUARDADA); } catch {}
}

// ---------- Paquetes firmados ----------
/** Texto exacto que se firma de un paquete: todo menos la propia firma. */
function textoDePaquete(paquete) {
  const { firma, ...resto } = paquete;
  return JSON.stringify(resto);
}
/** Devuelve el paquete con la firma del administrador. */
export async function firmarPaquete(paquete) {
  const limpio = JSON.parse(JSON.stringify(paquete)); // mismo orden de claves que verá quien lo lea
  delete limpio.firma;
  return { ...limpio, firma: { v: 1, sig: await firmar(textoDePaquete(limpio)) } };
}
/** ¿El paquete (ya leído) lo firmó el administrador? */
export async function paqueteFirmado(paquete) {
  return !!paquete?.firma?.sig && verificar(textoDePaquete(paquete), paquete.firma.sig);
}

// ---------- Códigos de profesor ----------
// Formato: PROF.<datos en base64>.<firma>. Los datos: { n: nombre, a: asignatura o "", h: vence (AAAA-MM-DD) }
export async function crearCodigoProfesor(nombre, asignatura = "", vence = "") {
  const datos = aB64(utf8(JSON.stringify({ n: String(nombre).trim(), a: String(asignatura).trim(), h: vence })));
  return `PROF.${datos}.${await firmar("prof:" + datos)}`;
}
/** Devuelve { nombre, asignatura, vence } si el código es válido y no ha vencido; si no, null. */
export async function leerCodigoProfesor(codigo) {
  const m = String(codigo || "").trim().replace(/\s+/g, "").match(/^PROF\.([\w-]+)\.([\w-]+)$/);
  if (!m || !(await verificar("prof:" + m[1], m[2]))) return null;
  try {
    const d = JSON.parse(new TextDecoder().decode(deB64(m[1])));
    if (d.h && d.h < new Date().toISOString().slice(0, 10)) return null;
    return { nombre: d.n, asignatura: d.a || "", vence: d.h || "" };
  } catch {
    return null;
  }
}
