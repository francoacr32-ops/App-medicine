// Prueba en el navegador de "Mi progreso" con los datos del caso real:
// el martes con 11 preguntas y 0 minutos, y un total viejo de 28 min con la franja de la tarde en 1 min.
// Ejecutar (con la app servida en http://localhost:8766/):  TZ=America/Havana node pruebas/progreso.e2e.js
const { chromium, devices } = require('playwright');
const U = process.env.FINLAY_URL || 'http://localhost:8766/';
const assert = require('node:assert/strict');

(async () => {
  const b = await chromium.launch(); const err = [];
  const ctx = await b.newContext({ ...devices['Pixel 5'], timezoneId: 'America/Havana' });
  await ctx.addInitScript(() => { window.FinlayAndroid = { vozDisponible: () => false, hablar() {}, detener() {}, guardar() {}, vibrar() {} }; });
  const page = await ctx.newPage(); page.on('pageerror', e => err.push(e.message)); page.on('dialog', d => d.accept());
  await page.goto(U); await page.waitForSelector('text=Diapositivas listas', { timeout: 120000 }); await page.waitForTimeout(2000);

  // Datos como los de la captura: versión anterior (finlay.tiempo por día y finlay.horas sin fecha)
  await page.evaluate(async () => {
    const f = (k) => { const d = new Date(); d.setDate(d.getDate() - k); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
    const a = (k, h, m) => { const d = new Date(); d.setDate(d.getDate() - k); d.setHours(h, m, 0, 0); return d.getTime(); };
    localStorage.removeItem('finlay.sesiones'); localStorage.removeItem('finlay.sesiones.migrado');
    localStorage.setItem('finlay.tiempo', JSON.stringify({ [f(1)]: 25 * 60, [f(0)]: 3 * 60 })); // 28 min, pero nada el martes
    localStorage.setItem('finlay.horas', JSON.stringify({ 13: 60 }));                            // la franja solo sabía de 1 min
    const db = await new Promise((ok) => { const r = indexedDB.open('finlay'); r.onsuccess = () => ok(r.result); });
    const docs = await new Promise((ok) => { const q = db.transaction('documentos').objectStore('documentos').getAll(); q.onsuccess = () => ok(q.result); });
    const conPreg = docs.filter((d) => d.cuestionario?.length);
    const tx = db.transaction(['diario', 'respuestas'], 'readwrite');
    tx.objectStore('diario').put({ fecha: f(2), preguntas: 11, correctas: 6 });  // el "martes"
    tx.objectStore('diario').put({ fecha: f(1), preguntas: 9, correctas: 7 });
    tx.objectStore('diario').put({ fecha: f(0), preguntas: 3, correctas: 2 });
    // hora real de 9 de las 11 respuestas del martes (de 8:10 a 8:25)
    for (let k = 0; k < 9; k++) tx.objectStore('respuestas').put({ id: `${conPreg[0].id}|${k}`, docId: conPreg[0].id, indice: k, ultima: k % 2 === 0, aciertos: 1, fallos: 0, caja: 1, fecha: a(2, 8, 10 + k * 2) });
    for (let k = 0; k < 9; k++) tx.objectStore('respuestas').put({ id: `${conPreg[1].id}|${k}`, docId: conPreg[1].id, indice: k, ultima: true, aciertos: 2, fallos: 0, caja: 2, fecha: a(1, 16, k * 3) });
    await new Promise((ok) => (tx.oncomplete = ok));
  });
  await page.reload(); await page.waitForTimeout(2500); // al abrir se migran los datos viejos

  await page.goto(U + '#/progreso'); await page.waitForSelector('.act-resumen');
  const datos = await page.evaluate(() => {
    const texto = (s) => document.querySelector(s)?.innerText || '';
    const min = (t) => { const h = /(\d+) h/.exec(t); const m = /(\d+) min/.exec(t); return (h ? +h[1] * 60 : 0) + (m ? +m[1] : 0); };
    const franjas = [...document.querySelectorAll('.franja b')].map((x) => min(x.textContent));
    const tiempoTarjeta = [...document.querySelectorAll('.act-dato')].find((x) => x.innerText.startsWith('Tiempo de estudio'));
    return {
      franjas, sumaFranjas: franjas.reduce((s, x) => s + x, 0),
      totalFranjas: min(texto('.franja-total b')),
      totalTarjeta: min(tiempoTarjeta.querySelector('b').textContent),
      promedio: [...tiempoTarjeta.querySelectorAll('.sub')].pop().textContent,
      activos: texto('.act-dato:nth-child(4) b'),
      comparacion: texto('.act-cambio'),
      ejeMin: [...document.querySelectorAll('.g-eje-min:not(.g-titulo-eje)')].map((x) => +x.textContent),
      dias: window.__dias = null,
      calendarioEmoji: document.body.innerText.includes('📅'),
      todoTiempo: [...document.querySelectorAll('.totales .sub')].map((x) => x.textContent),
    };
  });
  // Detalle de cada día (preguntas y minutos) usando las barras
  const porDia = [];
  for (let i = 0; i < 7; i++) { await page.click(`.g-toque[data-i="${i}"]`); porDia.push(await page.innerText('#act-detalle')); }
  console.log('Notas:', await page.$$eval('.act-estimado', (e) => e.map((x) => x.textContent.trim())));
  console.log(JSON.stringify(datos, null, 1));
  console.log(porDia.join('\n'));

  assert.equal(datos.sumaFranjas, datos.totalFranjas, 'suma de franjas = total');
  assert.equal(datos.totalFranjas, datos.totalTarjeta, 'el total de las franjas es el mismo de la tarjeta Tiempo de estudio');
  for (const d of porDia) if (/\d+ preguntas/.test(d) && !d.startsWith('0 ')) assert.ok(!/ 0 min de estudio/.test(d), 'día con preguntas y 0 min: ' + d);
  assert.match(datos.promedio, /por día estudiado/);
  const activos = parseInt(datos.activos);
  assert.equal(datos.promedio.replace(/\D+/g, ' ').trim().split(' ')[0], String(Math.round(datos.totalTarjeta / activos)), 'promedio = total ÷ días activos');
  assert.ok(datos.ejeMin.every((v) => v % 5 === 0), 'eje de minutos en múltiplos de 5: ' + datos.ejeMin);
  assert.equal(datos.comparacion, 'Tu primera semana 🎉');
  assert.equal(datos.calendarioEmoji, false, 'no debe salir el emoji de calendario');
  assert.equal(datos.todoTiempo.length, 4);

  // Inicio usa la misma fuente: "Estudio hoy" y "Tiempo en la app"
  await page.goto(U + '#/'); await page.waitForSelector('.progreso-general');
  const inicioHoy = await page.innerText('[data-panel=hoy] .pg-datos > span:first-child b');
  await page.click('[data-accion=pg-ver][data-ver=total]');
  const inicioTotal = await page.innerText('[data-panel=total] .pg-datos > span:first-child b');
  console.log('Inicio: hoy', inicioHoy, '· todo el tiempo', inicioTotal);
  await page.goto(U + '#/progreso'); await page.waitForSelector('.progreso-general');
  const progresoTotal = await page.evaluate(() => [...document.querySelectorAll('.progreso-general .pg-datos > span')].find((x) => x.innerText.includes('Tiempo en la app')).querySelector('b').textContent);
  console.log('Mi progreso: todo el tiempo', progresoTotal);
  assert.equal(inicioTotal, progresoTotal, 'Inicio y Mi progreso muestran el mismo tiempo total');

  await page.screenshot({ path: (process.env.FOTOS || '.') + '/progreso-arreglado.png', fullPage: true });
  assert.deepEqual(err, []);
  console.log('\n✔ Todo cuadra: franjas = total, ningún día con preguntas en 0 min, promedio por días activos, ejes en múltiplos de 5.');
  await b.close();
})().catch((e) => { console.error('✘', e.message); process.exit(1); });
