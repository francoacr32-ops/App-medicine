# Finlay 🩺

Aplicación personal para estudiar Medicina en Cuba con IA, usando tus propios
libros y conferencias. Las respuestas salen **solo** de tus materiales y siempre
indican la fuente.

## Etapa 0 — Preparación

### 1. Instalar Python (una sola vez)
- **Windows:** descarga Python desde https://www.python.org/downloads/ (≈ 25 MB).
  Al instalar, **marca la casilla "Add Python to PATH"** antes de pulsar "Install Now".
- **Mac / Linux:** normalmente ya viene instalado. Comprueba con `python3 --version`.

Comprueba que funciona abriendo una terminal (en Windows: tecla Windows → escribe
`cmd` → Enter) y escribiendo:

```
python --version
```

### 2. Descargar Finlay
En GitHub, entra al repositorio, elige la rama `claude/medicina-study-app-cuba-0s8ldj`,
pulsa el botón verde **Code → Download ZIP** y descomprímelo (por ejemplo en
`Documentos/Finlay`).

### 3. Entrar en la carpeta desde la terminal
```
cd Documentos\Finlay
```
(en Mac/Linux usa `/` en vez de `\`)

### 4. Instalar lo necesario (≈ 1 MB de datos)
```
python -m pip install -r requirements.txt
```

### 5. Crear las carpetas
```
python herramientas/crear_carpetas.py
```
Te preguntará las asignaturas de cada año. Escríbelas separadas por comas, por
ejemplo: `Morfofisiología, Introducción a la MGI`. Puedes volver a ejecutarlo
cuando quieras añadir más; nunca borra nada.

### 6. Copiar tus archivos
```
materiales/
  biblioteca/                 ← libros usados en varias asignaturas (Guyton, etc.)
  1er año/
    Morfofisiología/
      conferencias/           ← conferencias de la asignatura
      libros/                 ← libros propios de la asignatura
      libros_compartidos.txt  ← nombres de libros de biblioteca/ que usa
```
- Formatos aceptados: **PDF, Word (.docx), PowerPoint (.pptx) y .txt**.
- Los `.doc` y `.ppt` antiguos: ábrelos y usa "Guardar como" `.docx` / `.pptx`.
- Para usar Guyton en Morfofisiología: pon el PDF **una sola vez** en `biblioteca/`
  y escribe su nombre exacto (con `.pdf`) en `libros_compartidos.txt` de cada
  asignatura que lo use.

### 7. Revisar que todo esté bien
```
python herramientas/revisar_materiales.py
```
Muestra cuántos materiales hay en cada asignatura, y lista **avisos** (por
ejemplo, PDF escaneados) y **problemas** (archivos mal ubicados, nombres
equivocados). No modifica nada.

> 🔒 La carpeta `materiales/` nunca se sube a GitHub.
