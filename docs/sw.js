// Permite abrir Finlay sin conexión y ahorra datos: los archivos se guardan en el teléfono.

const VERSION = "finlay-v53";
const BASICOS = [
  "./",
  "index.html",
  "estilos.css",
  "manifest.webmanifest",
  "iconos/icono-192.png",
  "iconos/logo.webp",
  "iconos/retrato-finlay.webp",
  "iconos/cruz.webp",
  "iconos/asig/biologia-molecular.webp",
  "iconos/asig/cardiovascular.webp",
  "iconos/asig/celula.webp",
  "iconos/asig/cirugia.webp",
  "iconos/asig/comunidad.webp",
  "iconos/asig/cts.webp",
  "iconos/asig/genetica.webp",
  "iconos/asig/ginecologia.webp",
  "iconos/asig/medicina-interna.webp",
  "iconos/asig/metabolismo.webp",
  "iconos/asig/mgi-6.webp",
  "iconos/asig/mgi.webp",
  "iconos/asig/microbiologia.webp",
  "iconos/asig/nervioso.webp",
  "iconos/asig/oftalmologia.webp",
  "iconos/asig/ontogenia.webp",
  "iconos/asig/pediatria.webp",
  "iconos/asig/propedeutica.webp",
  "iconos/asig/psicologia.webp",
  "iconos/asig/salud-publica.webp",
  "iconos/asig/sangre.webp",
  "iconos/dis/logo.webp",
  "iconos/dis/anatomia.webp",
  "iconos/dis/cerebro.webp",
  "iconos/dis/ev-repaso.webp",
  "iconos/dis/ev-examen.webp",
  "iconos/dis/ev-plan.webp",
  "iconos/dis/ev-nota.webp",
  "iconos/dis/libro.webp",
  "iconos/dis/trofeo.webp",
  "iconos/dis/cerebro2.webp",
  "iconos/dis/mochila.webp",
  "iconos/dis/diamante.webp",
  "js/app.js",
  "js/db.js",
  "js/texto.js",
  "js/buscar.js",
  "js/extraer.js",
  "js/voz.js",
  "js/paquete.js",
  "js/cuestionario.js",
  "js/estudio.js",
  "js/guia.js",
  "js/iconos.js",
  "js/inicio.js",
  "js/diapositivas.js",
  "js/logros.js",
  "js/zoom.js",
  "js/tiempo.js",
  "js/organizar.js",
  "js/tarjetas.js",
  "js/notas.js",
  "js/leccion.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(BASICOS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;

  // Bibliotecas grandes (lector de PDF/Word): se descargan una sola vez y se guardan.
  if (url.pathname.includes("/lib/")) {
    e.respondWith(
      caches.match(e.request).then(
        (r) => r || fetch(e.request).then((resp) => {
          if (resp.ok) caches.open(VERSION).then((c) => c.put(e.request, resp.clone()));
          return resp;
        })
      )
    );
    return;
  }

  // Resto de la app: se muestra lo guardado al instante y se actualiza en segundo plano.
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const guardado = await cache.match(e.request, { ignoreSearch: true });
      const red = fetch(e.request)
        .then((resp) => {
          if (resp.ok) cache.put(e.request, resp.clone());
          return resp;
        })
        .catch(() => guardado);
      return guardado || red;
    })
  );
});
