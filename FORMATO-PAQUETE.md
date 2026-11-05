# Formato del "paquete de estudio" de Finlay

Claude prepara un archivo `.json` por año (o por asignatura) con las conferencias
completas, sus resúmenes y sus cuestionarios. El estudiante lo carga en Finlay con
**📥 Cargar paquete de Claude**. Los paquetes **no se suben a GitHub** (contienen
material de estudio): se entregan por el chat.

```json
{
  "formato": "finlay-paquete",
  "version": 1,
  "titulo": "1er año — Morfofisiología",
  "asignaturas": [
    { "anio": 1, "semestre": 1, "nombre": "Morfofisiología" },
    { "anio": 1, "semestre": 2, "nombre": "…" }
  ],
  "materiales": [
    {
      "anio": 1,
      "asignatura": "Morfofisiología",
      "nombre": "Conferencia 3 - Membrana celular",
      "tipo": "conferencia",
      "etiqueta": "pág.",
      "paginas": [
        { "n": 1, "texto": "Texto completo de la página 1…" }
      ],
      "resumen": [
        { "titulo": "Estructura", "texto": "La membrana es una bicapa lipídica…", "fuente": "pág. 1" }
      ],
      "cuestionario": [
        { "tipo": "vf", "pregunta": "Diga V o F:",
          "afirmaciones": [ { "texto": "…", "respuesta": true }, { "texto": "…", "respuesta": false } ],
          "explicacion": "…", "fuente": "pág. 1" },
        { "tipo": "marcar", "pregunta": "Marque con una X las correctas:", "opciones": ["…", "…", "…", "…"],
          "correctas": [0, 2], "explicacion": "…", "fuente": "pág. 2" },
        { "tipo": "enlazar", "pregunta": "Enlace la columna A con la B:",
          "columnaA": ["…", "…", "…"], "columnaB": ["…", "…", "…", "…"], "pares": [2, 0, 3],
          "explicacion": "…", "fuente": "pág. 3" },
        { "tipo": "completar", "pregunta": "La bomba expulsa ___ iones de ___.",
          "respuestas": [["tres", "3"], "sodio"], "fuente": "pág. 2" },
        { "tipo": "multiple", "pregunta": "…", "opciones": ["…", "…", "…", "…"],
          "correcta": 0, "explicacion": "…", "fuente": "pág. 2" },
        { "tipo": "abierta", "pregunta": "…", "respuesta": "…", "fuente": "pág. 3" }
      ]
    }
  ]
}
```

## Paquetes .zip (con las diapositivas originales)

Desde la versión 1.3 un paquete puede ser un **.zip** que contiene:

```
paquete.json                       ← el mismo formato de arriba
diapositivas/01-conferencia-1/001.webp
diapositivas/01-conferencia-1/002.webp …
archivos/001.pdf                   ← opcional
```

Cada página se guarda como imagen WebP de 960 px de ancho (calidad 60): una conferencia de
40 diapositivas ocupa ≈ 1,5 MB. Se prepara un .zip por asignatura. Las copias de seguridad y los
paquetes que se comparten desde la app también se crean así cuando hay diapositivas o PDF.

## Campos

| Campo | Obligatorio | Descripción |
|---|---|---|
| `asignaturas` (arriba) | no | Lista del plan de estudio: `{anio, semestre, nombre}`. `semestre`: 1, 2, 0 (anual) o null. Se crean aunque aún no tengan materiales |
| `quitarAsignaturas` (arriba) | no | Lista `{anio, nombre}` de asignaturas que se borran del teléfono al cargar el paquete (con sus materiales y progreso) |
| `anio` | sí | 1 a 6 |
| `asignatura` | sí | Nombre de la asignatura (se crea si no existe) |
| `semestre` | no | 1, 2 o 0 (anual), si la asignatura es nueva |
| `nombre` | sí | Nombre de la conferencia o capítulo. Si ya existe en esa asignatura (mismo nombre, sin extensión), solo se le añaden resumen y cuestionario |
| `tipo` | no | `conferencia` (por defecto), `taller` (clase taller), `libro` o `consulta` (formulario de medicamentos, valores de laboratorio, protocolos…) |
| `etiqueta` | no | `pág.`, `diap.` o `parte` |
| `paginas` | no | Texto completo, página a página (para el buscador y la lectura) |
| `diapositivas` | no | Solo en paquetes .zip: `{carpeta, total}`. Las páginas originales están en `carpeta/001.webp`, `002.webp`… y se muestran como en un PDF |
| `pdf` | no | Solo en paquetes .zip: ruta de un PDF dentro del .zip (por ejemplo `archivos/001.pdf`); Finlay lo dibuja página a página |
| `resumen` | no | **Ya no se usa** (desde la versión 1.3 la app muestra las diapositivas originales en vez de resúmenes). Se ignora si viene |
| `cuestionario` | no | Lista de preguntas (ver tipos abajo). Todas aceptan `explicacion` y `fuente` |

## Tipos de pregunta (estilo de los exámenes cubanos)

| `tipo` | Nombre en la app | Campos |
|---|---|---|
| `vf` | Verdadero o falso | Lista: `afirmaciones` [{`texto`, `respuesta` true/false}]. Una sola: `respuesta` true/false |
| `marcar` | Marque con una X | `opciones`, `correctas` (índices desde 0; puede haber varias) |
| `enlazar` | Enlace | `columnaA`, `columnaB` (puede tener más elementos que A), `pares` (para cada elemento de A, el índice de B) |
| `completar` | Complete | `pregunta` con `___` en cada espacio; `respuestas` (una por espacio; texto o lista de alternativas válidas) |
| `multiple` | Selección única | `opciones`, `correcta` (índice desde 0) |
| `abierta` | Pregunta y respuesta | `respuesta` (el estudiante se autoevalúa) |

Campos opcionales de cualquier pregunta:

- `caso`: texto de un **caso clínico** que se muestra antes del enunciado (para 3er año en adelante). Ejemplo: `"caso": "Paciente de 45 años que acude por dolor torácico…"`.
- `porque`: en `multiple` y `marcar`, una lista con **la explicación de cada opción**, en el mismo orden que `opciones` (por qué es correcta o por qué no). Se muestra al corregir.

Todas las preguntas aceptan además `cita`: la frase **literal** del material donde está la respuesta. Cuando el estudiante falla, Finlay abre esa página y resalta la cita en verde (corrector). Sin `cita`, Finlay la busca por palabras clave en la página indicada en `fuente`.

## Imágenes

Arriba del paquete, `"imagenes": { "nombre": "data:image/jpeg;base64,…" }`. Las preguntas las usan con `"imagen": "nombre"` y un `"pie"` opcional. Finlay guarda cada
imagen una sola vez (aunque se importe varias veces) y la muestra con zoom al tocarla.

Preparación (herramienta `herramientas/imagenes.py`):
1. `extraer` las imágenes del .pptx/.pdf original (el texto exportado no las trae).
2. Mirar cada imagen y elegir las útiles (esquemas, cortes, láminas).
3. `preparar` cada una: máx. 900 px, JPEG ≈ 20–90 KB, con `--marcas` numeradas para preguntas
   de "señale" o "enlace cada número con su nombre", y `--recorte` si sobra parte.
4. `datauri` para pegarla en el paquete. Pocas imágenes por conferencia: los datos son caros.

## Reglas para Claude al preparar los cuestionarios

1. Usar **solo** la información del material recibido. Nada de conocimiento externo.
2. Cada pregunta lleva su `fuente` (página o diapositiva), y cada pregunta su `cita` literal copiada del material.
3. Cuestionario recomendado por conferencia: 2–3 V o F (de 4–6 afirmaciones), 2 de marque con X, 1–2 de enlace, 2–3 de complete, 2 de selección única y 2 de pregunta y respuesta. Desordenar la columna B y variar la posición de las respuestas correctas.
4. Todo en español, con la terminología de la medicina cubana usada en el material.
5. Las clases taller (`tipo: "taller"`) se usan como fuente adicional de preguntas prácticas.
6. Preguntas con imagen solo sobre lo que la imagen y el material muestran; marcar números con la herramienta.
