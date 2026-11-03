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
        { "tipo": "multiple", "pregunta": "…", "opciones": ["…", "…", "…", "…"],
          "correcta": 0, "explicacion": "…", "fuente": "pág. 2" },
        { "tipo": "vf", "pregunta": "…", "respuesta": true, "explicacion": "…", "fuente": "pág. 1" },
        { "tipo": "abierta", "pregunta": "…", "respuesta": "…", "fuente": "pág. 3" }
      ]
    }
  ]
}
```

## Campos

| Campo | Obligatorio | Descripción |
|---|---|---|
| `anio` | sí | 1 a 6 |
| `asignatura` | sí | Nombre de la asignatura (se crea si no existe) |
| `nombre` | sí | Nombre de la conferencia o capítulo. Si ya existe en esa asignatura (mismo nombre, sin extensión), solo se le añaden resumen y cuestionario |
| `tipo` | no | `conferencia` (por defecto) o `libro` |
| `etiqueta` | no | `pág.`, `diap.` o `parte` |
| `paginas` | no | Texto completo, página a página (para el buscador y la lectura) |
| `resumen` | no | Secciones `{titulo, texto, fuente}` |
| `cuestionario` | no | Preguntas `multiple` (`opciones`, `correcta` = índice desde 0), `vf` (`respuesta` true/false) o `abierta` (`respuesta` texto). Todas aceptan `explicacion` y `fuente` |

## Reglas para Claude al preparar resúmenes y cuestionarios

1. Usar **solo** la información del material recibido. Nada de conocimiento externo.
2. Cada sección del resumen y cada pregunta lleva su `fuente` (página o diapositiva).
3. Cuestionario recomendado por conferencia: ~6 de selección múltiple, ~4 de verdadero o falso y ~3 de pregunta y respuesta.
4. Todo en español, con la terminología de la medicina cubana usada en el material.
