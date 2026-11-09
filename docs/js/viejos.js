// Lee el texto de los Office viejos (.ppt de PowerPoint 97-2003 y .doc de Word 97-2003), sin internet.
// Por dentro son un «archivo compuesto» (CFB): la librería cfb los abre y aquí se busca el texto.

/** PowerPoint: recorre los registros del flujo «PowerPoint Document» y junta el texto de cada diapositiva. */
export function textoDePpt(CFB, datos) {
  const cfb = CFB.read(datos, { type: "array" });
  const flujo = CFB.find(cfb, "PowerPoint Document");
  if (!flujo) throw new Error("No parece una presentación de PowerPoint.");
  const b = flujo.content;
  const vista = new DataView(b.buffer || new Uint8Array(b).buffer, b.byteOffset || 0, b.length);
  const latin = new TextDecoder("windows-1252");
  const utf16 = new TextDecoder("utf-16le");
  const diapos = [];
  let actual = null;
  const nueva = () => { actual = []; diapos.push(actual); };
  const recorrer = (inicio, fin, nivel) => {
    let p = inicio;
    while (p + 8 <= fin) {
      const verInst = vista.getUint16(p, true);
      const tipo = vista.getUint16(p + 2, true);
      const largo = vista.getUint32(p + 4, true);
      const datosIni = p + 8;
      const datosFin = Math.min(fin, datosIni + largo);
      if (datosFin < datosIni) break;
      if (tipo === 0x03f3) nueva(); // SlidePersistAtom: empieza una diapositiva en la lista de textos
      if ((verInst & 0x0f) === 0x0f) {
        if (tipo === 0x03ee) nueva(); // Slide (contenedor de una diapositiva dibujada)
        // Las maestras, las notas y los documentos de apoyo solo traen textos de plantilla: se saltan
        const plantilla = tipo === 0x03f8 || tipo === 0x0fc9 || tipo === 0x03f0;
        if (!plantilla && nivel < 12) recorrer(datosIni, datosFin, nivel + 1);
      } else if (tipo === 0x0fa0 || tipo === 0x0fa8) {
        // TextCharsAtom (UTF-16) o TextBytesAtom (8 bits)
        const trozo = new Uint8Array(vista.buffer, vista.byteOffset + datosIni, datosFin - datosIni);
        const t = (tipo === 0x0fa0 ? utf16 : latin).decode(trozo).replace(/\r/g, "\n").replace(/\v/g, "\n").trim();
        if (t && !/^\*$/.test(t)) {
          if (!actual) nueva();
          if (!actual.includes(t)) actual.push(t);
        }
      }
      p = datosFin;
    }
  };
  recorrer(0, b.length, 0);
  // Se quedan las diapositivas con texto y sin repetir (el texto aparece en la lista y en la diapositiva)
  const vistas = new Set();
  const paginas = [];
  for (const d of diapos) {
    const texto = d.join("\n").trim();
    if (!texto || vistas.has(texto)) continue;
    vistas.add(texto);
    paginas.push({ n: paginas.length + 1, etiqueta: "diap.", texto });
  }
  return paginas;
}

/** Word: lee la «tabla de piezas» (CLX) del documento para sacar el texto en orden. */
export function textoDeDoc(CFB, datos) {
  const cfb = CFB.read(datos, { type: "array" });
  const wd = CFB.find(cfb, "WordDocument");
  if (!wd) throw new Error("No parece un documento de Word.");
  const w = wd.content;
  const dv = (u8) => new DataView(u8.buffer || new Uint8Array(u8).buffer, u8.byteOffset || 0, u8.length);
  const vw = dv(w);
  if (vw.getUint16(0, true) !== 0xa5ec) throw new Error("Documento de Word no reconocido.");
  const tabla1 = (vw.getUint16(0x0a, true) & 0x0200) !== 0;
  const tbl = CFB.find(cfb, tabla1 ? "1Table" : "0Table");
  if (!tbl) throw new Error("Al documento le falta una parte (tabla).");
  const t = tbl.content;
  const vt = dv(t);
  // FIB: base (32 bytes), luego csw + fibRgW, cslw + fibRgLw, cbRgFcLcb + fibRgFcLcb
  let p = 32;
  const csw = vw.getUint16(p, true); p += 2 + csw * 2;
  const cslw = vw.getUint16(p, true); p += 2 + cslw * 4;
  p += 2; // cbRgFcLcb
  const fcClx = vw.getUint32(p + 33 * 8, true);
  const lcbClx = vw.getUint32(p + 33 * 8 + 4, true);
  if (!lcbClx || fcClx + lcbClx > t.length) throw new Error("No se encontró el texto del documento.");
  let q = fcClx;
  const finClx = fcClx + lcbClx;
  while (q < finClx && vt.getUint8(q) === 0x01) q += 3 + vt.getUint16(q + 1, true); // Prc (formato): se salta
  if (vt.getUint8(q) !== 0x02) throw new Error("No se encontró el texto del documento.");
  const lcb = vt.getUint32(q + 1, true);
  const ini = q + 5;
  const n = Math.floor((lcb - 4) / 12);
  const latin = new TextDecoder("windows-1252");
  const utf16 = new TextDecoder("utf-16le");
  let texto = "";
  for (let i = 0; i < n; i++) {
    const cp0 = vt.getUint32(ini + i * 4, true);
    const cp1 = vt.getUint32(ini + (i + 1) * 4, true);
    const pcd = ini + (n + 1) * 4 + i * 8;
    const fcRaw = vt.getUint32(pcd + 2, true);
    const comprimido = (fcRaw & 0x40000000) !== 0;
    const fc = fcRaw & 0x3fffffff;
    const cuantos = cp1 - cp0;
    if (cuantos <= 0) continue;
    if (comprimido) {
      const desde = fc / 2;
      texto += latin.decode(w.subarray ? w.subarray(desde, desde + cuantos) : new Uint8Array(w).subarray(desde, desde + cuantos));
    } else {
      texto += utf16.decode(w.subarray ? w.subarray(fc, fc + cuantos * 2) : new Uint8Array(w).subarray(fc, fc + cuantos * 2));
    }
  }
  // Limpieza: campos (\x13 código \x14 resultado \x15), celdas, saltos de página
  texto = texto
    .replace(/\x13[^\x13\x14\x15]*\x14/g, "").replace(/\x13[^\x13\x14\x15]*\x15/g, "").replace(/[\x14\x15]/g, "")
    .replace(/\x07/g, "\t").replace(/\r/g, "\n").replace(/[\x0b]/g, "\n").replace(/[\x01\x08\x1e\x1f]/g, "")
    .replace(/[\x00-\x08\x0e-\x1f]/g, "");
  // Páginas: por salto de página (\f) o, si no hay, en trozos de ~2500 letras
  let partes = texto.split("\f").map((x) => x.trim()).filter(Boolean);
  if (partes.length === 1 && partes[0].length > 3500) {
    const largo = partes[0];
    partes = [];
    let resto = largo;
    while (resto.length) {
      let corte = resto.length > 2500 ? resto.lastIndexOf("\n", 2500) : resto.length;
      if (corte < 1200) corte = Math.min(resto.length, 2500);
      partes.push(resto.slice(0, corte).trim());
      resto = resto.slice(corte);
    }
  }
  return partes.filter(Boolean).map((texto, k) => ({ n: k + 1, etiqueta: "pág.", texto }));
}
