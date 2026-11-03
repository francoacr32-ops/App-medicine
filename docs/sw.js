// Permite abrir Finlay sin conexión y ahorra datos: los archivos se guardan en el teléfono.

const VERSION = "finlay-v4";
const BASICOS = [
  "./",
  "index.html",
  "estilos.css",
  "manifest.webmanifest",
  "iconos/icono.svg",
  "js/app.js",
  "js/db.js",
  "js/texto.js",
  "js/buscar.js",
  "js/extraer.js",
  "js/voz.js",
  "js/paquete.js",
  "js/cuestionario.js",
  "js/estudio.js",
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
