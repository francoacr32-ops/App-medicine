"""Herramienta para Claude: prepara las imágenes de las conferencias para los paquetes de Finlay.

Usos:
  python herramientas/imagenes.py extraer ARCHIVO CARPETA
      Saca las imágenes de un .pptx o .pdf (y en los PDF, también cada página
      como imagen, porque muchos esquemas están dibujados y no son fotos).
      Los nombres indican de dónde salen: diap03_1.png, pag12.png, pag12_img1.png…

  python herramientas/imagenes.py preparar IMAGEN SALIDA.jpg [--marcas "x,y;x,y"] [--recorte "x1,y1,x2,y2"]
      Reduce la imagen (máx. 900 px), opcionalmente la recorta y le dibuja
      números 1, 2, 3… en las posiciones indicadas (coordenadas de 0 a 1),
      y la guarda como JPEG ligero (≈ 40–90 KB).

  python herramientas/imagenes.py datauri IMAGEN
      Imprime la imagen como "data:image/jpeg;base64,…" para ponerla en el paquete.
"""

import base64
import io
import sys
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

MAX_LADO = 900
CALIDAD = 70


def extraer_pptx(archivo: Path, salida: Path) -> None:
    from pptx import Presentation
    from pptx.enum.shapes import MSO_SHAPE_TYPE

    pres = Presentation(str(archivo))
    for n, diapo in enumerate(pres.slides, start=1):
        k = 0
        pendientes = list(diapo.shapes)
        while pendientes:
            forma = pendientes.pop(0)
            if forma.shape_type == MSO_SHAPE_TYPE.GROUP:
                pendientes.extend(forma.shapes)
                continue
            if forma.shape_type == MSO_SHAPE_TYPE.PICTURE:
                k += 1
                img = forma.image
                destino = salida / f"diap{n:02d}_{k}.{img.ext}"
                destino.write_bytes(img.blob)
                print(destino.name, f"{len(img.blob) // 1024} KB")


def extraer_pdf(archivo: Path, salida: Path) -> None:
    import pymupdf

    doc = pymupdf.open(str(archivo))
    for n, pagina in enumerate(doc, start=1):
        # La página entera (sirve para esquemas dibujados)
        pix = pagina.get_pixmap(dpi=110)
        destino = salida / f"pag{n:02d}.png"
        pix.save(str(destino))
        print(destino.name, f"{destino.stat().st_size // 1024} KB")
        # Las fotos incrustadas
        for k, info in enumerate(pagina.get_images(full=True), start=1):
            datos = doc.extract_image(info[0])
            if datos["width"] < 120 or datos["height"] < 120:
                continue  # logotipos e iconos
            destino = salida / f"pag{n:02d}_img{k}.{datos['ext']}"
            destino.write_bytes(datos["image"])
            print(destino.name, f"{len(datos['image']) // 1024} KB")


def numeros(texto: str):
    return [tuple(float(v) for v in par.split(",")) for par in texto.split(";") if par.strip()]


def preparar(origen: Path, destino: Path, marcas=None, recorte=None) -> None:
    img = Image.open(origen)
    if img.mode in ("RGBA", "LA", "P"):
        fondo = Image.new("RGB", img.size, "white")
        img = img.convert("RGBA")
        fondo.paste(img, mask=img.split()[-1])
        img = fondo
    else:
        img = img.convert("RGB")
    if recorte:
        x1, y1, x2, y2 = recorte
        w, h = img.size
        img = img.crop((int(x1 * w), int(y1 * h), int(x2 * w), int(y2 * h)))
    img.thumbnail((MAX_LADO, MAX_LADO))
    if marcas:
        dibujo = ImageDraw.Draw(img)
        w, h = img.size
        radio = max(12, int(min(w, h) * 0.035))
        try:
            letra = ImageFont.truetype("DejaVuSans-Bold.ttf", int(radio * 1.3))
        except OSError:
            letra = ImageFont.load_default()
        for i, (x, y) in enumerate(marcas, start=1):
            cx, cy = x * w, y * h
            dibujo.ellipse((cx - radio, cy - radio, cx + radio, cy + radio), fill="#d32f2f", outline="white", width=3)
            dibujo.text((cx, cy), str(i), fill="white", font=letra, anchor="mm")
    img.save(destino, "JPEG", quality=CALIDAD, optimize=True, progressive=True)
    print(destino.name, f"{img.size[0]}x{img.size[1]}", f"{destino.stat().st_size // 1024} KB")


def datauri(imagen: Path) -> str:
    tipo = "jpeg" if imagen.suffix.lower() in (".jpg", ".jpeg") else imagen.suffix.lower().lstrip(".")
    return f"data:image/{tipo};base64," + base64.b64encode(imagen.read_bytes()).decode()


def main() -> None:
    if len(sys.argv) < 3:
        print(__doc__)
        return
    orden = sys.argv[1]
    if orden == "extraer":
        archivo, salida = Path(sys.argv[2]), Path(sys.argv[3])
        salida.mkdir(parents=True, exist_ok=True)
        if archivo.suffix.lower() == ".pptx":
            extraer_pptx(archivo, salida)
        elif archivo.suffix.lower() == ".pdf":
            extraer_pdf(archivo, salida)
        else:
            print("Solo .pptx o .pdf")
    elif orden == "preparar":
        args = sys.argv[2:]
        marcas = recorte = None
        if "--marcas" in args:
            i = args.index("--marcas")
            marcas = numeros(args[i + 1])
            del args[i : i + 2]
        if "--recorte" in args:
            i = args.index("--recorte")
            recorte = tuple(float(v) for v in args[i + 1].split(","))
            del args[i : i + 2]
        preparar(Path(args[0]), Path(args[1]), marcas, recorte)
    elif orden == "datauri":
        print(datauri(Path(sys.argv[2])))
    else:
        print(__doc__)


if __name__ == "__main__":
    main()
