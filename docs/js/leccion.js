// Clases propias de Finlay: conferencias reescritas con la estructura de una clase universitaria
// (motivación, objetivos, desarrollo, casos, síntesis, estudio independiente) y estrategias de
// aprendizaje con evidencia (preguntas para recordar, esquemas, mapas conceptuales, casos).
//
// Formato de una lección (campo "leccion" de un material):
// { minutos, motivacion: {texto, pregunta}, objetivos: [], previos: [],
//   secciones: [{ titulo, fuente, bloques: [...] }], sintesis: { ideas: [], mapa }, estudio: [], bibliografia: [] }
// Bloques: {t:"p", texto} · {t:"lista", items} · {t:"tabla", titulo, cab, filas} · {t:"mapa", titulo, raiz, ramas}
//   · {t:"pasos", titulo, items} · {t:"clave", texto} · {t:"mnemo", texto} · {t:"caso", titulo, texto, pregunta, respuesta}
//   · {t:"pausa", pregunta, respuesta}

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Texto con **negritas** y _cursivas_ (nada más: seguro) */
export function marcado(s) {
  return esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|[\s(])_(.+?)_(?=[\s.,;:)]|$)/g, "$1<i>$2</i>");
}

/** Mapa conceptual: raíz arriba y ramas con sus hijos (árbol con líneas) */
export function htmlMapa(m) {
  const nodo = (n) => {
    const t = typeof n === "string" ? n : n.t;
    const hijos = typeof n === "string" ? [] : n.hijos || [];
    return `<li><span class="mc-nodo">${marcado(t)}</span>${hijos.length ? `<ul>${hijos.map(nodo).join("")}</ul>` : ""}</li>`;
  };
  return `<figure class="mapa-conceptual">${m.titulo ? `<figcaption>${marcado(m.titulo)}</figcaption>` : ""}
    <div class="mc-arbol"><ul><li><span class="mc-nodo mc-raiz">${marcado(m.raiz)}</span>
      <ul>${(m.ramas || []).map(nodo).join("")}</ul></li></ul></div></figure>`;
}

function bloque(b, k) {
  switch (b.t) {
    case "p": return `<p>${marcado(b.texto)}</p>`;
    case "lista": return `<ul class="lc-lista">${b.items.map((x) => `<li>${marcado(x)}</li>`).join("")}</ul>`;
    case "tabla": return `<div class="lc-tabla-caja">${b.titulo ? `<p class="lc-tabla-titulo">${marcado(b.titulo)}</p>` : ""}
      <table class="lc-tabla"><thead><tr>${b.cab.map((c) => `<th>${marcado(c)}</th>`).join("")}</tr></thead>
      <tbody>${b.filas.map((f) => `<tr>${f.map((c) => `<td>${marcado(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    case "mapa": return htmlMapa(b);
    case "pasos": return `<div class="lc-pasos">${b.titulo ? `<p class="lc-tabla-titulo">${marcado(b.titulo)}</p>` : ""}
      <ol>${b.items.map((x) => `<li>${marcado(x)}</li>`).join("")}</ol></div>`;
    case "clave": return `<div class="lc-clave"><b>🔑 Recuerda</b><p>${marcado(b.texto)}</p></div>`;
    case "mnemo": return `<div class="lc-mnemo"><b>💡 Truco para memorizar</b><p>${marcado(b.texto)}</p></div>`;
    case "caso": return `<div class="lc-caso"><b>🩺 ${marcado(b.titulo || "Caso para pensar")}</b><p>${marcado(b.texto)}</p>
      ${b.pregunta ? `<p class="lc-caso-preg">${marcado(b.pregunta)}</p><details><summary>Ver la respuesta</summary><p>${marcado(b.respuesta)}</p></details>` : ""}</div>`;
    case "pausa": return `<details class="lc-pausa"><summary><b>⏸ Comprueba lo que sabes</b><span>${marcado(b.pregunta)}</span></summary>
      <p>${marcado(b.respuesta)}</p></details>`;
    default: return "";
  }
}

/** Una clase completa */
export function htmlLeccion(l, doc) {
  const secciones = l.secciones || [];
  const ancla = (i) => `lc-s${i}`;
  return `<article class="leccion">
    <div class="lc-cabeza"><span class="lc-sello">Clase Finlay</span>
      <span class="sub">${l.minutos ? `⏱ ${l.minutos} min de lectura · ` : ""}${secciones.length} partes · basada en la conferencia del programa</span></div>
    ${l.motivacion ? `<section class="lc-motivacion"><b>🎯 Para empezar</b><p>${marcado(l.motivacion.texto)}</p>
      ${l.motivacion.pregunta ? `<p class="lc-pregunta-gancho">${marcado(l.motivacion.pregunta)}</p>` : ""}</section>` : ""}
    ${l.objetivos?.length ? `<section class="lc-objetivos"><b>Al terminar podrás:</b><ul>${l.objetivos.map((o) => `<li>${marcado(o)}</li>`).join("")}</ul></section>` : ""}
    ${l.previos?.length ? `<section class="lc-previos"><b>Antes de empezar, recuerda:</b><ul>${l.previos.map((o) => `<li>${marcado(o)}</li>`).join("")}</ul></section>` : ""}
    <nav class="lc-indice"><b>Contenido</b><ol>${secciones.map((s, i) => `<li><a href="#" data-accion="ir-seccion" data-ancla="${ancla(i)}">${marcado(s.titulo)}</a></li>`).join("")}
      ${l.sintesis ? `<li><a href="#" data-accion="ir-seccion" data-ancla="lc-sintesis">Síntesis</a></li>` : ""}</ol></nav>
    ${secciones.map((s, i) => `<section class="lc-seccion" id="${ancla(i)}">
      <h2><span class="lc-num">${i + 1}</span>${marcado(s.titulo)}</h2>
      ${(s.bloques || []).map(bloque).join("")}
      ${s.fuente && doc ? `<p class="lc-fuente">📌 En las diapositivas del profesor: ${esc(s.fuente)}</p>` : ""}
    </section>`).join("")}
    ${l.sintesis ? `<section class="lc-seccion lc-sintesis" id="lc-sintesis"><h2><span class="lc-num">✓</span>Síntesis</h2>
      ${l.sintesis.ideas?.length ? `<ol class="lc-ideas">${l.sintesis.ideas.map((x) => `<li>${marcado(x)}</li>`).join("")}</ol>` : ""}
      ${l.sintesis.mapa ? htmlMapa(l.sintesis.mapa) : ""}</section>` : ""}
    ${l.estudio?.length ? `<section class="lc-estudio"><b>📝 Estudio independiente</b><ol>${l.estudio.map((x) => `<li>${marcado(x)}</li>`).join("")}</ol></section>` : ""}
    ${l.bibliografia?.length ? `<section class="lc-biblio"><b>📚 Para profundizar</b><ul>${l.bibliografia.map((x) => `<li>${marcado(x)}</li>`).join("")}</ul></section>` : ""}
  </article>`;
}

/** Resumen de una asignatura: mapa general, cuadros clave y lo esencial de cada tema */
export function htmlResumen(r) {
  return `<article class="leccion resumen-asig">
    ${r.intro ? `<p class="lc-intro">${marcado(r.intro)}</p>` : ""}
    ${r.mapa ? htmlMapa(r.mapa) : ""}
    ${(r.temas || []).map((t, i) => `<section class="lc-seccion"><h2><span class="lc-num">${i + 1}</span>${marcado(t.titulo)}</h2>
      ${(t.bloques || []).map(bloque).join("")}</section>`).join("")}
    ${r.estrategia?.length ? `<section class="lc-estudio"><b>🧠 Cómo estudiar esta asignatura</b><ol>${r.estrategia.map((x) => `<li>${marcado(x)}</li>`).join("")}</ol></section>` : ""}
  </article>`;
}
