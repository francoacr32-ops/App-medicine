// Dibujos vectoriales viejos de Windows (WMF): los usan las gráficas y los «clip art» de los PowerPoint viejos.
// Aquí se recorre la lista de órdenes del dibujo (líneas, polígonos, textos…) y se convierte en un SVG.

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const color = (v) => "#" + [v & 255, (v >> 8) & 255, (v >> 16) & 255].map((x) => x.toString(16).padStart(2, "0")).join("");

function base64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
/** Un mapa de bits DIB (sin cabecera de archivo) como dirección data: de un .bmp */
function dibAUrl(b) {
  if (b.length < 40) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.length);
  const cab = v.getUint32(0, true), bits = v.getUint16(14, true), usados = v.getUint32(32, true);
  const paleta = bits <= 8 ? (usados || 1 << bits) * 4 : 0;
  const bmp = new Uint8Array(14 + b.length);
  const bv = new DataView(bmp.buffer);
  bmp[0] = 0x42; bmp[1] = 0x4d; bv.setUint32(2, bmp.length, true); bv.setUint32(10, 14 + cab + paleta, true);
  bmp.set(b, 14);
  return "data:image/bmp;base64," + base64(bmp);
}

/** Devuelve el texto SVG del dibujo, o null si no se puede leer. */
export function wmfASvg(B) {
  const V = new DataView(B.buffer, B.byteOffset, B.length);
  let p = 0;
  if (B.length > 22 && V.getUint32(0, true) === 0x9ac6cdd7) p = 22; // cabecera «colocable»
  if (p + 18 > B.length) return null;
  p += V.getUint16(p + 2, true) * 2;
  const latin = new TextDecoder("windows-1252");
  const objetos = [];
  const poner = (o) => { let k = 0; while (objetos[k]) k++; objetos[k] = o; };
  let e = { pluma: { c: "#000000", w: 0, nula: false }, brocha: { c: "#ffffff", nula: false }, fuente: { h: 12, negrita: false, cursiva: false, cara: "" },
    tinta: "#000000", alinear: 0, x: 0, y: 0, pares: false };
  const pila = [];
  let ox = 0, oy = 0, ex = 0, ey = 0, hayExt = false;
  const partes = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const ver = (x, y) => { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; };
  const trazo = () => (e.pluma.nula ? 'stroke="none"' : `stroke="${e.pluma.c}" stroke-width="${e.pluma.w || 1}"${e.pluma.w ? "" : ' vector-effect="non-scaling-stroke"'}`);
  const fondo = () => `fill="${e.brocha.nula ? "none" : e.brocha.c}"`;
  const s16 = (q) => V.getInt16(q, true);

  for (let vueltas = 0; p + 6 <= B.length && vueltas < 200000; vueltas++) {
    const largo = V.getUint32(p, true) * 2, fn = V.getUint16(p + 4, true), d = p + 6;
    if (largo < 6 || fn === 0) break;
    const fin = Math.min(B.length, p + largo);
    try {
      switch (fn) {
        case 0x020b: oy = s16(d); ox = s16(d + 2); break;
        case 0x020c: if (!hayExt) { ey = s16(d); ex = s16(d + 2); hayExt = true; } break;
        case 0x02fa: poner({ t: "pluma", c: color(V.getUint32(d + 6, true)), w: Math.abs(s16(d + 2)), nula: (V.getUint16(d, true) & 15) === 5 }); break;
        case 0x02fc: poner({ t: "brocha", c: color(V.getUint32(d + 2, true)), nula: V.getUint16(d, true) === 1 }); break;
        case 0x02fb: poner({ t: "fuente", h: Math.abs(s16(d)) || 12, negrita: s16(d + 8) >= 600, cursiva: !!B[d + 10],
          cara: latin.decode(B.subarray(d + 18, fin)).split("\0")[0].replace(/[^\w \-]/g, "") }); break;
        case 0x00f7: case 0x01f9: case 0x06ff: case 0x0142: case 0x06fe: poner({ t: "otro" }); break;
        case 0x012d: { const o = objetos[V.getUint16(d, true)]; if (o?.t === "pluma") e.pluma = o; else if (o?.t === "brocha") e.brocha = o; else if (o?.t === "fuente") e.fuente = o; break; }
        case 0x01f0: objetos[V.getUint16(d, true)] = null; break;
        case 0x0209: e.tinta = color(V.getUint32(d, true)); break;
        case 0x0106: e.pares = V.getUint16(d, true) === 1; break;
        case 0x012e: e.alinear = V.getUint16(d, true); break;
        case 0x001e: pila.push({ ...e }); break;
        case 0x0127: if (pila.length) e = pila.pop(); break;
        case 0x0214: e.y = s16(d); e.x = s16(d + 2); break;
        case 0x0213: { const y = s16(d), x = s16(d + 2);
          if (!e.pluma.nula) partes.push(`<line x1="${e.x}" y1="${e.y}" x2="${x}" y2="${y}" ${trazo()}/>`);
          ver(e.x, e.y); ver(x, y); e.x = x; e.y = y; break; }
        case 0x041b: case 0x0418: case 0x061c: {
          const q = fn === 0x061c ? d + 4 : d;
          const b = s16(q), r = s16(q + 2), t = s16(q + 4), l = s16(q + 6);
          const x = Math.min(l, r), y = Math.min(t, b), w = Math.abs(r - l), h = Math.abs(b - t);
          ver(x, y); ver(x + w, y + h);
          partes.push(fn === 0x0418 ? `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" ${fondo()} ${trazo()}/>`
            : `<rect x="${x}" y="${y}" width="${w}" height="${h}"${fn === 0x061c ? ` rx="${Math.abs(s16(d + 2)) / 2}" ry="${Math.abs(s16(d)) / 2}"` : ""} ${fondo()} ${trazo()}/>`);
          break; }
        case 0x0324: case 0x0325: {
          const n = V.getUint16(d, true); let pts = "";
          for (let k = 0, q = d + 2; k < n && q + 4 <= fin; k++, q += 4) { const x = s16(q), y = s16(q + 2); ver(x, y); pts += `${x},${y} `; }
          partes.push(fn === 0x0324 ? `<polygon points="${pts}" ${fondo()} ${trazo()} fill-rule="${e.pares ? "evenodd" : "nonzero"}"/>` : `<polyline points="${pts}" fill="none" ${trazo()}/>`);
          break; }
        case 0x0538: {
          const n = V.getUint16(d, true); let q = d + 2 + n * 2, camino = "";
          for (let k = 0; k < n; k++) { const c = V.getUint16(d + 2 + k * 2, true);
            for (let j = 0; j < c && q + 4 <= fin; j++, q += 4) { const x = s16(q), y = s16(q + 2); ver(x, y); camino += `${j ? "L" : "M"}${x} ${y}`; }
            camino += "Z"; }
          partes.push(`<path d="${camino}" ${fondo()} ${trazo()} fill-rule="${e.pares ? "evenodd" : "nonzero"}"/>`);
          break; }
        case 0x0521: case 0x0a32: {
          let x, y, txt;
          if (fn === 0x0521) { const n = V.getUint16(d, true); txt = latin.decode(B.subarray(d + 2, d + 2 + n)); const q = d + 2 + n + (n & 1); y = s16(q); x = s16(q + 2); }
          else { y = s16(d); x = s16(d + 2); const n = V.getUint16(d + 4, true), op = V.getUint16(d + 6, true); const q = d + 8 + (op & 6 ? 8 : 0); txt = latin.decode(B.subarray(q, Math.min(fin, q + n))); }
          if (e.alinear & 1) { x = e.x; y = e.y; }
          const f = e.fuente, h = f.h;
          const horizontal = (e.alinear & 6) === 6 ? "middle" : e.alinear & 2 ? "end" : "start";
          const yy = (e.alinear & 24) === 24 ? y : e.alinear & 8 ? y - h * 0.2 : y + h * 0.82;
          ver(x, y); ver(x, y + h);
          if (txt.trim()) partes.push(`<text x="${x}" y="${yy}" font-size="${h}" text-anchor="${horizontal}" fill="${e.tinta}" font-family="${f.cara ? `'${f.cara}',` : ""}Arial,sans-serif"${f.negrita ? ' font-weight="700"' : ""}${f.cursiva ? ' font-style="italic"' : ""} xml:space="preserve">${esc(txt)}</text>`);
          break; }
        case 0x0f43: case 0x0b41: {
          const q = fn === 0x0f43 ? d + 6 : d + 4;
          const dh = s16(q + 8), dw = s16(q + 10), dy = s16(q + 12), dx = s16(q + 14);
          const url = dibAUrl(B.subarray(q + 16, fin));
          ver(dx, dy); ver(dx + dw, dy + dh);
          if (url) partes.push(`<image x="${Math.min(dx, dx + dw)}" y="${Math.min(dy, dy + dh)}" width="${Math.abs(dw)}" height="${Math.abs(dh)}" preserveAspectRatio="none" href="${url}" xlink:href="${url}"/>`);
          break; }
      }
    } catch { /* orden ilegible: se salta */ }
    p += largo;
  }
  if (!partes.length) return null;
  let x = ox, y = oy, w = ex, h = ey;
  if (!hayExt || !w || !h) { x = minX; y = minY; w = maxX - minX; h = maxY - minY; }
  if (w < 0) { x += w; w = -w; }
  if (h < 0) { y += h; h = -h; }
  if (!(w > 0 && h > 0)) return null;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${x} ${y} ${w} ${h}" preserveAspectRatio="none" stroke-linejoin="round">${partes.join("")}</svg>`;
}
