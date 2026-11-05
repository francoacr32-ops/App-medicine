// Pruebas del registro de tiempo de estudio (docs/js/tiempo.js).
// Ejecutar:  TZ=America/Havana node pruebas/tiempo.test.mjs
// (Cuba está en UTC-5 en noviembre; también se puede probar con otras zonas.)

import assert from "node:assert/strict";

// ---------- Entorno falso: reloj, localStorage, document y temporizadores ----------
let ahora = 0;
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...a) { a.length ? super(...a) : super(ahora); }
  static now() { return ahora; }
};
const almacen = new Map();
globalThis.localStorage = {
  getItem: (k) => (almacen.has(k) ? almacen.get(k) : null),
  setItem: (k, v) => almacen.set(k, String(v)),
  removeItem: (k) => almacen.delete(k),
};
let alIntervalo = null;
const oyentes = {};
globalThis.setInterval = (fn) => { alIntervalo = fn; return 1; };
globalThis.addEventListener = (tipo, fn) => { (oyentes[tipo] ||= []).push(fn); };
globalThis.document = { hidden: false, addEventListener: (tipo, fn) => { (oyentes[tipo] ||= []).push(fn); } };

const T = await import("../docs/js/tiempo.js");
const local = (a, m, d, h, min, s = 0) => new RealDate(a, m - 1, d, h, min, s).getTime();
const MIN = 60;
const sumaFranjas = (r) => r.porFranja.reduce((s, x) => s + x, 0);
let pruebas = 0;
const prueba = (nombre, fn) => { fn(); pruebas++; console.log("✔", nombre); };

console.log("Zona horaria:", Intl.DateTimeFormat().resolvedOptions().timeZone, "· UTC" + -new RealDate().getTimezoneOffset() / 60);

// ---------- 1. Sesión que cruza de la mañana a la tarde (11:50 → 12:10) ----------
prueba("11:50 → 12:10: 10 min en la mañana y 10 en la tarde; franjas = total", () => {
  const r = T.analizar([{ i: local(2026, 11, 3, 11, 50), f: local(2026, 11, 3, 12, 10) }]);
  assert.equal(r.total, 20 * MIN);
  assert.equal(r.porFranja[1], 10 * MIN); // mañana
  assert.equal(r.porFranja[2], 10 * MIN); // tarde
  assert.equal(sumaFranjas(r), r.total);
  assert.deepEqual(Object.keys(r.porDia), ["2026-11-03"]);
});

// ---------- 2. Sesión que cruza la medianoche (23:50 → 00:10) ----------
prueba("23:50 → 00:10: se reparte entre dos días y entre noche y madrugada", () => {
  const r = T.analizar([{ i: local(2026, 11, 3, 23, 50), f: local(2026, 11, 4, 0, 10) }]);
  assert.equal(r.porDia["2026-11-03"], 10 * MIN);
  assert.equal(r.porDia["2026-11-04"], 10 * MIN);
  assert.equal(r.porFranja[3], 10 * MIN); // noche
  assert.equal(r.porFranja[0], 10 * MIN); // madrugada
  assert.equal(sumaFranjas(r), r.total);
});

// ---------- 3. Registro real con temporizador y app cerrada de golpe ----------
prueba("app cerrada de golpe: el tiempo ya está guardado (se pierden como mucho 15 s)", () => {
  almacen.clear();
  ahora = local(2026, 11, 5, 15, 0);
  T.iniciarRegistro();                     // al abrir cuenta como actividad
  for (let s = 0; s < 6 * 60; s += 15) {   // 6 minutos de uso, tocando la pantalla cada 45 s
    ahora += 15000;
    if (s % 45 === 0) T.marcarActividad();
    alIntervalo();
  }
  // ¡se cierra de golpe! (no hay pagehide ni visibilitychange): leemos lo guardado
  const guardado = T.sesiones();
  const r = T.analizar(guardado);
  assert.ok(r.total >= 6 * MIN - 15, `guardado ${r.total} s`);
  assert.ok(r.total <= 6 * MIN);
  assert.equal(sumaFranjas(r), r.total);
});

prueba("al pasar a segundo plano se cierra el tramo y al volver empieza otro", () => {
  ahora += 60000;
  document.hidden = true; oyentes.visibilitychange.forEach((f) => f());
  ahora += 30 * 60000;                     // media hora fuera de la app: no cuenta
  alIntervalo();
  document.hidden = false; oyentes.visibilitychange.forEach((f) => f());
  for (let s = 0; s < 120; s += 15) { ahora += 15000; T.marcarActividad(); alIntervalo(); }
  const r = T.analizar(T.sesiones());
  assert.ok(r.total < 10 * MIN, `no debe contar la media hora fuera (${r.total} s)`);
  assert.equal(T.sesiones().length, 2);
});

prueba("sin tocar la pantalla más de 5 min deja de contar", () => {
  const antes = T.analizar(T.sesiones()).total;
  for (let s = 0; s < 20 * 60; s += 15) { ahora += 15000; alIntervalo(); }
  const despues = T.analizar(T.sesiones()).total;
  assert.ok(despues - antes <= 5 * MIN + 15, `contó ${despues - antes} s sin actividad`);
});

// ---------- 4. Días con preguntas pero sin tiempo guardado ----------
prueba("ningún día con preguntas queda con 0 minutos (estimación por la hora de las respuestas)", () => {
  const reales = [{ i: local(2026, 11, 4, 16, 0), f: local(2026, 11, 4, 16, 28) }];
  const diario = [
    { fecha: "2026-11-03", preguntas: 11, correctas: 8 },   // el "martes": sin tiempo guardado
    { fecha: "2026-11-02", preguntas: 4, correctas: 4 },    // sin tiempo y sin horas de respuestas
    { fecha: "2026-11-04", preguntas: 5, correctas: 3 },    // con tiempo real
  ];
  const horas = [0, 1, 2, 4, 5, 7, 9, 10].map((m) => local(2026, 11, 3, 21, m * 1.5)); // 8 de las 11 con hora
  const estimados = T.estimarFaltantes(reales, diario, horas);
  const r = T.analizar([...reales, ...estimados]);
  for (const d of diario) assert.ok((r.porDia[d.fecha] || 0) >= 60, `${d.fecha} quedó con ${r.porDia[d.fecha] || 0} s`);
  assert.equal(r.porDia["2026-11-04"], 28 * MIN, "el día con tiempo real no se toca");
  assert.ok(r.porFranja[3] > 0, "el martes se estudió de noche: va a la franja Noche");
  assert.equal(sumaFranjas(r), r.total);
  assert.ok(r.estimado > 0 && r.estimado === r.total - 28 * MIN);
});

// ---------- 5. Franjas, promedio y redondeo (como lo muestra la pantalla) ----------
prueba("28 min en 3 días activos: franjas suman 28 y el promedio es 9 min por día estudiado", () => {
  const tramos = [
    { i: local(2026, 11, 3, 7, 0), f: local(2026, 11, 3, 7, 9, 20) },      // 9 min 20 s
    { i: local(2026, 11, 4, 11, 50), f: local(2026, 11, 4, 12, 0, 40) },   // 10 min 40 s, cruza a la tarde
    { i: local(2026, 11, 5, 22, 0), f: local(2026, 11, 5, 22, 8) },        // 8 min
  ];
  const r = T.analizar(tramos, { desde: local(2026, 10, 30, 0, 0) });
  const { total, partes } = T.minutosRepartidos(r.porFranja);
  assert.equal(total, 28);
  assert.equal(partes.reduce((s, x) => s + x, 0), total, "las franjas mostradas suman el total mostrado");
  const activos = Object.values(r.porDia).filter((s) => s >= 60).length;
  assert.equal(activos, 3);
  assert.equal(Math.round(total / activos), 9, "promedio = total ÷ días activos (no ÷ 7)");
});

prueba("el período elegido corta los tramos en el borde", () => {
  const r = T.analizar([{ i: local(2026, 11, 1, 23, 30), f: local(2026, 11, 2, 0, 30) }], { desde: local(2026, 11, 2, 0, 0) });
  assert.equal(r.total, 30 * MIN);
  assert.equal(sumaFranjas(r), r.total);
});

// ---------- 6. Datos de versiones anteriores ----------
prueba("el tiempo guardado por versiones anteriores se pasa a sesiones sin perder minutos", () => {
  almacen.clear();
  almacen.set("finlay.tiempo", JSON.stringify({ "2026-11-04": 1500, "2026-11-05": 180 }));
  almacen.set("finlay.horas", JSON.stringify({ 17: 180 }));
  const respuestas = [local(2026, 11, 4, 20, 0), local(2026, 11, 4, 20, 3), local(2026, 11, 4, 21, 30)];
  T.migrarDatosViejos(respuestas);
  const r = T.analizar(T.sesiones());
  assert.equal(Math.round(r.porDia["2026-11-04"]), 1500);
  assert.equal(Math.round(r.porDia["2026-11-05"]), 180);
  assert.equal(sumaFranjas(r), r.total);
  T.migrarDatosViejos(respuestas); // una segunda vez no duplica
  assert.equal(T.analizar(T.sesiones()).total, r.total);
});

console.log(`\nTodas las pruebas pasaron (${pruebas}).`);
