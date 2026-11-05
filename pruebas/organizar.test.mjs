// Pruebas de la organización automática y de las tarjetas automáticas.
// Ejecutar:  node pruebas/organizar.test.mjs
import assert from "node:assert/strict";
import { asignaturaProbable, tipoDeMaterial, nombreLimpio, librosDe, libroConocido } from "../docs/js/organizar.js";
import { tarjetasDeDefiniciones, tarjetasDePreguntas } from "../docs/js/tarjetas.js";

const A = [
  [1, "Ontogenia Humana y SOMA"], [1, "Célula, Tejidos y Sistema Tegumentario"], [1, "Biología Molecular"],
  [1, "Sistemas Nervioso, Endocrino y Reproductor"], [1, "Metabolismo y Nutrición"],
  [2, "Sangre y Sistema Inmune"], [2, "Sistemas Cardiovascular, Respiratorio, Digestivo y Renal"], [2, "Psicología"], [2, "Genética Médica"], [2, "Microbiología"],
  [3, "Medicina Interna"], [3, "Propedéutica Clínica y Semiología Médica"], [4, "Pediatría"], [4, "Ginecología y Obstetricia"], [4, "Cirugía"],
  [5, "Oftalmología"], [5, "Medicina General Integral"], [5, "Trabajo Médico en la Comunidad"], [5, "Salud Pública"], [5, "Estudios de Ciencia, Tecnología y Sociedad"],
  [6, "Medicina General Integral"],
].map(([anio, nombre]) => ({ anio, nombre, id: `${anio}|${nombre}` }));

const casos = [
  ["Conferencia 3 Tejido epitelial.pptx", "El tejido epitelial reviste superficies…", "1|Célula, Tejidos y Sistema Tegumentario", "conferencia"],
  ["CT 2 Lipidos de membrana.pdf", "Los lípidos son biomoléculas…", "1|Biología Molecular", "taller"],
  ["Clase taller 4 - Glucólisis y ciclo de Krebs.docx", "La glucólisis ocurre en el citosol. Metabolismo energético.", "1|Metabolismo y Nutrición", "taller"],
  ["Tema 2 Neurona y sinapsis.pptx", "La neurona es la unidad del sistema nervioso. Sinapsis química.", "1|Sistemas Nervioso, Endocrino y Reproductor", "conferencia"],
  ["Hematopoyesis.pdf", "La sangre está formada por eritrocitos, leucocitos y plaquetas.", "2|Sangre y Sistema Inmune", "conferencia"],
  ["Libro de Embriología Langman cap 3.pdf", "Fecundación y primera semana del desarrollo. Embrión.", "1|Ontogenia Humana y SOMA", "libro"],
  ["Formulario Nacional de Medicamentos.pdf", "Medicamentos. Dosis.", null, "consulta"],
  ["Conf 1 Semiología del sistema respiratorio.pptx", "Propedéutica clínica: interrogatorio y examen físico del aparato respiratorio. Síntomas.", "3|Propedéutica Clínica y Semiología Médica", "conferencia"],
  ["Parto fisiologico.pptx", "El parto es el proceso… embarazo a término, obstetricia.", "4|Ginecología y Obstetricia", "conferencia"],
  ["Bacterias gram positivas.pdf", "Microbiología: las bacterias…", "2|Microbiología", "conferencia"],
];
let ok = 0;
for (const [archivo, texto, esperado, tipo] of casos) {
  const { asig, seguridad } = asignaturaProbable(archivo, texto, A);
  const t = tipoDeMaterial(archivo, 10);
  if (esperado) assert.equal(asig?.id, esperado, `${archivo} → ${asig?.id}`);
  assert.equal(t, tipo, `${archivo}: tipo ${t}`);
  console.log(`✔ ${archivo.padEnd(52)} → ${(asig?.nombre || "(elige el estudiante)").padEnd(42)} · ${t} · seguridad ${seguridad.toFixed(2)}`);
  ok++;
}
assert.equal(tipoDeMaterial("Guyton.pdf", 300), "libro");

// Libros de texto de ECIMED: se reconocen por el título o el autor
for (const [archivo, esperado] of [
  ["Llanio Navarro - Propedeutica tomo 1.pdf", "3|Propedéutica Clínica y Semiología Médica"],
  ["Roca Goderich Temas de Medicina Interna T2.pdf", "3|Medicina Interna"],
  ["Rigol_Obstetricia.pdf", "4|Ginecología y Obstetricia"],
  ["Alvarez Sintes MGI vol 1.pdf", "5|Medicina General Integral"],
  ["Cardella Bioquimica Medica tomo 1.pdf", "1|Biología Molecular"],
  ["Llop Microbiologia.pdf", "2|Microbiología"],
]) {
  const { asig } = asignaturaProbable(archivo, "", A);
  assert.equal(asig?.id, esperado, archivo);
  assert.equal(tipoDeMaterial(archivo, 20), "libro", archivo);
  console.log(`✔ libro: ${archivo.padEnd(48)} → ${asig.nombre} · ${libroConocido(archivo).titulo}`);
}
assert.ok(librosDe("Pediatría").some((l) => l.autor.includes("Valdés Martín")));
assert.equal(librosDe("Ontogenia Humana y SOMA").length, 2);
assert.equal(nombreLimpio("CT_2_Lipidos.pdf"), "CT 2 Lipidos");

// Tarjetas automáticas de las definiciones
const doc = { id: "d1", etiqueta: "diap." };
const t = tarjetasDeDefiniciones(doc, [
  { pagina: 3, texto: "La mitosis es el proceso de división celular que produce dos células hijas idénticas.\nObjetivos: conocer la célula y sus partes" },
  { pagina: 4, texto: "Osteología: rama de la anatomía que estudia los huesos y su estructura.\nLos lisosomas son organitos que contienen enzimas hidrolíticas." },
]);
console.log(t.map((x) => `  [${x.fuente}] ${x.frente}  →  ${x.dorso}`).join("\n"));
assert.equal(t.length, 3, "3 definiciones (sin 'Objetivos')");
assert.equal(t[0].frente, "¿Qué es mitosis?");
assert.equal(t[2].frente, "¿Qué son lisosomas?");

// Tarjetas de las preguntas
const tp = tarjetasDePreguntas({ id: "d2", cuestionario: [
  { tipo: "vf", afirmaciones: [{ texto: "El ADN es bicatenario", respuesta: true }, { texto: "El ARN tiene timina", respuesta: false }] },
  { tipo: "enlazar", pregunta: "Enlace", columnaA: ["Mitocondria", "Ribosoma"], columnaB: ["Síntesis de proteínas", "Respiración celular"], pares: [1, 0] },
  { tipo: "multiple", pregunta: "¿Dónde ocurre la glucólisis?", opciones: ["Citosol", "Núcleo"], correcta: 0 },
] }, (p) => `La respuesta correcta es ${p.opciones[p.correcta]}.`);
assert.equal(tp.length, 5);
assert.equal(tp[2].dorso, "Respiración celular");
console.log(`\nTodas las pruebas pasaron (${ok} archivos organizados, ${t.length} definiciones, ${tp.length} tarjetas de preguntas).`);
