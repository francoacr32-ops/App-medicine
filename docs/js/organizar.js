// Organización automática de los materiales nuevos: decide la asignatura (y su año) y el tipo
// (conferencia, clase taller, libro o material de consulta) a partir del nombre del archivo y del
// texto de sus primeras páginas. Si no está seguro, deja que el estudiante elija.

const sinTildes = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Palabras que delatan cada asignatura (sin tildes). Las del nombre del archivo pesan más.
const PISTAS = [
  ["celula", ["celula", "histolog", "tejido", "epiteli", "conectivo", "cartilag", "tegument", "piel", "organit", "microscop", "citoplasma", "nucleo celular"]],
  ["molecular", ["molecular", "biomolecul", "proteina", "aminoacid", "enzima", "adn", "arn", "lipido", "glucido", "carbohidrat", "nucleotid", "replicacion", "transcripcion", "traduccion"]],
  ["ontogenia", ["ontogenia", "embrio", "fecundacion", "gastrulacion", "osteolog", "artrolog", "miolog", "locomotor", "soma", "articulacion", "esqueleto"]],
  ["nervioso", ["nervios", "neurona", "sinapsis", "encefalo", "medula espinal", "hormona", "endocrin", "hipofisis", "tiroides", "reproduct", "ovario", "testiculo"]],
  ["metabol", ["metabol", "nutricion", "glucolisis", "krebs", "vitamina", "catabol", "anabol", "lipoprotein", "gluconeogenesis"]],
  ["sangre", ["sangre", "hemat", "eritrocit", "leucocit", "plaqueta", "inmun", "anticuerpo", "linfocit", "coagulacion", "hemoglobina"]],
  ["cardiovascular", ["cardiovascular", "corazon", "cardiac", "arteria", "respirator", "pulmon", "digestiv", "estomago", "intestin", "higado", "renal", "rinon", "nefrona"]],
  ["psicolog", ["psicolog", "conducta", "personalidad", "emocion", "relacion medico"]],
  ["genetic", ["genetic", "herencia", "cromosom", "mendel", "mutacion", "cariotipo"]],
  ["microbiolog", ["microbiolog", "bacteria", "virus", "hongo", "parasit", "esteriliz", "antimicrobian"]],
  ["medicina interna", ["medicina interna", "hipertension", "diabetes", "insuficiencia cardiaca", "neumonia", "asma"]],
  ["propedeutica", ["propedeutica", "semiolog", "sintoma", "examen fisico", "interrogatorio", "anamnesis", "historia clinica"]],
  ["pediatr", ["pediatr", "lactante", "recien nacido", "neonat", "crecimiento y desarrollo", "puericultura"]],
  ["ginecolog", ["ginecolog", "obstetric", "embarazo", "parto", "gestacion", "puerperio", "menstrua"]],
  ["cirug", ["cirug", "quirurg", "sutura", "abdomen agudo", "preoperatori", "postoperatori"]],
  ["oftalmolog", ["oftalmolog", "ojo", "vision", "retina", "glaucoma", "catarata"]],
  ["medicina general integral", ["medicina general integral", "mgi", "atencion primaria", "consultorio", "dispensarizacion", "medicina familiar"]],
  ["comunidad", ["comunidad", "trabajo medico"]],
  ["salud publica", ["salud publica", "epidemiolog", "indicadores de salud", "vigilancia", "sanitari", "prevencion", "promocion de salud", "poblacion", "medicina social", "historia de la medicina", "determinantes"]],
  ["tecnologia", ["ciencia, tecnologia", "ciencia tecnologia", "cts"]],
];

// Libros de texto cubanos (Editorial Ciencias Médicas, ECIMED) de cada asignatura.
// Lista dada por el estudiante; la de Psicología, Genética, Salud Pública y CTS está por confirmar.
export const LIBROS = [
  { titulo: "Morfofisiología (tomos I y II)", autor: "Colectivo de autores", pistas: ["morfofisiologia"], asigs: ["ontogenia", "celula", "molecular", "nervioso", "metabol", "sangre", "cardiovascular"] },
  { titulo: "Embriología Humana", autor: "Armando Valdés Valdés", pistas: ["embriologia humana", "valdes valdes"], asigs: ["ontogenia"] },
  { titulo: "Bioquímica Médica", autor: "Cardellá y Hernández", pistas: ["cardella", "bioquimica medica"], asigs: ["molecular", "metabol"] },
  { titulo: "Psicología Médica", autor: "Núñez de Villavicencio", pistas: ["villavicencio", "psicologia medica"], asigs: ["psicolog"], porConfirmar: true },
  { titulo: "Introducción a la Genética Médica", autor: "Lantigua Cruz", pistas: ["lantigua", "genetica medica"], asigs: ["genetic"], porConfirmar: true },
  { titulo: "Microbiología y Parasitología Médicas", autor: "Llop Hernández", pistas: ["llop", "parasitologia medica"], asigs: ["microbiolog"] },
  { titulo: "Temas de Medicina Interna", autor: "Roca Goderich", pistas: ["roca goderich", "goderich", "temas de medicina interna"], asigs: ["medicina interna"] },
  { titulo: "Propedéutica Clínica y Semiología Médica", autor: "Llanio Navarro", pistas: ["llanio"], asigs: ["propedeutica"] },
  { titulo: "Pediatría", autor: "Valdés Martín y Gómez Vasallo", pistas: ["valdes martin", "gomez vasallo"], asigs: ["pediatr"] },
  { titulo: "Obstetricia y Ginecología", autor: "Rigol Ricardo", pistas: ["rigol"], asigs: ["ginecolog"] },
  { titulo: "Cirugía", autor: "García Gutiérrez y Pardo Gómez", pistas: ["garcia gutierrez", "pardo gomez"], asigs: ["cirug"] },
  { titulo: "Oftalmología", autor: "Alemañy Martorell y Villar Valdés", pistas: ["alemany", "villar valdes"], asigs: ["oftalmolog"] },
  { titulo: "Medicina General Integral", autor: "Álvarez Sintes", pistas: ["alvarez sintes"], asigs: ["medicina general integral", "comunidad"] },
  { titulo: "Fundamentos de Salud Pública", autor: "Toledo Curbelo", pistas: ["toledo curbelo", "fundamentos de salud publica"], asigs: ["salud publica"], porConfirmar: true },
  { titulo: "Lecturas de Filosofía, Salud y Sociedad", autor: "Colectivo de autores", pistas: ["filosofia, salud y sociedad", "filosofia salud y sociedad"], asigs: ["tecnologia"], porConfirmar: true },
];
/** Libros de texto de una asignatura (por su nombre) */
export function librosDe(nombreAsignatura) {
  const n = sinTildes(nombreAsignatura);
  return LIBROS.filter((l) => l.asigs.some((c) => n.includes(c)));
}
/** ¿El archivo es uno de los libros de texto? Devuelve el libro o null */
export function libroConocido(nombreArchivo, texto = "") {
  const t = sinTildes(nombreArchivo).replace(/[_\-.]+/g, " ") + " " + sinTildes(texto).slice(0, 4000);
  return LIBROS.find((l) => l.pistas.some((p) => t.includes(p))) || null;
}

function cuenta(texto, palabra) {
  if (palabra.length <= 3) return (texto.match(new RegExp(`\\b${palabra}\\b`, "g")) || []).length; // "adn", "cts", "ojo"…
  let n = 0, i = 0;
  while ((i = texto.indexOf(palabra, i)) >= 0) { n++; i += palabra.length; }
  return n;
}

/** Tipo de material según el nombre del archivo, el formato y el número de páginas */
export function tipoDeMaterial(nombreArchivo, paginas = 0) {
  const n = sinTildes(nombreArchivo);
  if (libroConocido(nombreArchivo)) return "libro";
  if (/clase\s*taller|\bct\s*\d|\btaller\b/.test(n)) return "taller";
  if (/formulario|vademecum|valores (normales|de referencia)|protocolo|manual|guia de (practica|actuacion)/.test(n)) return "consulta";
  if (/\blibro\b|\btomo\b|capitulo|texto basico|\bcap\.?\s*\d/.test(n)) return "libro";
  if (/\.pptx?$/.test(n)) return "conferencia";
  if (paginas > 80) return "libro";
  return "conferencia";
}

/**
 * Asignatura más probable. asignaturas: [{id, anio, nombre}]. Devuelve { asig, seguridad (0..1) }.
 * Pesa 4 veces más lo que aparece en el nombre del archivo que en el texto.
 */
export function asignaturaProbable(nombreArchivo, texto, asignaturas) {
  const nombre = sinTildes(nombreArchivo).replace(/[_\-.]+/g, " ");
  const cuerpo = sinTildes(texto).slice(0, 20000);
  const puntos = new Map();
  for (const a of asignaturas) {
    const n = sinTildes(a.nombre);
    let p = 0;
    // el nombre completo de la asignatura en el archivo o en la portada
    if (nombre.includes(n)) p += 30;
    // en el texto, un nombre largo ("Ginecología y Obstetricia") es buena pista; uno corto ("Cirugía") puede ser de paso
    if (cuerpo.includes(n)) p += n.length > 15 ? 12 : 3;
    for (const [clave, palabras] of PISTAS) {
      if (!n.includes(clave)) continue;
      for (const w of palabras) p += 4 * cuenta(nombre, w) + Math.min(6, cuenta(cuerpo, w));
    }
    // uno de los libros de texto de esta asignatura (por título o autor)
    const libro = libroConocido(nombreArchivo, texto);
    if (libro && libro.asigs.some((c) => n.includes(c))) p += libro.asigs.length > 2 ? 10 : 30;
    // MGI está en 5to y 6to: el internado es de 6to
    if (n.includes("medicina general integral")) p += (a.anio === 6) === /internado/.test(nombre + " " + cuerpo.slice(0, 3000)) ? 2 : 0;
    if (p) puntos.set(a.id, p);
  }
  const orden = [...puntos.entries()].sort((x, y) => y[1] - x[1]);
  if (!orden.length) return { asig: null, seguridad: 0 };
  const [mejor, pMejor] = orden[0];
  const pSegundo = orden[1]?.[1] || 0;
  const seguridad = Math.min(1, pMejor / 20) * (pMejor > 0 ? 1 - pSegundo / (pMejor * 2) : 0);
  return { asig: asignaturas.find((a) => a.id === mejor), seguridad };
}

/** Nombre limpio para mostrar: sin extensión ni guiones bajos */
export function nombreLimpio(nombreArchivo) {
  return nombreArchivo.replace(/\.(pdf|docx|pptx|txt)$/i, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
}
