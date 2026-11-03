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
- Funciona **sin conexión** después de abrirla la primera vez. Abrir la app
  gasta ≈ 50 KB; el lector de PDF/Word (≈ 600 KB comprimido) se descarga solo
  la primera vez que cargas un archivo.

## Publicar la app (una sola vez)

1. En github.com entra al repositorio `App-medicine` → **Settings** → **Pages**.
2. En **Branch** elige `claude/medicina-study-app-cuba-0s8ldj` y la carpeta `/docs` → **Save**.
3. Espera 1–2 minutos. La app quedará en:
   **https://francoacr32-ops.github.io/App-medicine/**

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
  lib/                ← pdf.js (Mozilla, Apache 2.0) y JSZip (MIT)
```
