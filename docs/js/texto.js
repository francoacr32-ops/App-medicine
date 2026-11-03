// Utilidades de texto: normalizar (sin tildes ni mayúsculas) y partir en fragmentos.

const SIN_TILDE = {
  á: "a", à: "a", ä: "a", â: "a", é: "e", è: "e", ë: "e", ê: "e",
  í: "i", ì: "i", ï: "i", î: "i", ó: "o", ò: "o", ö: "o", ô: "o",
  ú: "u", ù: "u", ü: "u", û: "u", ñ: "n", ç: "c",
};

/**
 * Convierte el texto a minúsculas, sin tildes, y cambia los signos por espacios.
 * Conserva la misma longitud que el original, para poder resaltar palabras.
 */
export function normalizar(texto) {
  let r = "";
  for (const c of texto) {
    let l = c.toLowerCase();
    if (l.length !== 1) l = " ";
    l = SIN_TILDE[l] || l;
    if (!/[a-z0-9]/.test(l)) l = " ";
    // Los caracteres fuera del plano básico ocupan 2 posiciones en JS
    r += c.length === 2 ? l + " " : l;
  }
  return r;
}

const PALABRAS_VACIAS = new Set(
  ("a al algo algun alguna algunas alguno algunos ante antes aqui asi aun cada como con contra cual cuales " +
   "cuando de del desde donde dos e el ella ellas ello ellos en entre era eran es esa esas ese eso esos esta " +
   "estan estas este esto estos fue fueron ha han hasta hay la las le les lo los mas me mi mis muy ni no nos " +
   "o otra otras otro otros para pero poco por porque que quien quienes se sea segun ser si sin sobre son su " +
   "sus tambien tan tanto te tiene tienen todo todos tu tus u un una unas uno unos y ya yo cual cuales " +
   "explica explicame define definicion dime describe describeme hablame sobre significa concepto cuales").split(" ")
);

/** Raíz sencilla para que "células" encuentre "célula" y "funciones" encuentre "función". */
export function raiz(palabra) {
  if (palabra.length > 5 && palabra.endsWith("es")) return palabra.slice(0, -2);
  if (palabra.length > 4 && palabra.endsWith("s")) return palabra.slice(0, -1);
  return palabra;
}

/** Palabras importantes de una pregunta, ya normalizadas y reducidas a su raíz. */
export function terminosDeBusqueda(consulta) {
  const vistos = new Set();
  return normalizar(consulta)
    .split(/\s+/)
    .filter((p) => p.length > 1 && !PALABRAS_VACIAS.has(p))
    .map(raiz)
    .filter((p) => (vistos.has(p) ? false : vistos.add(p)));
}

/** Limpia el texto extraído de un PDF (une palabras cortadas con guion, quita espacios de más). */
export function limpiar(texto) {
  return texto
    .replace(/\r/g, "")
    .replace(/(\p{L})-\n(\p{Ll})/gu, "$1$2")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const TAMANO_FRAGMENTO = 900;

/** Parte el texto de una página en fragmentos de ~900 caracteres, respetando párrafos. */
export function fragmentarPagina(texto) {
  const parrafos = texto.split(/\n+/);
  const fragmentos = [];
  let actual = "";
  for (const p of parrafos) {
    if (actual && actual.length + p.length > TAMANO_FRAGMENTO) {
      fragmentos.push(actual);
      actual = "";
    }
    actual += (actual ? "\n" : "") + p;
    while (actual.length > TAMANO_FRAGMENTO * 1.6) {
      // Párrafo enorme: cortar en un espacio
      let corte = actual.lastIndexOf(" ", TAMANO_FRAGMENTO);
      if (corte < TAMANO_FRAGMENTO / 2) corte = TAMANO_FRAGMENTO;
      fragmentos.push(actual.slice(0, corte));
      actual = actual.slice(corte).trimStart();
    }
  }
  if (actual.trim()) fragmentos.push(actual);
  return fragmentos;
}
