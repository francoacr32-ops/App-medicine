// Zoom de una imagen: pellizcar con dos dedos, doble toque para ampliar y arrastrar con un dedo.

const MAX = 5;

export function activarZoom(caja, img) {
  let s = 1, tx = 0, ty = 0;               // escala y desplazamiento actuales
  const dedos = new Map();                 // pointerId → {x, y}
  let inicio = null;                       // estado al empezar un gesto
  let ultimoToque = { t: 0, x: 0, y: 0 };
  let movio = false;

  const origen = () => {
    const r = caja.getBoundingClientRect();
    return { x: r.left + img.offsetLeft, y: r.top + img.offsetTop };
  };
  const limitar = () => {
    const w = img.offsetWidth, h = img.offsetHeight;
    s = Math.min(MAX, Math.max(1, s));
    if (s === 1) { tx = ty = 0; return; }
    tx = Math.min(0, Math.max(w * (1 - s), tx));
    ty = Math.min(0, Math.max(h * (1 - s), ty));
  };
  const pintar = (suave = false) => {
    limitar();
    img.style.transition = suave ? "transform .25s ease" : "none";
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
    caja.classList.toggle("ampliada", s > 1);
  };
  /** Amplía a la escala `nueva` dejando quieto el punto (px, py) de la pantalla */
  const escalarEn = (nueva, px, py, base = { s, tx, ty }) => {
    const o = origen();
    const x = px - o.x, y = py - o.y;
    tx = x - (x - base.tx) * (nueva / base.s);
    ty = y - (y - base.ty) * (nueva / base.s);
    s = nueva;
  };

  caja.addEventListener("pointerdown", (e) => {
    caja.setPointerCapture?.(e.pointerId);
    dedos.set(e.pointerId, { x: e.clientX, y: e.clientY });
    movio = false;
    const [a, b] = [...dedos.values()];
    inicio = { s, tx, ty, a: { ...a }, dist: b ? Math.hypot(a.x - b.x, a.y - b.y) : 0, mid: b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null };
  });
  caja.addEventListener("pointermove", (e) => {
    if (!dedos.has(e.pointerId) || !inicio) return;
    dedos.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const [a, b] = [...dedos.values()];
    if (b && inicio.dist) {
      // Pellizco: escala según la distancia entre los dedos, alrededor del punto medio
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      escalarEn(Math.min(MAX, Math.max(1, inicio.s * (d / inicio.dist))), inicio.mid.x, inicio.mid.y, inicio);
      tx += mid.x - inicio.mid.x;
      ty += mid.y - inicio.mid.y;
      movio = true;
      pintar();
    } else if (!b && s > 1) {
      // Un dedo con la imagen ampliada: arrastrar
      const dx = a.x - inicio.a.x, dy = a.y - inicio.a.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) movio = true;
      tx = inicio.tx + dx;
      ty = inicio.ty + dy;
      pintar();
    } else if (!b) {
      const dx = a.x - inicio.a.x, dy = a.y - inicio.a.y;
      if (Math.abs(dx) + Math.abs(dy) > 10) movio = true;
    }
  });
  const soltar = (e) => {
    if (!dedos.has(e.pointerId)) return;
    const eraUno = dedos.size === 1;
    dedos.delete(e.pointerId);
    if (dedos.size) {
      // Queda un dedo: sigue arrastrando desde aquí
      const [a] = [...dedos.values()];
      inicio = { s, tx, ty, a: { ...a }, dist: 0, mid: null };
      return;
    }
    inicio = null;
    if (!eraUno || movio) return;
    // Doble toque: ampliar al doble y medio donde se tocó, o volver al tamaño normal
    const ahora = Date.now();
    if (ahora - ultimoToque.t < 320 && Math.hypot(e.clientX - ultimoToque.x, e.clientY - ultimoToque.y) < 40) {
      if (s > 1) { s = 1; tx = ty = 0; } else escalarEn(2.5, e.clientX, e.clientY);
      pintar(true);
      ultimoToque.t = 0;
    } else ultimoToque = { t: ahora, x: e.clientX, y: e.clientY };
  };
  caja.addEventListener("pointerup", soltar);
  caja.addEventListener("pointercancel", soltar);
  // Rueda del ratón (en computadora) también amplía
  caja.addEventListener("wheel", (e) => {
    e.preventDefault();
    escalarEn(Math.min(MAX, Math.max(1, s * (e.deltaY < 0 ? 1.2 : 1 / 1.2))), e.clientX, e.clientY);
    pintar();
  }, { passive: false });

  return {
    reiniciar() { s = 1; tx = ty = 0; pintar(); },
    ampliarEn(px, py) { escalarEn(2.5, px, py); pintar(true); },
  };
}
