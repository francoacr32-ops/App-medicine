"""Crea las capas del ícono adaptable de Android (fondo + dibujo) a partir del logo de Finlay.

Android 8 y posteriores recortan el ícono con la forma del teléfono (círculo, cuadrado redondeado…).
Si el ícono no es adaptable, lo encogen y le ponen un fondo blanco. Con dos capas de 108 dp:
  - fondo: el verde oscuro del logo, que llena toda la forma;
  - frente: la cruz y la palabra "Finlay", dentro de la zona segura del centro (66 dp).

Uso:  python herramientas/icono_adaptable.py LOGO.jpg
Salida: android/res/icono_fondo.png, android/res/icono_frente.png (432 px = 108 dp a 4x)
        y docs/iconos/icono-maskable-512.png (para la versión web).
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

RAIZ = Path(__file__).resolve().parent.parent
LADO = 432               # 108 dp × 4
CONTENIDO = 0.47         # el dibujo ocupa el 47 % del lado: cabe entero incluso en un círculo

logo = Image.open(sys.argv[1]).convert("RGB")
W = logo.width
# Interior del marco plateado y caja del dibujo (cruz + texto), en proporción al logo original
interior = logo.crop((int(W * .10), int(W * .10), int(W * .90), int(W * .90)))
caja = (int(W * .13), int(W * .10), int(W * .89), int(W * .87))

# ---- Color de fondo: el verde oscuro del interior del logo
arr = np.array(interior).astype(float)
borde = np.concatenate([arr[:20].reshape(-1, 3), arr[-20:].reshape(-1, 3), arr[:, :20].reshape(-1, 3), arr[:, -20:].reshape(-1, 3)])
color = tuple(int(x) for x in np.median(borde, axis=0))


def fondo_degradado(lado):
    """Verde oscuro con un brillo suave en el centro (como el logo)."""
    y, x = np.mgrid[0:lado, 0:lado]
    d = np.sqrt((x - lado / 2) ** 2 + (y - lado * .45) ** 2) / (lado * .7)
    luz = np.clip(1 - d, 0, 1) ** 2 * 0.22
    base = np.array(color, float)
    brillo = np.array([20, 120, 90], float)
    img = base[None, None, :] * (1 - luz[..., None]) + brillo[None, None, :] * luz[..., None]
    return Image.fromarray(np.clip(img, 0, 255).astype("uint8"))


def frente(lado, proporcion):
    """La cruz y el texto, recortados del logo, con bordes suaves para fundirse con el fondo."""
    dibujo = logo.crop(caja)
    escala = lado * proporcion / max(dibujo.size)
    dibujo = dibujo.resize((round(dibujo.width * escala), round(dibujo.height * escala)), Image.LANCZOS)
    # transparencia según el brillo: el fondo oscuro desaparece, la cruz, el texto y su brillo quedan
    a = np.array(dibujo).astype(float)
    luz = a.max(axis=2) - np.array(color, float).max()
    alfa = np.clip(luz / 70, 0, 1) * 255
    # quitar cualquier resto del marco plateado: solo vale lo que está dentro del interior redondeado
    mascara = Image.new("L", logo.size, 0)
    ImageDraw.Draw(mascara).rounded_rectangle((int(W * .115), int(W * .115), int(W * .885), int(W * .885)), int(W * .11), fill=255)
    mascara = mascara.filter(ImageFilter.GaussianBlur(W * .006)).crop(caja).resize(dibujo.size)
    alfa = alfa * (np.array(mascara).astype(float) / 255)
    capa = dibujo.convert("RGBA")
    capa.putalpha(Image.fromarray(alfa.astype("uint8")).filter(ImageFilter.GaussianBlur(0.6)))
    lienzo = Image.new("RGBA", (lado, lado), (0, 0, 0, 0))
    lienzo.alpha_composite(capa, ((lado - capa.width) // 2, (lado - capa.height) // 2))
    return lienzo


salida = RAIZ / "android" / "res"
salida.mkdir(parents=True, exist_ok=True)
fondo_degradado(LADO).save(salida / "icono_fondo.png", optimize=True)
frente(LADO, CONTENIDO).save(salida / "icono_frente.png", optimize=True)

# Versión web "maskable" (zona segura del 80 %): fondo + dibujo juntos
web = fondo_degradado(512).convert("RGBA")
web.alpha_composite(frente(512, 0.66))
web.convert("RGB").save(RAIZ / "docs" / "iconos" / "icono-maskable-512.png", optimize=True)

# Vista previa con varias formas de recorte (para revisar a ojo)
prev = Image.new("RGB", (4 * 230, 230), "white")
f = fondo_degradado(LADO).convert("RGBA")
f.alpha_composite(frente(LADO, CONTENIDO))
visible = f.crop((int(LADO * 18 / 108), int(LADO * 18 / 108), int(LADO * 90 / 108), int(LADO * 90 / 108))).resize((200, 200))
for k, forma in enumerate(["circulo", "redondeado", "gota", "cuadrado"]):
    m = Image.new("L", (200, 200), 0)
    d = ImageDraw.Draw(m)
    if forma == "circulo": d.ellipse((0, 0, 199, 199), fill=255)
    elif forma == "redondeado": d.rounded_rectangle((0, 0, 199, 199), 46, fill=255)
    elif forma == "gota": d.rounded_rectangle((0, 0, 199, 199), 100, fill=255); d.rectangle((100, 100, 199, 199), fill=255)
    else: d.rounded_rectangle((0, 0, 199, 199), 16, fill=255)
    prev.paste(visible.convert("RGB"), (k * 230 + 15, 15), m)
prev.save(salida.parent / "vista-icono.png")
print("Listo:", color)
