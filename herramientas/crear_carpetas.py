"""Crea la estructura de carpetas de "materiales".

Uso:  python herramientas/crear_carpetas.py

Se puede ejecutar todas las veces que quieras: nunca borra nada,
solo crea lo que falte.
"""

from comun import (
    ANIOS, ARCHIVO_COMPARTIDOS, BIBLIOTECA, MATERIALES, SUBCARPETAS,
    TEXTO_COMPARTIDOS,
)


def crear_asignatura(anio: str, asignatura: str) -> None:
    carpeta = MATERIALES / anio / asignatura
    for sub in SUBCARPETAS:
        (carpeta / sub).mkdir(parents=True, exist_ok=True)
    compartidos = carpeta / ARCHIVO_COMPARTIDOS
    if not compartidos.exists():
        compartidos.write_text(TEXTO_COMPARTIDOS, encoding="utf-8")


def main() -> None:
    print("=== Finlay: crear carpetas de materiales ===\n")
    BIBLIOTECA.mkdir(parents=True, exist_ok=True)
    print(f"Carpeta de libros compartidos: {BIBLIOTECA}\n")

    for anio in ANIOS:
        carpeta_anio = MATERIALES / anio
        carpeta_anio.mkdir(parents=True, exist_ok=True)
        existentes = sorted(p.name for p in carpeta_anio.iterdir() if p.is_dir())
        if existentes:
            print(f"{anio} ya tiene: {', '.join(existentes)}")
        respuesta = input(
            f"Escribe las asignaturas NUEVAS de {anio}, separadas por comas\n"
            f"(o pulsa Enter para saltar): "
        ).strip()
        for nombre in respuesta.split(","):
            nombre = nombre.strip()
            if nombre:
                crear_asignatura(anio, nombre)
                print(f"  ✔ Creada: {anio}/{nombre}")
        # Asegura que las asignaturas que ya existían tengan todo
        for nombre in existentes:
            crear_asignatura(anio, nombre)
        print()

    print("Listo. Ahora copia tus archivos en las carpetas y ejecuta:")
    print("  python herramientas/revisar_materiales.py")


if __name__ == "__main__":
    main()
