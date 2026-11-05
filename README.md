# Finlay 🩺

Aplicación personal y gratuita para estudiar Medicina en Cuba con tus propios
libros y conferencias, desde el móvil. Funciona dentro del navegador: **tus
materiales se quedan en tu teléfono** y nunca se suben a internet.

- Organización por **año → asignatura → conferencias / libros**.
- Lee **PDF, Word (.docx), PowerPoint (.pptx) y .txt** dentro del teléfono.
- **Buscador con citas**: cada resultado dice de qué libro o conferencia sale y
  en qué página o diapositiva. Si no está en tus materiales responde
  *"No encontré eso en los materiales"*.
- Busca en una asignatura, en un año o en **toda la carrera**.
- Un libro (como Guyton) se carga **una sola vez** y se puede usar en varias asignaturas.
- **Voz**: lee en voz alta con la voz del teléfono (gratis, sin internet).
- **Exportar texto** de una conferencia (archivo pequeño) para que Claude prepare
  resúmenes y cuestionarios.
- **Paquetes de Claude** (.zip, uno por asignatura): las diapositivas originales de cada conferencia, vistas como en un PDF, + texto para el buscador + cuestionario.
- **Cuestionarios estilo examen cubano**: V o F, marque con X, enlace, complete,
  selección única y pregunta-respuesta, con explicación y fuente.
- **🧠 Repaso del día** con repetición espaciada, **🔥 racha** y meta diaria.
- **📝 Modo examen** con cronómetro y nota de 2 a 5.
- **📅 Plan para el examen**: cuenta regresiva y temas repartidos por día.
- **🎧 Escuchar** todos los resúmenes de una asignatura seguidos.
- **💾 Copia de seguridad** y **📲 compartir** con compañeros (Zapya, Bluetooth, WhatsApp).
- **Progreso** por asignatura: dominado, en camino, repasar.
- Funciona **sin conexión** después de abrirla la primera vez. Abrir la app
  gasta ≈ 50 KB; el lector de PDF/Word (≈ 600 KB comprimido) se descarga solo
  la primera vez que cargas un archivo.

## Publicar la app (una sola vez)

1. En github.com entra al repositorio `App-medicine` → **Settings** → **Pages**.
2. En **Branch** elige `claude/medicina-study-app-cuba-0s8ldj` y la carpeta `/docs` → **Save**.
3. Espera 1–2 minutos. La app quedará en:
   **https://francoacr32-ops.github.io/App-medicine/**

## APK para Android

Además de instalarse desde Chrome, Finlay se puede construir como APK (para pasarla por Zapya):

```
python herramientas/construir_apk.py --android-jar android-all.jar --dx dx.jar --apksig apksig.jar \
    --keystore finlay.keystore --salida Finlay.apk --version-code 2 --version-name 1.1
```

- `android/src/` contiene la ventana Android (WebView) con puentes para voz, elegir archivos y guardar/enviar.
- `android-all.jar` (org.robolectric:android-all:10-robolectric-5803371) y `dx.jar`
  (com.jakewharton.android.repackaged:dalvik-dx:16.0.1) y `apksig.jar` (com.android.tools.build:apksig:2.3.0)
  se descargan de Maven Central. El APK apunta a Android 14 (targetSdk 34) y va firmado con v1 + v2.
- **Guarda la llave `finlay.keystore`**: las actualizaciones deben firmarse con la misma llave.

## Estructura del código

```
docs/                 ← la app (lo que publica GitHub Pages)
  index.html          ← página principal
  estilos.css         ← diseño (claro y oscuro)
  sw.js               ← modo sin conexión y ahorro de datos
  js/app.js           ← pantallas y navegación
  js/db.js            ← base de datos del teléfono (IndexedDB)
  js/extraer.js       ← lectura de PDF, Word y PowerPoint
  js/buscar.js        ← buscador con puntuación (BM25)
  js/texto.js         ← normalizar texto (tildes, plurales) y fragmentar
  js/voz.js           ← lectura en voz alta
  js/paquete.js       ← importar paquetes y copias
  js/cuestionario.js  ← tipos de pregunta y corrección
  js/estudio.js       ← repaso espaciado, racha, examen, plan y copias
  lib/                ← pdf.js (Mozilla, Apache 2.0) y JSZip (MIT)
```

## Pruebas del tiempo de estudio

- `TZ=America/Havana node pruebas/tiempo.test.mjs` — sesiones falsas: una de 11:50 a 12:10, una que cruza la medianoche, una cerrada de golpe, días con preguntas sin tiempo y datos de versiones anteriores. Comprueba que la suma de las franjas es igual al total, que ningún día con preguntas queda en 0 min y que el promedio usa los días activos.
- `TZ=America/Havana node pruebas/progreso.e2e.js` — lo mismo en el navegador, en la pantalla "Mi progreso" (necesita la app servida en `http://localhost:8766/` y Playwright).
