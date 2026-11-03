"""Revisa que los materiales estén bien ubicados.

Uso:  python herramientas/revisar_materiales.py

No modifica nada: solo muestra un informe con lo que está bien,
los avisos y los problemas que hay que corregir.
"""

from pathlib import Path

from comun import (
    ANIOS, ARCHIVO_COMPARTIDOS, BIBLIOTECA, FORMATOS_OK, FORMATOS_VIEJOS,
    MATERIALES, SUBCARPETAS, leer_compartidos,
)

try:  # Opcional: si está instalado, detecta PDF escaneados
    from pypdf import PdfReader
except ImportError:
    PdfReader = None

problemas: list[str] = []
avisos: list[str] = []


def ruta_corta(p: Path) -> str:
    return str(p.relative_to(MATERIALES))


def es_oculto(p: Path) -> bool:
    return p.name.startswith(".") or p.name.startswith("~$") or p.name in {"Thumbs.db", "desktop.ini"}


def pdf_sin_texto(p: Path) -> bool | None:
    """True si parece escaneado (sin texto). None si no se pudo comprobar."""
    if PdfReader is None:
        return None
    try:
        lector = PdfReader(p)
        paginas = lector.pages[:5]
        texto = "".join((pg.extract_text() or "") for pg in paginas)
        return len(texto.strip()) < 50
    except Exception:
        problemas.append(f"No se pudo abrir (¿dañado o con contraseña?): {ruta_corta(p)}")
        return None


def revisar_archivo(p: Path) -> int:
    """Revisa un archivo de material. Devuelve 1 si es válido, 0 si no."""
    ext = p.suffix.lower()
    if ext in FORMATOS_VIEJOS:
        avisos.append(
            f"Formato antiguo {ext}: ábrelo y guárdalo como {FORMATOS_VIEJOS[ext]} → {ruta_corta(p)}"
        )
        return 0
    if ext not in FORMATOS_OK:
        problemas.append(f"Formato no compatible ({ext or 'sin extensión'}): {ruta_corta(p)}")
        return 0
    if p.stat().st_size == 0:
        problemas.append(f"Archivo vacío: {ruta_corta(p)}")
        return 0
    if ext == ".pdf" and pdf_sin_texto(p):
        avisos.append(f"PDF escaneado (necesitará OCR): {ruta_corta(p)}")
    return 1


def contenido(carpeta: Path) -> list[Path]:
    return sorted(p for p in carpeta.iterdir() if not es_oculto(p))


def revisar_subcarpeta(carpeta: Path) -> int:
    """Cuenta los archivos válidos de conferencias/ o libros/ (incluye subcarpetas)."""
    validos = 0
    for p in sorted(carpeta.rglob("*")):
        if p.is_file() and not es_oculto(p):
            validos += revisar_archivo(p)
    return validos


def revisar_asignatura(carpeta: Path, nombres_biblioteca: set[str]) -> None:
    for p in contenido(carpeta):
        if p.is_file() and p.name != ARCHIVO_COMPARTIDOS:
            problemas.append(
                f"Archivo suelto (muévelo a conferencias/ o libros/): {ruta_corta(p)}"
            )
        elif p.is_dir() and p.name not in SUBCARPETAS:
            problemas.append(
                f"Carpeta desconocida (solo se permiten conferencias/ y libros/): {ruta_corta(p)}"
            )

    cuentas = {}
    for sub in SUBCARPETAS:
        sc = carpeta / sub
        cuentas[sub] = revisar_subcarpeta(sc) if sc.is_dir() else 0
        if not sc.is_dir():
            avisos.append(f"Falta la carpeta {sub}/ en {ruta_corta(carpeta)}")

    compartidos = leer_compartidos(carpeta)
    encontrados = 0
    for nombre in compartidos:
        if nombre in nombres_biblioteca:
            encontrados += 1
        else:
            problemas.append(
                f"{ruta_corta(carpeta)}/{ARCHIVO_COMPARTIDOS} menciona «{nombre}», "
                f"pero no está en biblioteca/ (revisa que el nombre sea idéntico)"
            )

    total = cuentas["conferencias"] + cuentas["libros"] + encontrados
    print(
        f"    {carpeta.name}: {cuentas['conferencias']} conferencias, "
        f"{cuentas['libros']} libros, {encontrados} libros compartidos"
    )
    if total == 0:
        avisos.append(f"Asignatura sin materiales todavía: {ruta_corta(carpeta)}")


def main() -> None:
    print("=== Finlay: revisión de materiales ===\n")
    if not MATERIALES.is_dir():
        print("No existe la carpeta 'materiales'. Ejecuta primero:")
        print("  python herramientas/crear_carpetas.py")
        return

    # Biblioteca
    nombres_biblioteca: set[str] = set()
    if BIBLIOTECA.is_dir():
        for p in contenido(BIBLIOTECA):
            if p.is_file():
                if revisar_archivo(p):
                    nombres_biblioteca.add(p.name)
            else:
                problemas.append(f"No pongas carpetas dentro de biblioteca/: {ruta_corta(p)}")
        print(f"Biblioteca compartida: {len(nombres_biblioteca)} libros")
    else:
        avisos.append("No existe materiales/biblioteca/ (ejecuta crear_carpetas.py)")

    # Elementos sueltos en materiales/
    for p in contenido(MATERIALES):
        if p.is_file():
            problemas.append(f"Archivo suelto en materiales/ (ubícalo en un año): {p.name}")
        elif p.is_dir() and p.name not in ANIOS and p.name != "biblioteca":
            problemas.append(
                f"Carpeta con nombre no reconocido: «{p.name}». "
                f"Los nombres válidos son: {', '.join(ANIOS)}"
            )

    # Años y asignaturas
    for anio in ANIOS:
        carpeta_anio = MATERIALES / anio
        if not carpeta_anio.is_dir():
            continue
        asignaturas = [p for p in contenido(carpeta_anio) if p.is_dir()]
        print(f"\n{anio}: {len(asignaturas)} asignaturas")
        for p in contenido(carpeta_anio):
            if p.is_file():
                problemas.append(
                    f"Archivo suelto en {anio}/ (ubícalo dentro de una asignatura): {p.name}"
                )
        for asig in asignaturas:
            revisar_asignatura(asig, nombres_biblioteca)

    # Informe final
    print("\n" + "=" * 50)
    if PdfReader is None:
        print("(Nota: instala 'pypdf' para detectar PDF escaneados: pip install pypdf)")
    if avisos:
        print(f"\n⚠️  AVISOS ({len(avisos)}) — conviene revisarlos:")
        for a in avisos:
            print(f"  - {a}")
    if problemas:
        print(f"\n❌ PROBLEMAS ({len(problemas)}) — hay que corregirlos:")
        for pr in problemas:
            print(f"  - {pr}")
    if not avisos and not problemas:
        print("\n✅ Todo está bien ubicado.")
    elif not problemas:
        print("\n✅ No hay problemas graves.")


if __name__ == "__main__":
    main()
