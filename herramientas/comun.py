"""Datos y funciones compartidas por las herramientas de Finlay."""

from pathlib import Path

# Carpeta raíz del proyecto (la que contiene "herramientas" y "materiales")
RAIZ = Path(__file__).resolve().parent.parent
MATERIALES = RAIZ / "materiales"
BIBLIOTECA = MATERIALES / "biblioteca"

ANIOS = ["1er año", "2do año", "3er año", "4to año", "5to año", "6to año"]
SUBCARPETAS = ["conferencias", "libros"]
ARCHIVO_COMPARTIDOS = "libros_compartidos.txt"

# Formatos que Finlay sabrá leer
FORMATOS_OK = {".pdf", ".docx", ".pptx", ".txt"}
# Formatos antiguos que conviene convertir
FORMATOS_VIEJOS = {
    ".doc": ".docx",
    ".ppt": ".pptx",
}

TEXTO_COMPARTIDOS = """\
# Escribe aquí, uno por línea, los nombres EXACTOS de los libros
# de la carpeta "materiales/biblioteca" que se usan en esta asignatura.
# Las líneas que empiezan con # se ignoran. Ejemplo:
# Guyton y Hall - Tratado de Fisiología Médica.pdf
"""


def leer_compartidos(carpeta_asignatura: Path) -> list[str]:
    """Devuelve los nombres de libros listados en libros_compartidos.txt."""
    archivo = carpeta_asignatura / ARCHIVO_COMPARTIDOS
    if not archivo.exists():
        return []
    nombres = []
    for linea in archivo.read_text(encoding="utf-8", errors="replace").splitlines():
        linea = linea.strip()
        if linea and not linea.startswith("#"):
            nombres.append(linea)
    return nombres
