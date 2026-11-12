// Dibuja un PowerPoint viejo (.ppt, 97-2003) con su formato: fondo, cuadros de texto, colores,
// tamaños de letra, viñetas, figuras e imágenes. Sin internet y sin pasar por PDF.
// El .ppt es un «archivo compuesto» (lo abre la librería cfb) con registros binarios; aquí se leen
// las diapositivas, su diapositiva maestra y los dibujos (formato «OfficeArt») y se arman en HTML.

import { wmfASvg } from "./wmf.js";

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const hex = (r, g, b) => "#" + [r, g, b].map((x) => (x & 255).toString(16).padStart(2, "0")).join("");
const n2 = (x) => Math.round(x * 100) / 100;

// Tipos de registro
const T = { Documento: 1000, DocAtom: 1001, Diapo: 1006, DiapoAtom: 1007, Entorno: 1010, PersistDiapo: 1011, Maestra: 1016,
  Esquema: 2032, Dibujo: 1036, GrupoDibujos: 1035, Lista: 4080, RefTexto: 3998, Cabeza: 3999, Letras: 4000, Estilo: 4001,
  EstiloMaestro: 4003, Bytes: 4008, Fuentes: 2005, Fuente: 4023, Marcador: 3011, Edicion: 4085, Directorio: 6002,
  Dg: 0xf002, Spgr: 0xf003, Sp: 0xf004, BStore: 0xf001, Bse: 0xf007, RSpgr: 0xf009, RSp: 0xf00a, Opt: 0xf00b,
  Texto: 0xf00d, AnclaHija: 0xf00f, Ancla: 0xf010, Datos: 0xf011 };

/**
 * Lee la presentación. Devuelve { ancho, alto, diapos: [html] } con medidas en puntos (1 pt = 1 px CSS).
 * hacerUrl(bytes, mime) debe devolver una dirección para la imagen (blob: o data:).
 */
export function leerPpt(CFB, datos, hacerUrl) {
  const cfb = CFB.read(datos, { type: "array" });
  const flujo = CFB.find(cfb, "PowerPoint Document");
  if (!flujo) throw new Error("No parece una presentación de PowerPoint.");
  const u8 = (c) => (c instanceof Uint8Array ? c : new Uint8Array(c));
  const B = u8(flujo.content);
  const V = new DataView(B.buffer, B.byteOffset, B.length);
  const fotos = CFB.find(cfb, "Pictures");
  const F = fotos ? u8(fotos.content) : new Uint8Array(0);
  const FV = new DataView(F.buffer, F.byteOffset, F.length);
  const latin = new TextDecoder("windows-1252");
  const utf16 = new TextDecoder("utf-16le");

  const reg = (p, fin = B.length) => {
    if (p + 8 > fin) return null;
    const vi = V.getUint16(p, true);
    const largo = V.getUint32(p + 4, true);
    return { ver: vi & 15, inst: vi >> 4, tipo: V.getUint16(p + 2, true), ini: p + 8, fin: Math.min(fin, p + 8 + largo) };
  };
  const hijos = (r) => {
    const lista = [];
    let p = r.ini;
    for (;;) {
      const h = reg(p, r.fin);
      if (!h || h.fin < h.ini) break;
      lista.push(h);
      p = h.fin;
    }
    return lista;
  };
  const hijo = (r, tipo) => hijos(r).find((h) => h.tipo === tipo);

  // ---------- Dónde está cada cosa (directorio de «persistencia») ----------
  const persist = new Map();
  let docRef = 0;
  const usuario = CFB.find(cfb, "Current User");
  if (usuario) {
    const U = u8(usuario.content);
    const UV = new DataView(U.buffer, U.byteOffset, U.length);
    if (U.length >= 20) {
      if (UV.getUint32(12, true) === 0xf3d1c4df) throw new Error("La presentación tiene contraseña.");
      let pos = UV.getUint32(16, true);
      for (let vueltas = 0; pos && vueltas < 500; vueltas++) {
        const ed = reg(pos);
        if (!ed || ed.tipo !== T.Edicion) break;
        if (!docRef) docRef = V.getUint32(ed.ini + 16, true);
        const dir = reg(V.getUint32(ed.ini + 12, true));
        if (dir && dir.tipo === T.Directorio) {
          let q = dir.ini;
          while (q + 4 <= dir.fin) {
            const x = V.getUint32(q, true); q += 4;
            const id = x & 0xfffff, cuantos = x >>> 20;
            for (let k = 0; k < cuantos && q + 4 <= dir.fin; k++, q += 4) if (!persist.has(id + k)) persist.set(id + k, V.getUint32(q, true));
          }
        }
        pos = V.getUint32(ed.ini + 8, true);
      }
    }
  }
  let documento = docRef && persist.has(docRef) ? reg(persist.get(docRef)) : null;
  // Sin directorio (archivo raro): se recorre el flujo de arriba abajo
  const sueltos = [];
  if (!documento || documento.tipo !== T.Documento) {
    let p = 0;
    for (;;) {
      const r = reg(p);
      if (!r || r.fin < r.ini) break;
      if (r.tipo === T.Documento) documento = r;
      if (r.tipo === T.Diapo || r.tipo === T.Maestra) sueltos.push(r);
      p = r.fin;
    }
    if (!documento) throw new Error("No se pudo leer la presentación.");
  }

  // ---------- Documento: tamaño, fuentes, estilos por defecto, imágenes, listas ----------
  const docAtom = hijo(documento, T.DocAtom);
  const ancho = docAtom ? V.getInt32(docAtom.ini, true) / 8 : 720;
  const alto = docAtom ? V.getInt32(docAtom.ini + 4, true) / 8 : 540;
  const fuentes = [];
  const estilosDoc = {};
  const entorno = hijo(documento, T.Entorno);
  if (entorno) {
    const col = hijo(entorno, T.Fuentes);
    if (col) for (const f of hijos(col)) if (f.tipo === T.Fuente) fuentes[f.inst] = utf16.decode(B.subarray(f.ini, f.ini + 64)).split("\0")[0];
    for (const e of hijos(entorno)) if (e.tipo === T.EstiloMaestro) estilosDoc[e.inst] = e;
  }
  const blips = []; // desplazamiento de cada imagen en el flujo «Pictures»
  const gd = hijo(documento, T.GrupoDibujos);
  if (gd) {
    const dgg = hijos(gd)[0];
    const tienda = dgg && hijo(dgg, T.BStore);
    if (tienda) for (const b of hijos(tienda)) blips.push(b.tipo === T.Bse ? { pos: V.getUint32(b.ini + 28, true), largo: V.getUint32(b.ini + 20, true) } : null);
  }
  const urls = new Map();
  const imagen = (pib) => {
    if (urls.has(pib)) return urls.get(pib);
    let url = null;
    const b = blips[pib - 1];
    if (b && b.pos + 8 <= F.length) {
      const vi = FV.getUint16(b.pos, true), tipo = FV.getUint16(b.pos + 2, true), largo = FV.getUint32(b.pos + 4, true);
      const inst = vi >> 4, ini = b.pos + 8, fin = Math.min(F.length, ini + largo);
      const dosUid = [0x46b, 0x6e3, 0x6e1, 0x7a9].includes(inst);
      const d = ini + (dosUid ? 32 : 16) + 1;
      if (tipo === 0xf01d || tipo === 0xf02a) url = hacerUrl(F.subarray(d, fin), "image/jpeg");
      else if (tipo === 0xf01e) url = hacerUrl(F.subarray(d, fin), "image/png");
      else if (tipo === 0xf01f && d + 40 < fin) {
        // DIB: se le pone la cabecera de archivo .bmp
        const cab = FV.getUint32(d, true), bits = FV.getUint16(d + 14, true), usados = FV.getUint32(d + 32, true);
        const paleta = bits <= 8 ? (usados || 1 << bits) * 4 : 0;
        const bmp = new Uint8Array(14 + fin - d);
        const bv = new DataView(bmp.buffer);
        bmp[0] = 0x42; bmp[1] = 0x4d; bv.setUint32(2, bmp.length, true); bv.setUint32(10, 14 + cab + paleta, true);
        bmp.set(F.subarray(d, fin), 14);
        url = hacerUrl(bmp, "image/bmp");
      } else if (tipo === 0xf01b) {
        // WMF (gráficas y dibujos vectoriales): viene comprimido; se pasa a SVG
        try {
          const m = ini + (inst & 1 ? 32 : 16);
          let wmf = F.subarray(m + 34, fin);
          if (F[m + 32] === 0) wmf = new Uint8Array(CFB.utils._inflateRaw(wmf.subarray(2), FV.getUint32(m, true)));
          const svg = wmfASvg(wmf);
          if (svg) url = hacerUrl(new TextEncoder().encode(svg), "image/svg+xml");
        } catch { /* dibujo ilegible */ }
      }
    }
    urls.set(pib, url);
    return url;
  };

  // Listas: maestras (inst 1) y diapositivas (inst 0), con los textos del esquema de cada diapositiva
  const maestras = new Map(); // slideId -> registro
  const orden = []; // [{ r, textos }]
  for (const lista of hijos(documento)) {
    if (lista.tipo !== T.Lista || lista.inst > 1) continue;
    let actual = null;
    for (const h of hijos(lista)) {
      if (h.tipo === T.PersistDiapo) {
        const r = persist.has(V.getUint32(h.ini, true)) ? reg(persist.get(V.getUint32(h.ini, true))) : null;
        actual = { r, textos: [] };
        if (r && lista.inst === 1) maestras.set(V.getUint32(h.ini + 12, true), r);
        else if (r) orden.push(actual);
      } else if (actual) {
        if (h.tipo === T.Cabeza) actual.textos.push({ tipo: V.getUint32(h.ini, true), str: "", estilo: null });
        else if (actual.textos.length) leerTexto(h, actual.textos[actual.textos.length - 1]);
      }
    }
  }
  if (!orden.length) for (const r of sueltos) (r.tipo === T.Maestra ? maestras.set(maestras.size + 1, r) : orden.push({ r, textos: [] }));

  function leerTexto(h, t) {
    if (h.tipo === T.Letras) t.str = utf16.decode(B.subarray(h.ini, h.fin));
    else if (h.tipo === T.Bytes) t.str = latin.decode(B.subarray(h.ini, h.fin));
    else if (h.tipo === T.Estilo) t.estilo = h;
  }

  // ---------- Estilos de texto ----------
  /** Párrafo: devuelve [propiedades, posición siguiente] */
  const leerPF = (p) => {
    const m = V.getUint32(p, true); p += 4;
    const o = {};
    const u = () => { const x = V.getUint16(p, true); p += 2; return x; };
    const s = () => { const x = V.getInt16(p, true); p += 2; return x; };
    if (m & 0xf) { const f = u(); if (m & 1) o.vineta = !!(f & 1); if (m & 2) o.vFuenteSi = !!(f & 2); if (m & 4) o.vColorSi = !!(f & 4); if (m & 8) o.vTamSi = !!(f & 8); }
    if (m & 0x80) o.vLetra = String.fromCharCode(u());
    if (m & 0x10) o.vFuente = u();
    if (m & 0x40) o.vTam = s();
    if (m & 0x20) { o.vColor = V.getUint32(p, true); p += 4; }
    if (m & 0x800) o.alinear = u();
    if (m & 0x1000) o.interlinea = s();
    if (m & 0x2000) o.antes = s();
    if (m & 0x4000) o.despues = s();
    if (m & 0x100) o.margen = s();
    if (m & 0x400) o.sangria = s();
    if (m & 0x8000) p += 2;
    if (m & 0x100000) p += 2 + V.getUint16(p, true) * 4;
    if (m & 0x10000) p += 2;
    if (m & 0xe0000) p += 2;
    if (m & 0x200000) p += 2;
    return [o, p];
  };
  /** Letras: devuelve [propiedades, posición siguiente] */
  const leerCF = (p) => {
    const m = V.getUint32(p, true); p += 4;
    const o = {};
    if (m & 0xffff) { const f = V.getUint16(p, true); p += 2; if (m & 1) o.negrita = !!(f & 1); if (m & 2) o.cursiva = !!(f & 2); if (m & 4) o.subrayado = !!(f & 4); if (m & 0x10) o.sombra = !!(f & 0x10); }
    if (m & 0x10000) { o.fuente = V.getUint16(p, true); p += 2; }
    if (m & 0x200000) p += 2;
    if (m & 0x400000) p += 2;
    if (m & 0x800000) p += 2;
    if (m & 0x20000) { o.tam = V.getUint16(p, true); p += 2; }
    if (m & 0x40000) { o.color = V.getUint32(p, true); p += 4; }
    if (m & 0x80000) { o.pos = V.getInt16(p, true); p += 2; }
    return [o, p];
  };
  /** Estilos de una maestra por tipo de texto: { tipo: [ {pf, cf} x5 ] } */
  const estilosDe = (registros) => {
    const salida = {};
    const tipos = Object.keys(registros).map(Number).sort((a, b) => a - b);
    for (const tipo of tipos) {
      const r = registros[tipo];
      try {
        const base = tipo >= 5 ? salida[tipo === 6 ? 0 : 1] : null;
        const niveles = base ? base.map((n) => ({ pf: { ...n.pf }, cf: { ...n.cf } })) : [];
        let p = r.ini;
        const cuantos = V.getUint16(p, true); p += 2;
        for (let k = 0; k < cuantos && p < r.fin; k++) {
          let nivel = k;
          if (tipo >= 5) { nivel = V.getUint16(p, true); p += 2; }
          let pf, cf;
          [pf, p] = leerPF(p);
          [cf, p] = leerCF(p);
          const previo = niveles[nivel] || niveles[nivel - 1] || { pf: {}, cf: {} };
          niveles[nivel] = { pf: { ...previo.pf, ...pf }, cf: { ...previo.cf, ...cf } };
        }
        for (let k = 1; k < 5; k++) niveles[k] ||= niveles[k - 1];
        salida[tipo] = niveles;
      } catch { /* estilo ilegible: se usan los valores por defecto */ }
    }
    return salida;
  };
  const DEFECTO = { 0: { tam: 44 }, 1: { tam: 32 }, 4: { tam: 18 } };
  const estiloDocumento = estilosDe(estilosDoc);

  // ---------- Dibujos ----------
  const propsDe = (opt, destino) => {
    let p = opt.ini;
    let c = opt.ini + opt.inst * 6; // los datos «complejos» (listas de puntos, nombres…) van después de la tabla
    for (let k = 0; k < opt.inst && p + 6 <= opt.fin; k++, p += 6) {
      const id = V.getUint16(p, true), v = V.getUint32(p + 2, true);
      destino.set(id & 0x3fff, v);
      if (id & 0x8000) { destino.set("c" + (id & 0x3fff), [c, v]); c += v; }
    }
  };
  /** Figura a mano alzada: sus puntos y tramos como trazo SVG (o null si usa fórmulas o arcos) */
  const trazoDe = (f) => {
    const pv = f.props.get("c" + 0x145);
    if (!pv || pv[1] < 6) return null;
    const cuantos = V.getUint16(pv[0], true), tam = V.getUint16(pv[0] + 4, true) === 0xfff0 ? 2 : 4;
    const pts = [];
    for (let k = 0, q = pv[0] + 6; k < cuantos && q + tam * 2 <= pv[0] + pv[1]; k++, q += tam * 2) {
      const x = tam === 2 ? V.getInt16(q, true) : V.getInt32(q, true), y = tam === 2 ? V.getInt16(q + tam, true) : V.getInt32(q + tam, true);
      if (tam === 4 && ((x >>> 0) >= 0x80000000 && (x >>> 0) < 0x80000400 || (y >>> 0) >= 0x80000000 && (y >>> 0) < 0x80000400)) return { formulas: cuantos };
      pts.push([x, y]);
    }
    if (pts.length < 2) return null;
    const g = [0x140, 0x141, 0x142, 0x143].map((id, k) => (f.props.has(id) ? f.props.get(id) | 0 : k < 2 ? 0 : 21600));
    let [x0, y0, x1, y1] = g;
    if (x1 <= x0 || y1 <= y0) { x0 = Math.min(...pts.map((p) => p[0])); x1 = Math.max(...pts.map((p) => p[0])); y0 = Math.min(...pts.map((p) => p[1])); y1 = Math.max(...pts.map((p) => p[1])); }
    const P = (k) => `${pts[k][0] - x0} ${pts[k][1] - y0}`;
    let d = "", i = 0;
    const ps = f.props.get("c" + 0x146);
    if (ps && ps[1] > 6) {
      const n = V.getUint16(ps[0], true);
      for (let k = 0, q = ps[0] + 6; k < n && q + 2 <= ps[0] + ps[1]; k++, q += 2) {
        const v = V.getUint16(q, true), tipo = v >> 13, cant = v & 0x1fff;
        if (tipo === 0) for (let c = 0; c < Math.max(cant, 1) && i < pts.length; c++) d += `L${P(i++)}`;
        else if (tipo === 1) for (let c = 0; c < Math.max(cant, 1) && i + 2 < pts.length; c++, i += 3) d += `C${P(i)} ${P(i + 1)} ${P(i + 2)}`;
        else if (tipo === 2 && i < pts.length) d += `M${P(i++)}`;
        else if (tipo === 3) d += "Z";
        else if (tipo === 4) break;
        else if (tipo === 5 && ((v >> 8) & 31) < 10) return null; // arcos y elipses: no se dibujan aquí
      }
    } else d = pts.map((_, k) => (k ? "L" : "M") + P(k)).join("");
    if (!d.startsWith("M")) d = "M" + P(0) + d;
    return { d, w: x1 - x0 || 1, h: y1 - y0 || 1 };
  };
  /** Lee las figuras de un contenedor de dibujo: { fondo, formas } */
  const figurasDe = (cont, textos) => {
    const dibujo = cont && hijo(cont, T.Dibujo);
    const dg = dibujo && hijo(dibujo, T.Dg);
    const res = { fondo: null, formas: [] };
    if (!dg) return res;
    const forma = (sp, mapa) => {
      const f = { tipo: 0, banderas: 0, props: new Map(), caja: null, marcador: null, texto: null, grupo: null };
      for (const h of hijos(sp)) {
        if (h.tipo === T.RSp) { f.tipo = h.inst; f.banderas = V.getUint32(h.ini + 4, true); }
        else if (h.tipo === T.RSpgr) f.grupo = [0, 4, 8, 12].map((d) => V.getInt32(h.ini + d, true));
        else if (h.tipo === T.Opt) propsDe(h, f.props);
        else if (h.tipo === T.Ancla) {
          const largo = h.fin - h.ini;
          const [t, l, r, b] = largo >= 16 ? [0, 4, 8, 12].map((d) => V.getInt32(h.ini + d, true)) : [0, 2, 4, 6].map((d) => V.getInt16(h.ini + d, true));
          f.caja = { x: l / 8, y: t / 8, w: (r - l) / 8, h: (b - t) / 8 };
        } else if (h.tipo === T.AnclaHija) {
          const [l, t, r, b] = [0, 4, 8, 12].map((d) => V.getInt32(h.ini + d, true));
          f.caja = mapa ? mapa(l, t, r, b) : { x: l / 8, y: t / 8, w: (r - l) / 8, h: (b - t) / 8 };
        } else if (h.tipo === T.Datos) {
          const m = hijo(h, T.Marcador);
          if (m) f.marcador = V.getUint8(m.ini + 4);
        } else if (h.tipo === T.Texto) {
          const t = { tipo: 4, str: "", estilo: null };
          let ref = null;
          for (const x of hijos(h)) {
            if (x.tipo === T.Cabeza) t.tipo = V.getUint32(x.ini, true);
            else if (x.tipo === T.RefTexto) ref = V.getInt32(x.ini, true);
            else leerTexto(x, t);
          }
          f.texto = ref !== null && textos?.[ref] ? textos[ref] : t;
        }
      }
      return f;
    };
    const grupo = (g, mapa) => {
      const partes = hijos(g);
      let propio = null;
      for (const h of partes) {
        if (h.tipo === T.Sp) {
          const f = forma(h, mapa);
          if (!propio && f.grupo) {
            // La primera figura describe al grupo: su caja real y su sistema de coordenadas
            propio = f;
            const [gl, gt, gr, gb] = f.grupo;
            const c = f.caja;
            if (c && gr !== gl && gb !== gt) {
              const sx = c.w / (gr - gl), sy = c.h / (gb - gt);
              var hija = (l, t, r, b) => ({ x: c.x + (l - gl) * sx, y: c.y + (t - gt) * sy, w: (r - l) * sx, h: (b - t) * sy });
            }
            continue;
          }
          if (f.caja) res.formas.push(f);
        } else if (h.tipo === T.Spgr) grupo(h, propio && hija ? hija : mapa);
      }
    };
    for (const h of hijos(dg)) {
      if (h.tipo === T.Spgr) grupo(h, null);
      else if (h.tipo === T.Sp) res.fondo = forma(h, null);
    }
    return res;
  };

  const esquemaDe = (cont) => {
    const todos = cont ? hijos(cont).filter((h) => h.tipo === T.Esquema) : [];
    const e = todos.find((h) => h.inst === 1) || todos[0]; // la maestra trae varios: el suyo es el de instancia 1
    if (!e) return null;
    return Array.from({ length: 8 }, (_, k) => hex(B[e.ini + k * 4], B[e.ini + k * 4 + 1], B[e.ini + k * 4 + 2]));
  };
  const ESQUEMA = ["#ffffff", "#000000", "#808080", "#000000", "#bbe0e3", "#333399", "#009999", "#99cc00"];

  // Maestras ya leídas: { figuras, esquema, estilos, padre }
  const cacheM = new Map();
  const maestraDe = (id, vistos = 0) => {
    if (cacheM.has(id)) return cacheM.get(id);
    const r = maestras.get(id) || (maestras.size ? [...maestras.values()][0] : null);
    let m = null;
    if (r) {
      const atom = hijo(r, T.DiapoAtom);
      const padre = r.tipo === T.Diapo && atom && vistos < 3 ? maestraDe(V.getUint32(atom.ini + 12, true), vistos + 1) : null;
      const propios = {};
      for (const e of hijos(r)) if (e.tipo === T.EstiloMaestro) propios[e.inst] = e;
      m = { figuras: figurasDe(r, null), esquema: esquemaDe(r) || padre?.esquema || ESQUEMA,
        estilos: { ...estiloDocumento, ...(padre?.estilos || {}), ...estilosDe(propios) }, padre };
    }
    cacheM.set(id, m);
    return m;
  };

  // ---------- De figuras a HTML ----------
  const colorArt = (v, esquema) => {
    const r = v & 255, g = (v >> 8) & 255, b = (v >> 16) & 255, f = v >>> 24;
    if (f & 0x08) return esquema[r] || "#000000";
    if (f & 0x10) return null; // color del sistema o calculado: no se conoce
    return hex(r, g, b);
  };
  const colorTexto = (v, esquema) => {
    const idx = v >>> 24;
    return idx < 8 ? esquema[idx] : hex(v & 255, (v >> 8) & 255, (v >> 16) & 255);
  };
  const RECORTES = {
    4: "50% 0,100% 50%,50% 100%,0 50%", 5: "50% 0,100% 100%,0 100%", 6: "0 0,100% 100%,0 100%", 7: "25% 0,100% 0,75% 100%,0 100%",
    8: "25% 0,75% 0,100% 100%,0 100%", 9: "25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%",
    10: "29% 0,71% 0,100% 29%,100% 71%,71% 100%,29% 100%,0 71%,0 29%",
    13: "0 25%,65% 25%,65% 0,100% 50%,65% 100%,65% 75%,0 75%", 66: "100% 25%,35% 25%,35% 0,0 50%,35% 100%,35% 75%,100% 75%",
    67: "25% 0,75% 0,75% 65%,100% 65%,50% 100%,0 65%,25% 65%", 68: "25% 100%,75% 100%,75% 35%,100% 35%,50% 0,0 35%,25% 35%",
    15: "0 0,75% 0,100% 50%,75% 100%,0 100%", 55: "0 0,75% 0,100% 50%,75% 100%,0 100%,25% 50%", 56: "50% 0,100% 38%,81% 100%,19% 100%,0 38%",
    69: "0 50%,20% 0,20% 25%,80% 25%,80% 0,100% 50%,80% 100%,80% 75%,20% 75%,20% 100%",
  };
  const esLinea = (t) => t === 20 || (t >= 32 && t <= 40);

  const htmlTexto = (f, m, esquema, heredada, numero) => {
    const t = f.texto;
    let str = t.str.replace(/\r$/, "");
    if (!str.trim()) return "";
    const tipo = t.tipo;
    const niveles = m?.estilos[tipo] || m?.estilos[tipo >= 5 ? (tipo === 6 ? 0 : 1) : 4] || [];
    const defecto = DEFECTO[tipo === 6 ? 0 : tipo >= 5 ? 1 : tipo] || DEFECTO[4];
    // Tramos de estilo
    const total = t.str.length + 1;
    const parrafos = [], letras = [];
    if (t.estilo) {
      try {
        let p = t.estilo.ini, suma = 0;
        while (suma < total && p + 10 <= t.estilo.fin) {
          const cuantos = V.getUint32(p, true), nivel = V.getUint16(p + 4, true);
          let pf; [pf, p] = leerPF(p + 6);
          parrafos.push({ hasta: (suma += cuantos), nivel: Math.min(nivel, 4), pf });
        }
        suma = 0;
        while (suma < total && p + 8 <= t.estilo.fin) {
          const cuantos = V.getUint32(p, true);
          let cf; [cf, p] = leerCF(p + 4);
          letras.push({ hasta: (suma += cuantos), cf });
        }
      } catch { /* estilo ilegible */ }
    }
    if (!parrafos.length) parrafos.push({ hasta: total, nivel: 0, pf: {} });
    if (!letras.length) letras.push({ hasta: total, cf: {} });
    const pfEn = (i) => parrafos.find((x) => i < x.hasta) || parrafos[parrafos.length - 1];
    const cfEn = (i) => letras.find((x) => i < x.hasta) || letras[letras.length - 1];

    let html = "";
    let i = 0;
    for (const linea of str.split("\r")) {
      const pr = pfEn(i);
      const base = niveles[pr.nivel] || { pf: {}, cf: {} };
      const pf = { ...base.pf, ...pr.pf };
      // Trozos con el mismo estilo de letra dentro del párrafo
      let trozos = "", primero = null, j = 0;
      while (j < linea.length || (j === 0 && !linea.length)) {
        const tramo = cfEn(i + j);
        const fin = Math.min(linea.length, tramo.hasta - i);
        const cf = { ...defecto, ...base.cf, ...tramo.cf };
        primero ||= cf;
        const txt = linea.slice(j, Math.max(fin, j + (linea.length ? 1 : 0)));
        let est = `font-size:${cf.tam || 18}px;color:${cf.color !== undefined ? colorTexto(cf.color, esquema) : esquema[tipo === 0 || tipo === 6 ? 3 : 1]};`;
        if (cf.negrita) est += "font-weight:700;";
        if (cf.cursiva) est += "font-style:italic;";
        if (cf.subrayado) est += "text-decoration:underline;";
        if (cf.sombra) est += "text-shadow:1px 1px 1px rgba(0,0,0,.45);";
        if (cf.pos) est += `vertical-align:${cf.pos > 0 ? "super" : "sub"};font-size:${Math.round((cf.tam || 18) * 0.65)}px;`;
        const fam = fuentes[cf.fuente];
        if (fam) est += `font-family:'${fam.replace(/['"\\<>]/g, "")}',sans-serif;`;
        trozos += `<span style="${est}">${esc(txt.replace(/\*/g, tipo === 4 && /^\*$/.test(str.trim()) ? String(numero) : "*")).replace(/\v/g, "<br>") || "&nbsp;"}</span>`;
        if (!linea.length) break;
        j = Math.max(fin, j + 1);
      }
      const tam = primero?.tam || 18;
      const margen = (pf.margen || 0) / 8, sangria = (pf.sangria || 0) / 8;
      let est = `text-align:${["left", "center", "right", "justify"][pf.alinear] || "left"};`;
      const il = pf.interlinea;
      est += `line-height:${il > 0 ? n2((il / 100) * 1.2) : il < 0 ? n2(-il / 8) + "px" : 1.2};`;
      const esp = (v) => (v > 0 ? n2((v / 100) * tam * 1.2) : v < 0 ? n2(-v / 8) : 0);
      if (pf.antes) est += `margin-top:${esp(pf.antes)}px;`;
      if (pf.despues) est += `margin-bottom:${esp(pf.despues)}px;`;
      let vineta = "";
      if (pf.vineta && linea.trim()) {
        const vt = pf.vTamSi && pf.vTam ? (pf.vTam > 0 ? (tam * pf.vTam) / 100 : -pf.vTam) : tam;
        const vc = pf.vColorSi && pf.vColor !== undefined ? colorTexto(pf.vColor, esquema) : primero?.color !== undefined ? colorTexto(primero.color, esquema) : esquema[1];
        const letra = pf.vLetra && pf.vLetra.charCodeAt(0) > 32 && pf.vLetra.charCodeAt(0) < 0xf000 && !(pf.vFuenteSi && /wingdings|symbol|webdings/i.test(fuentes[pf.vFuente] || "")) ? pf.vLetra : "•";
        const hueco = Math.max(margen - sangria, tam * 0.75);
        est += `padding-left:${n2(Math.max(margen, sangria + hueco))}px;text-indent:${n2(-hueco)}px;`;
        vineta = `<span style="display:inline-block;width:${n2(hueco)}px;text-indent:0;font-size:${n2(vt)}px;color:${vc}">${esc(letra)}</span>`;
      } else {
        if (margen) est += `padding-left:${n2(margen)}px;`;
        if (sangria - margen) est += `text-indent:${n2(sangria - margen)}px;`;
      }
      html += `<div style="${est}">${vineta}${trozos}</div>`;
      i += linea.length + 1;
    }
    const prop = (id, def) => (f.props.has(id) ? f.props.get(id) : heredada?.props.has(id) ? heredada.props.get(id) : def);
    const ins = [prop(0x82, 45720), prop(0x83, 91440), prop(0x84, 45720), prop(0x81, 91440)].map((e) => n2((e | 0) / 12700));
    const ancla = prop(0x87, 0);
    const vert = [1, 4, 9].includes(ancla) ? "center" : [2, 5, 7].includes(ancla) ? "flex-end" : "flex-start";
    const noAjusta = prop(0x85, 0) === 2;
    return `<div class="ppt-texto" style="justify-content:${vert};padding:${ins.join("px ")}px;${noAjusta ? "white-space:nowrap;" : ""}${[3, 4, 5].includes(ancla) ? "align-items:center;" : ""}"><div class="ppt-parrafos">${html}</div></div>`;
  };

  const relleno = (f, esquema, heredada, porDefecto) => {
    const prop = (id, def) => (f.props.has(id) ? f.props.get(id) : heredada?.props.has(id) ? heredada.props.get(id) : def);
    const bools = prop(0x1bf, 0);
    const lleno = bools & 0x100000 ? !!(bools & 0x10) : porDefecto;
    if (!lleno) return "";
    const tipo = prop(0x180, 0);
    const c1 = colorArt(prop(0x181, 0x08000004), esquema) || "#ffffff";
    if (tipo === 2 || tipo === 3) {
      const url = imagen(prop(0x186, 0));
      if (url) return `background:${c1} url('${url}') center/${tipo === 3 ? "100% 100%" : "auto"};`;
    }
    if (tipo >= 4 && tipo <= 7) {
      const c2 = colorArt(prop(0x183, 0x08000000), esquema) || "#ffffff";
      const ang = ((prop(0x18b, 0) | 0) / 65536) || 0;
      return tipo === 4 || tipo === 7 ? `background:linear-gradient(${n2(180 - ang)}deg,${c1},${c2});` : `background:radial-gradient(${c2},${c1});`;
    }
    const op = prop(0x182, 65536);
    if (op < 65536) { const a = Math.max(0, op / 65536); const n = parseInt(c1.slice(1), 16); return `background:rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${n2(a)});`; }
    return `background:${c1};`;
  };

  const htmlForma = (f, m, esquema, numero) => {
    const c = f.caja;
    if (!c) return "";
    // Las casillas de la diapositiva heredan de la casilla del mismo tipo en la maestra
    let heredada = null;
    if (f.marcador && m) {
      const mapa = { 13: [1], 14: [2], 15: [3, 1], 16: [4, 2], 17: [1], 18: [2], 7: [7], 8: [8], 9: [9] }[f.marcador] || [];
      for (let x = m; x && !heredada; x = x.padre) heredada = x.figuras.formas.find((g) => mapa.includes(g.marcador) || g.marcador === f.marcador) || null;
    }
    const prop = (id, def) => (f.props.has(id) ? f.props.get(id) : heredada?.props.has(id) ? heredada.props.get(id) : def);
    const tieneTexto = !!f.texto?.str.trim();
    const pib = prop(0x104, 0);
    if (f.marcador && !tieneTexto && !pib) return ""; // casilla vacía («Haga clic para agregar…»)
    const x = Math.min(c.x, c.x + c.w), y = Math.min(c.y, c.y + c.h), w = Math.abs(c.w), h = Math.abs(c.h);
    let est = `left:${n2(x)}px;top:${n2(y)}px;width:${n2(w)}px;height:${n2(h)}px;`;
    const giro = (prop(4, 0) | 0) / 65536;
    const volteoH = f.banderas & 0x40, volteoV = f.banderas & 0x80;
    const lb = prop(0x1ff, 0);
    const conLinea = lb & 0x80000 ? !!(lb & 0x8) : !(f.tipo === 75 || f.tipo === 202 || f.marcador);
    const colorLinea = colorArt(prop(0x1c0, 0x08000001), esquema) || "#000000";
    const grosor = Math.max(0.5, prop(0x1cb, 9525) / 12700);

    if (esLinea(f.tipo)) {
      if (!conLinea) return "";
      const [x1, x2] = volteoH ? [w, 0] : [0, w], [y1, y2] = volteoV ? [h, 0] : [0, h];
      const punta = (id, clave) => (prop(id, 0) ? `marker-${clave}="url(#ppt-f)"` : "");
      return `<svg class="ppt-forma" style="${est}overflow:visible${giro ? `;transform:rotate(${n2(giro)}deg)` : ""}" viewBox="0 0 ${n2(w) || 1} ${n2(h) || 1}" preserveAspectRatio="none">
        <defs><marker id="ppt-f" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${colorLinea}"/></marker></defs>
        <line x1="${n2(x1)}" y1="${n2(y1)}" x2="${n2(x2)}" y2="${n2(y2)}" stroke="${colorLinea}" stroke-width="${n2(grosor)}" ${punta(0x1d0, "start")} ${punta(0x1d1, "end")}/></svg>`;
    }
    let dentro = "";
    if (pib) {
      const url = imagen(pib);
      // Recorte hecho en PowerPoint: fracción de la imagen que se esconde por cada lado
      const rec = [0x100, 0x101, 0x102, 0x103].map((id) => Math.max(-0.9, Math.min(0.95, (prop(id, 0) | 0) / 65536)));
      const [rArr, rAba, rIzq, rDer] = rec;
      const visW = Math.max(0.05, 1 - rIzq - rDer), visH = Math.max(0.05, 1 - rArr - rAba);
      const recortada = rec.some((x) => x !== 0);
      const img = `<img src="${url}" alt="" style="position:absolute;left:${n2((-rIzq / visW) * 100)}%;top:${n2((-rArr / visH) * 100)}%;width:${n2(100 / visW)}%;height:${n2(100 / visH)}%;max-width:none${volteoH || volteoV ? `;transform:scale(${volteoH ? -1 : 1},${volteoV ? -1 : 1})` : ""}">`;
      dentro += !url ? `<div class="ppt-sin-imagen">imagen</div>` : recortada ? `<div style="position:absolute;inset:0;overflow:hidden">${img}</div>` : img;
    }
    let tipo = f.tipo;
    let libre = tipo === 0 || tipo === 100 || tipo === 4095; // figura a mano alzada o sin tipo
    if (libre) {
      const tz = trazoDe(f);
      if (tz?.d) {
        const rl = relleno(f, esquema, heredada, true).match(/background:([^;(]+(\([^)]*\))?)/);
        dentro = `<svg style="position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible" viewBox="0 0 ${tz.w} ${tz.h}" preserveAspectRatio="none"><path d="${tz.d}" fill="${rl && !/url|gradient/.test(rl[1]) ? rl[1].trim() : "none"}" stroke="${conLinea ? colorLinea : "none"}" stroke-width="${n2(grosor)}" vector-effect="non-scaling-stroke"/></svg>` + dentro;
      } else if (tz?.formulas) { tipo = tz.formulas === 9 ? 3 : tz.formulas === 12 ? 2 : 1; libre = false; } // guardada por LibreOffice: elipse, rectángulo redondeado o rectángulo
    }
    if (!libre) {
      est += relleno(f, esquema, heredada, !(tipo === 75 || tipo === 202 || f.marcador));
      const recorte = RECORTES[tipo];
      if (recorte) est += `clip-path:polygon(${recorte});`;
      else {
        if (conLinea) est += `border:${n2(grosor)}px solid ${colorLinea};`;
        if (tipo === 3) est += "border-radius:50%;overflow:hidden;";
        else if (tipo === 2 || tipo === 62 || tipo === 106) est += `border-radius:${n2(Math.min(w, h) * 0.16)}px;`;
      }
    }
    if (giro) est += `transform:rotate(${n2(giro)}deg);`;
    if (tieneTexto) dentro += htmlTexto(f, m, esquema, heredada, numero);
    if (!dentro && libre) return "";
    return `<div class="ppt-forma" style="${est}">${dentro}</div>`;
  };

  // ---------- Diapositivas ----------
  const diapos = [];
  orden.forEach((d, k) => {
    try {
      const atom = hijo(d.r, T.DiapoAtom);
      const banderas = atom ? V.getUint16(atom.ini + 20, true) : 7;
      const m = atom ? maestraDe(V.getUint32(atom.ini + 12, true)) : maestraDe(0);
      const esquema = (banderas & 2 ? null : esquemaDe(d.r)) || m?.esquema || esquemaDe(d.r) || ESQUEMA;
      const figuras = figurasDe(d.r, d.textos);
      const fondoDe = banderas & 4 && m ? m.figuras.fondo : figuras.fondo || m?.figuras.fondo;
      const fondo = (fondoDe && relleno(fondoDe, banderas & 4 && m ? m.esquema : esquema, null, true)) || `background:${esquema[0]};`;
      let html = "";
      if (banderas & 1 && m) for (const f of m.figuras.formas) if (!f.marcador) html += htmlForma(f, m, m.esquema, k + 1);
      for (const f of figuras.formas) html += htmlForma(f, m, esquema, k + 1);
      diapos.push(`<div class="ppt-diapo" style="width:${n2(ancho)}px;height:${n2(alto)}px;${fondo}">${html}</div>`);
    } catch (e) {
      diapos.push(`<div class="ppt-diapo ppt-error" style="width:${n2(ancho)}px;height:${n2(alto)}px">No se pudo dibujar la diapositiva ${k + 1}</div>`);
    }
  });
  if (!diapos.length) throw new Error("La presentación no tiene diapositivas que se puedan leer.");
  return { ancho, alto, diapos };
}

/** Estilos que necesita el dibujo (se ponen una sola vez) */
export const CSS_PPT = `
.ppt-diapo{position:relative;overflow:hidden;margin:0 auto 12px;box-shadow:0 2px 10px rgba(0,0,0,.35);font-family:Arial,Helvetica,sans-serif;color:#000;background:#fff;text-align:left}
.ppt-forma{position:absolute;box-sizing:border-box}
.ppt-texto{position:absolute;inset:0;display:flex;flex-direction:column;box-sizing:border-box;overflow:visible}
.ppt-parrafos{width:100%}
.ppt-parrafos>div{margin:0;word-wrap:break-word;overflow-wrap:break-word;white-space:pre-wrap}
.ppt-sin-imagen{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#e8edf1;color:#7a8794;font-size:12px;border:1px dashed #9aa7b3}
.ppt-error{display:flex;align-items:center;justify-content:center;color:#7a8794}`;
