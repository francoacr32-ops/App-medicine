// Cuestionario automático, sin internet: lee TODO el contenido de una conferencia (definiciones,
// listas con su título, frases con cifras y datos) y arma con él preguntas de completar, selección,
// marcar, enlazar y verdadero o falso. Es un BORRADOR: quien estudia puede quitar las malas.
import { tarjetasDeDefiniciones } from "./tarjetas.js";

const limpiar = (s) => String(s || "").replace(/\s+/g, " ").trim();
const corto = (s, n = 150) => (s.length > n ? s.slice(0, n).replace(/\s+\S*$/, "") + "…" : s);

/** Generador de azar con semilla (el mismo material da siempre el mismo cuestionario) */
function azarCon(semilla) {
  let h = 2166136261;
  for (const c of String(semilla)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function barajar(lista, azar) {
  const a = [...lista];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(azar() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Definiciones del texto: [{ termino, explicacion, frase, fuente }] */
export function definicionesDe(doc, paginas, maximo = 60) {
  return tarjetasDeDefiniciones(doc, unidas(paginas), maximo).map((t) => {
    const conVerbo = t.frente.startsWith("¿Qué ");
    const termino = limpiar(conVerbo ? t.frente.replace(/^¿Qué (es|son) /, "").replace(/\?$/, "") : t.frente);
    // explicación sin repetir el término: "X es Y" → "Y"
    let explicacion = limpiar(t.dorso);
    if (conVerbo) {
      const m = t.cita.match(/\s(es|son|se define como|se definen como|se denomina|se denominan|consiste en|constituye|constituyen)\s+(.+)$/i);
      if (m) explicacion = limpiar(m[2]);
    }
    return { termino, explicacion: explicacion.replace(/\.$/, ""), frase: limpiar(t.cita), fuente: t.fuente };
  }).filter((d) => d.termino.length >= 3 && d.termino.length <= 60 && d.explicacion.length >= 15 && d.termino.split(/\s+/).length <= 6 &&
    !VAGO.test(d.termino) && !VAGO.test(d.termino.split(/\s+/)[0]) && !ROTULO.test(d.termino + ":") && !GENERICO.test(d.termino) && !LIBRO.test(d.frase) &&
    !/^[A-ZÁÉÍÓÚÑ/ .]{1,6}$/.test(d.termino) && !/^(como|cuando|si|porque|aunque|donde|por|para|en|con|al|a)\s/i.test(d.termino) && !/[()]/.test(d.termino) && !/\s(que|de|del|en|y|o|a)$/i.test(d.termino) && !d.explicacion.includes("|"));
}

// ---------- Lectura del contenido: listas con título y frases con datos ----------
const GENERICO = /^(sumario|objetivos?|bibliograf[ií]a.*|introducci[oó]n|conclusiones?|estudio independiente|motivaci[oó]n|preguntas?( de comprobaci[oó]n)?|orientaciones.*|tarea.*|gracias.*|contenidos?|[ií]ndice|resumen|recordar|ejemplos?|notas?|actividad.*|evaluaci[oó]n|trabajo independiente.*|pr[oó]xim[ao] (clase|conferencia|actividad).*|literatura.*|texto b[aá]sico.*)[:.]?$/i;
const ROTULO = /^(asignatura|tema|t[ií]tulo|conferencia|clase|profesor[a]?|prof|dr[a]?|msc|autor(es)?|curso|a[nñ]o|semana|fecha|facultad|universidad|departamento|carrera|fuente|tomado de|figura|fig|tabla|imagen|foto)\b[^a-záéíóú]*[:.\s]/i;
// Rótulos que solos no dicen de qué se habla («Forma», «Función»…) y pies de foto
const VAGO = /^(formas?|n[uú]meros?|posici[oó]n|tama[nñ]os?|funci[oó]n(es)?|localizaci[oó]n|ubicaci[oó]n|situaci[oó]n|estructuras?( al m[loe])?|caracter[ií]sticas?( generales)?|tipos?|clasificaci[oó]n|composici[oó]n|color|origen|definici[oó]n|conceptos?|importancia|resultados?|causas?|consecuencias?|diferencias?|finalidad|generalidades|componentes|partes|elementos|otros|otras|adem[aá]s|proceso que|aspectos .*|tinci[oó]n|coloraci[oó]n|tarea|m ?\/? ?[eo]|microscop[ií]a .*)$/i;
const LIBRO = /\b(p[aá]gs?\.|p[aá]ginas? \d|edici[oó]n|editorial|et al|tomo [ivx\d]|cap[ií]tulo \d|ecimed|isbn|http|www\.|complet[ae] (el|la) (cuadro|tabla)|nombre y esquema)/i;
const PIE = /^(\(|micrograf[ií]a|fotomicrograf[ií]a|figura|imagen|esquema|observe|coloraci[oó]n|aumento|h\/e|l[aá]mina|foto|vista )/i;
const VINETA = /^([•·▪■□◦●○►✓✔➢➤\-–—*]|\d{1,2}[.)]|[a-z][.)])\s+/i;
const CORTADA = /(,|[-–]|(^|\s)(de|del|la|el|los|las|y|o|e|u|en|a|al|para|por|con|que|se|no|su|sus|un|una|es|son|como|entre|sobre|desde|hasta|según|está|están|más|muy|cada|sin|lo|le|les))$/i;
/** Une los renglones que el PDF o la diapositiva cortó a mitad de frase */
export function unirRenglones(texto) {
  const salida = [];
  for (const crudo of String(texto).split(/\n+/)) {
    const l = limpiar(crudo);
    if (!l) continue;
    const previa = salida[salida.length - 1];
    const sigue = previa !== undefined && !VINETA.test(l) &&
      (CORTADA.test(previa) || (/^[a-záéíóúñü(]/.test(l) && !/[.:;!?]$/.test(previa) && previa.length > 25));
    if (sigue) salida[salida.length - 1] = previa + " " + l;
    else salida.push(l);
  }
  return salida.join("\n");
}
const unidas = (paginas) => paginas.map((p) => ({ ...p, texto: unirRenglones(p.texto) }));
const sinVineta = (l) => limpiar(l).replace(/^([•·▪■□◦●○►✓✔➢➤\-–—*]|\d{1,2}[.)]|[a-z][.)])\s+/i, "");
const palabras = (t) => t.split(/\s+/).filter(Boolean).length;

/** Listas: una diapositiva (o un párrafo que termina en «:») con su título y sus elementos */
function listasDe(doc, paginas) {
  const listas = [];
  const vistos = new Set();
  const nombre = limpiar(doc.nombre || "").toLowerCase();
  for (const { pagina, texto } of unidas(paginas)) {
    const lineas = String(texto).split(/\n+/).map(sinVineta).filter((l) => l.length > 1);
    let titulo = null, items = [];
    const cerrar = () => {
      const unicos = [...new Set(items)].filter((x) => x.toLowerCase() !== (titulo || "").toLowerCase());
      const clave = (titulo || "").toLowerCase();
      if (titulo && unicos.length >= 2 && !vistos.has(clave) && !LIBRO.test(titulo) && !unicos.some((x) => LIBRO.test(x))) {
        vistos.add(clave);
        listas.push({ titulo, items: unicos.slice(0, 8), fuente: `${doc.etiqueta || "pág."} ${pagina}` });
      }
      items = [];
    };
    for (const l of lineas) {
      const esTitulo = l.length <= 90 && !/[.;,]$/.test(l) && !CORTADA.test(l) && !ROTULO.test(l) && !GENERICO.test(l) && !/^\d+$/.test(l) && /[a-záéíóúñ]{3}/i.test(l);
      if (titulo === null) {
        // El primer renglón útil de la página es su título
        if (esTitulo && l.toLowerCase() !== nombre && palabras(l) <= 12) titulo = l.replace(/:$/, "");
        else if (ROTULO.test(l) || GENERICO.test(l)) continue;
        else if (l.length > 90) break; // página de texto corrido: no es una lista
        continue;
      }
      if (/:$/.test(l) && l.length <= 90 && items.length >= 2) { cerrar(); titulo = l.replace(/:$/, ""); continue; } // subtítulo
      if (l.length >= 3 && l.length <= 120 && !ROTULO.test(l) && !GENERICO.test(l) && !PIE.test(l) && !/^\d+$/.test(l) && !/[:|]/.test(l) && !CORTADA.test(l) && /[a-záéíóúñ]{4}/.test(l)) items.push(l.replace(/[.;,]$/, ""));
    }
    cerrar();
  }
  return listas.filter((l) => !GENERICO.test(l.titulo) && !VAGO.test(l.titulo));
}

// Parejas de contrarios: sirven para hacer falsa una afirmación verdadera y para escoger qué palabra dejar en blanco
const CONTRARIOS = [["aumenta", "disminuye"], ["aumentan", "disminuyen"], ["aumento", "disminución"], ["mayor", "menor"], ["superior", "inferior"],
  ["superiores", "inferiores"], ["anterior", "posterior"], ["anteriores", "posteriores"], ["medial", "lateral"], ["proximal", "distal"], ["derecho", "izquierdo"],
  ["derecha", "izquierda"], ["interno", "externo"], ["interna", "externa"], ["aferente", "eferente"], ["aferentes", "eferentes"], ["sensitivo", "motor"],
  ["sensitiva", "motora"], ["sensitivas", "motoras"], ["simpático", "parasimpático"], ["simpática", "parasimpática"], ["arteria", "vena"], ["arterias", "venas"],
  ["alta", "baja"], ["alto", "bajo"], ["estimula", "inhibe"], ["estimulan", "inhiben"], ["excitatorio", "inhibitorio"], ["excitatoria", "inhibitoria"],
  ["positivo", "negativo"], ["positiva", "negativa"], ["intracelular", "extracelular"], ["dentro", "fuera"], ["rápida", "lenta"], ["rápido", "lento"],
  ["voluntario", "involuntario"], ["voluntaria", "involuntaria"], ["hipertónica", "hipotónica"], ["despolarización", "repolarización"], ["sístole", "diástole"],
  ["inspiración", "espiración"], ["flexión", "extensión"], ["abducción", "aducción"], ["dorsal", "ventral"], ["craneal", "caudal"], ["ascendente", "descendente"],
  ["ascendentes", "descendentes"], ["benigno", "maligno"], ["benigna", "maligna"], ["agudo", "crónico"], ["aguda", "crónica"], ["aerobio", "anaerobio"],
  ["dominante", "recesivo"], ["dominante", "recesiva"], ["mitosis", "meiosis"], ["haploide", "diploide"], ["endocrina", "exocrina"], ["hidrofílica", "hidrofóbica"],
  ["saturados", "insaturados"], ["anabolismo", "catabolismo"], ["oxidación", "reducción"], ["superficial", "profunda"], ["superficial", "profundo"],
  ["presináptica", "postsináptica"], ["mielínicas", "amielínicas"], ["conos", "bastones"], ["miopía", "hipermetropía"], ["convexa", "cóncava"],
  ["vasoconstricción", "vasodilatación"], ["hipertensión", "hipotensión"], ["hiperglucemia", "hipoglucemia"], ["taquicardia", "bradicardia"], ["sodio", "potasio"],
  ["absorción", "secreción"], ["síntesis", "degradación"], ["primaria", "secundaria"], ["primario", "secundario"], ["grueso", "delgado"], ["gruesa", "delgada"],
  ["innata", "adquirida"], ["procariota", "eucariota"], ["procariotas", "eucariotas"], ["maternas", "fetales"], ["izquierdo", "derecho"]];
const CONTRARIO = new Map();
for (const [a, b] of CONTRARIOS) { if (!CONTRARIO.has(a)) CONTRARIO.set(a, b); if (!CONTRARIO.has(b)) CONTRARIO.set(b, a); }
const RE_CONTRARIO = new RegExp(`(^|[^\\wáéíóúñü])(${[...CONTRARIO.keys()].sort((a, b) => b.length - a.length).join("|")})(?![\\wáéíóúñü])`, "i");
const RE_NUMERO = /(^|[^\w.,/-])(\d{1,4}(?:[.,]\d{1,2})?)(?=\s?(%|mm|cm|ml|mL|mg|g|kg|L|l|mV|mmHg|mEq|años|meses|semanas|días|horas|minutos|segundos|pares|veces|capas|tipos|fases|etapas|huesos|músculos|vértebras|cromosomas|lóbulos|segmentos|caras|bordes|porciones|°C|grados|nm|µm|micras|litros|latidos)\b)/;
const comoOriginal = (nueva, vieja) => (vieja[0] === vieja[0].toUpperCase() ? nueva[0].toUpperCase() + nueva.slice(1) : nueva);

/** Frases completas con algún dato que se pueda preguntar: [{ frase, fuente, clave, falsa }] */
function frasesDe(doc, paginas) {
  const salida = [];
  const vistos = new Set();
  for (const { pagina, texto } of unidas(paginas)) {
    const trozos = String(texto).replace(/([.;])\s+(?=[A-ZÁÉÍÓÚÑ¿])/g, "$1\n").split(/\n+/).map(sinVineta);
    for (let f of trozos) {
      f = f.replace(/[;,]$/, "");
      if (f.length < 40 || f.length > 230 || palabras(f) < 7 || CORTADA.test(f) || /^[a-záéíóúñ]/.test(f) || /[?¿:]$/.test(f) || ROTULO.test(f) || vistos.has(f.toLowerCase())) continue;
      if (!/\s(es|son|se|está|están|tiene|tienen|presenta|presentan|forma|forman|produce|producen|permite|contiene|contienen|recibe|reciben|ocurre|participa|participan|constituye|actúa|actúan|origina|inerva|irriga|secreta|regula|controla|determina|puede|pueden|posee|poseen|representa|corresponde|aumenta|disminuye|estimula|inhibe|provoca|causa|depende|comprende|incluye|consta|existen?|hay|fue|sirve|interviene|transporta|conduce|une|divide|encuentra|localiza|sitúa|ubica|compone|caracteriza|clasifica|denomina|llama|conoce|debe|deben)\s/i.test(f)) continue;
      vistos.add(f.toLowerCase());
      const fuente = `${doc.etiqueta || "pág."} ${pagina}`;
      const mc = f.match(RE_CONTRARIO);
      const mn = f.match(RE_NUMERO);
      if (f.includes("|") || LIBRO.test(f)) continue; // fila de una tabla o cita de un libro
      if (/\b(alumnos?|estudiantes?|evaluaci[oó]n|evaluaciones|examen|asignatura|reglamento|seminarios?|clase taller|conferencias?|bibliograf[ií]a)\b/i.test(f)) continue; // organización del curso
      const yaTieneElOtro = mc && new RegExp(`(^|[^\\wáéíóúñü])${CONTRARIO.get(mc[2].toLowerCase())}(?![\\wáéíóúñü])`, "i").test(f);
      if (mc && !yaTieneElOtro) {
        const palabra = mc[2];
        const ini = mc.index + mc[1].length;
        const otra = comoOriginal(CONTRARIO.get(palabra.toLowerCase()), palabra);
        salida.push({ frase: f, fuente, clave: palabra, blanco: f.slice(0, ini) + "___" + f.slice(ini + palabra.length), falsa: f.slice(0, ini) + otra + f.slice(ini + palabra.length), opcion: otra });
      } else if (mn) {
        const num = mn[2];
        const ini = mn.index + mn[1].length;
        const v = parseFloat(num.replace(",", "."));
        const otro = Number.isInteger(v) ? String(v <= 12 ? v + (v > 3 ? -2 : 2) : v % 2 === 0 ? v / 2 : v * 2) : String(Math.round(v * 20) / 10).replace(".", num.includes(",") ? "," : ".");
        salida.push({ frase: f, fuente, clave: num, numero: true, blanco: f.slice(0, ini) + "___" + f.slice(ini + num.length), falsa: f.slice(0, ini) + otro + f.slice(ini + num.length), opcion: otro });
      } else {
        // Sin contrario ni cifra: se deja en blanco el término técnico más largo (no el primero de la frase)
        const cand = (f.match(/[a-záéíóúñü]{9,}/gi) || []).filter((w) => f.indexOf(w) > 12 && !/mente$/.test(w) && f.split(w).length === 2)
          .sort((a, b) => b.length - a.length)[0];
        if (cand) salida.push({ frase: f, fuente, clave: cand, blanco: f.replace(cand, "___"), falsa: null });
      }
    }
  }
  return salida;
}

/**
 * Cuestionario automático de un material, hecho con TODO su contenido:
 *  - definiciones («La mitosis es…», «Osteología: estudio de…»),
 *  - listas (cada título con sus elementos: clasificaciones, partes, funciones, características…),
 *  - frases con datos (cifras, lados, sentidos, aumentos y disminuciones…).
 * paginas: [{ pagina, texto }]. Devuelve [] solo si el texto casi no tiene contenido.
 */
export function generarCuestionario(doc, paginas, maximo = 20) {
  const azar = azarCon(doc.nombre || doc.id || "finlay");
  const defs = definicionesDe(doc, paginas);
  const listas = listasDe(doc, paginas);
  const frases = barajar(frasesDe(doc, paginas), azar);
  const base = (fuente, cita) => ({ fuente, cita, auto: true });
  const elegir = (lista, n) => barajar(lista, azar).slice(0, n);
  const colas = []; // cada cola da preguntas de una clase; se va tomando una de cada una por turno

  // --- Definiciones ---
  if (defs.length >= 3) {
    const orden = barajar(defs, azar);
    let k = 0;
    colas.push(() => {
      if (k >= orden.length) return null;
      const d = orden[k], tipo = k++ % 4;
      const otras = barajar(defs.filter((x) => x !== d), azar);
      const b = base(d.fuente, d.frase);
      if (tipo === 0 && defs.length >= 4) {
        const opciones = barajar([d, ...otras.slice(0, 3)], azar);
        return { tipo: "multiple", pregunta: `«${corto(d.explicacion)}» corresponde a:`, opciones: opciones.map((x) => x.termino), correcta: opciones.indexOf(d), ...b };
      }
      if (tipo === 2 && defs.length >= 4) {
        const grupo = [d, ...otras.slice(0, 2)];
        const columnaB = barajar([...grupo, otras[2]].filter(Boolean), azar);
        return { tipo: "enlazar", pregunta: "Enlace cada término (columna A) con su definición (columna B):",
          columnaA: grupo.map((x) => x.termino), columnaB: columnaB.map((x) => corto(x.explicacion, 110)), pares: grupo.map((x) => columnaB.indexOf(x)), ...b };
      }
      if (tipo === 3) {
        const falsa = otras[0];
        return { tipo: "vf", pregunta: "Diga si son verdaderas (V) o falsas (F):", afirmaciones: barajar([
          { texto: `${d.termino}: ${corto(d.explicacion, 140)}.`, respuesta: true },
          { texto: `${falsa.termino}: ${corto((otras[1] || d).explicacion, 140)}.`, respuesta: false }], azar), ...b,
          explicacion: `${falsa.termino}: ${corto(falsa.explicacion, 160)}.` };
      }
      const frase = d.frase.replace(d.termino, "___");
      return { tipo: "completar", pregunta: frase !== d.frase && frase.length < 260 ? frase : `${corto(d.explicacion, 200)}: ___`, respuestas: [[d.termino]], ...b };
    });
  }

  // --- Listas: qué pertenece a cada título ---
  if (listas.length >= 2) {
    const orden = barajar(listas, azar);
    let k = 0;
    const ajenos = (l, n) => {
      const propios = new Set(l.items.map((x) => x.toLowerCase()));
      return elegir([...new Set(listas.filter((x) => x !== l).flatMap((x) => x.items))].filter((x) => !propios.has(x.toLowerCase())), n);
    };
    colas.push(() => {
      if (k >= orden.length * 2) return null;
      const l = orden[k % orden.length], tipo = k++ % 4;
      const b = base(l.fuente, l.items[0]);
      const lista = `${l.titulo}: ${l.items.join("; ")}.`;
      if (tipo === 0) {
        const fuera = ajenos(l, 3);
        if (fuera.length < 2) return undefined;
        const bien = elegir(l.items, 1)[0];
        const opciones = barajar([bien, ...fuera], azar);
        return { tipo: "multiple", pregunta: `¿Cuál de los siguientes corresponde a «${l.titulo}»?`, opciones, correcta: opciones.indexOf(bien), ...b, cita: bien, explicacion: corto(lista, 260) };
      }
      if (tipo === 1) {
        const fuera = ajenos(l, 2);
        if (!fuera.length) return undefined;
        const bien = elegir(l.items, Math.min(3, l.items.length));
        const opciones = barajar([...bien, ...fuera], azar);
        return { tipo: "marcar", pregunta: `Marque con una X los que corresponden a «${l.titulo}»:`, opciones, correctas: bien.map((x) => opciones.indexOf(x)).sort((x, y) => x - y), ...b, explicacion: corto(lista, 260) };
      }
      if (tipo === 2 && l.items.length >= 3) {
        const fuera = ajenos(l, 1);
        if (!fuera.length) return undefined;
        const opciones = barajar([...elegir(l.items, 3), fuera[0]], azar);
        return { tipo: "multiple", pregunta: `¿Cuál de los siguientes NO corresponde a «${l.titulo}»?`, opciones, correcta: opciones.indexOf(fuera[0]), ...b, explicacion: corto(lista, 260) };
      }
      // Enlazar elementos con el título al que pertenecen
      const grupo = [l, ...elegir(listas.filter((x) => x !== l), 3)];
      if (grupo.length < 3) return undefined;
      const usados = new Set();
      const columnaA = [];
      const dueno = [];
      for (const g of grupo.slice(0, 3)) {
        const it = elegir(g.items, g.items.length).find((x) => !usados.has(x.toLowerCase()) && grupo.filter((o) => o.items.some((y) => y.toLowerCase() === x.toLowerCase())).length === 1);
        if (it) { usados.add(it.toLowerCase()); columnaA.push(corto(it, 110)); dueno.push(g); }
      }
      if (columnaA.length < 3) return undefined;
      const columnaB = barajar(grupo, azar);
      return { tipo: "enlazar", pregunta: "Enlace cada elemento (columna A) con el tema al que pertenece (columna B):", columnaA, columnaB: columnaB.map((g) => corto(g.titulo, 110)), pares: dueno.map((g) => columnaB.indexOf(g)), ...b };
    });
  }

  // --- Frases con datos: verdadero o falso y completar ---
  const falsables = frases.filter((f) => f.falsa);
  if (falsables.length >= 2) {
    let k = 0;
    colas.push(() => {
      if (k + 1 >= falsables.length) return null;
      const grupo = falsables.slice(k, k + 3);
      k += grupo.length;
      // Siempre mezcladas: al menos una verdadera y una falsa
      const cuantasFalsas = grupo.length === 2 ? 1 : 1 + Math.floor(azar() * 2);
      const cuales = new Set(barajar(grupo.map((_, j) => j), azar).slice(0, cuantasFalsas));
      const afirmaciones = grupo.map((f, j) => ({ texto: cuales.has(j) ? f.falsa : f.frase, respuesta: !cuales.has(j), f }));
      const malas = afirmaciones.filter((a) => !a.respuesta).map((a) => a.f.frase);
      return { tipo: "vf", pregunta: "Diga si son verdaderas (V) o falsas (F):", afirmaciones: afirmaciones.map(({ texto, respuesta }) => ({ texto, respuesta })),
        ...base(grupo[0].fuente, grupo[0].frase), explicacion: "Lo correcto: " + malas.map((m) => corto(m, 200)).join(" · ") };
    });
  }
  if (frases.length) {
    const orden = barajar(frases, azar);
    let k = 0;
    colas.push(() => {
      if (k >= orden.length) return null;
      const f = orden[k++];
      const b = base(f.fuente, f.frase);
      // Con contrario o cifra: selección entre el dato real y otros parecidos; si no, completar
      if (f.opcion && k % 2 === 0) {
        const otros = f.numero
          ? [f.opcion, String(parseFloat(f.clave.replace(",", ".")) + (parseFloat(f.clave) >= 10 ? 10 : 1)), String(Math.max(1, Math.round(parseFloat(f.clave.replace(",", ".")) * 3)))]
          : [f.opcion];
        const opciones = barajar([...new Set([f.clave, ...otros])], azar);
        if (opciones.length >= 2) return { tipo: "multiple", pregunta: f.blanco, opciones, correcta: opciones.indexOf(f.clave), ...b, explicacion: f.frase };
      }
      return { tipo: "completar", pregunta: f.blanco, respuestas: [[f.clave]], ...b };
    });
  }

  // Se toma una pregunta de cada clase por turno, sin repetir enunciados
  const preguntas = [];
  const enunciados = new Set();
  let vivas = colas.length;
  for (let vuelta = 0; preguntas.length < maximo && vivas > 0 && vuelta < 200; vuelta++) {
    vivas = 0;
    for (const cola of colas) {
      if (preguntas.length >= maximo) break;
      const p = cola();
      if (p === null) continue;
      vivas++;
      if (!p) continue;
      const clave = p.pregunta + "|" + (p.opciones || p.columnaA || p.afirmaciones?.map((a) => a.texto) || []).join("|");
      if (enunciados.has(clave)) continue;
      enunciados.add(clave);
      preguntas.push(p);
    }
  }
  return preguntas.length >= 3 ? preguntas : [];
}

/** Resumen automático de una asignatura a partir de sus materiales (para «Generar asignatura») */
export function resumenDeAsignatura(nombre, materiales) {
  // materiales: [{ nombre, definiciones: [{ termino, explicacion }] }]
  return {
    intro: `Resumen de **${nombre}**, generado a partir de sus ${materiales.length} materiales.`,
    mapa: { t: "mapa", titulo: "Mapa general", raiz: nombre,
      ramas: materiales.slice(0, 8).map((m) => ({ t: corto(m.nombre.replace(/^(Conferencia|Clase)\s*\d*\s*[-–:]?\s*/i, ""), 60),
        hijos: m.definiciones.slice(0, 4).map((d) => ({ t: corto(d.termino, 40), hijos: [] })) })) },
    temas: materiales.filter((m) => m.definiciones.length).map((m) => ({ titulo: m.nombre, bloques: [
      { t: "lista", items: m.definiciones.slice(0, 6).map((d) => `**${d.termino}**: ${corto(d.explicacion, 170)}.`) }] })),
    estrategia: ["**Lee cada material** en orden y haz su cuestionario.", "**Repasa** las preguntas que falles hasta dominarlas."],
  };
}
