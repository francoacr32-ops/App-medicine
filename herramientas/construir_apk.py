"""Construye el APK de Finlay sin el SDK de Android (solo Java + dx + jarsigner).

Uso:
  python herramientas/construir_apk.py --android-jar android-all.jar --dx dx.jar \
      --keystore finlay.keystore --salida Finlay.apk [--version-code 1 --version-name 1.0]

Piezas:
  - android-all.jar  (org.robolectric:android-all:10-robolectric-5803371, en Maven Central)
  - dx.jar           (com.jakewharton.android.repackaged:dalvik-dx:16.0.1, en Maven Central)
  - keystore         se crea con keytool la primera vez (¡guárdalo! sin él no se puede actualizar la app)

El manifiesto binario (AXML) y resources.arsc se codifican aquí mismo, porque aapt2
solo se distribuye desde servidores que pueden no estar disponibles.
"""

import argparse
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
PAQUETE = "cu.finlay.app"

# Identificadores de atributos de android.R.attr
ATTR = {
    "theme": 0x01010000, "label": 0x01010001, "icon": 0x01010002, "name": 0x01010003,
    "exported": 0x01010010, "authorities": 0x01010018, "grantUriPermissions": 0x0101001B,
    "configChanges": 0x0101001F, "minSdkVersion": 0x0101020C, "versionCode": 0x0101021B,
    "versionName": 0x0101021C, "windowSoftInputMode": 0x0101022B, "targetSdkVersion": 0x01010270,
    "allowBackup": 0x01010280, "hardwareAccelerated": 0x010102D3,
}
NS_ANDROID = "http://schemas.android.com/apk/res/android"
TEMA = 0x01030241          # @android:style/Theme.Material.Light.NoActionBar
ICONO = 0x7F010000         # @drawable/icono (lo define resources.arsc)

# Tipos de valor (Res_value)
T_REF, T_STR, T_DEC, T_HEX, T_BOOL = 0x01, 0x03, 0x10, 0x11, 0x12


# ---------------------------------------------------------------- pool de cadenas
def pool_cadenas(cadenas):
    """Chunk ResStringPool en UTF-16."""
    datos = b""
    offsets = []
    for c in cadenas:
        offsets.append(len(datos))
        u = c.encode("utf-16-le")
        n = len(c.encode("utf-16-le")) // 2
        datos += struct.pack("<H", n) + u + b"\x00\x00"
    while len(datos) % 4:
        datos += b"\x00"
    cabecera = 28
    inicio = cabecera + 4 * len(cadenas)
    total = inicio + len(datos)
    return struct.pack("<HHIIIIII", 0x0001, cabecera, total, len(cadenas), 0, 0, inicio, 0) + \
        b"".join(struct.pack("<I", o) for o in offsets) + datos


# ---------------------------------------------------------------- AXML (manifiesto)
class Elemento:
    def __init__(self, nombre, atributos=None, hijos=None):
        self.nombre = nombre
        self.atributos = atributos or []   # (ns_android?, nombre, tipo, valor)
        self.hijos = hijos or []


def a(nombre, tipo, valor):
    return (True, nombre, tipo, valor)


def axml(raiz):
    # 1) Cadenas: primero los nombres de atributo android (en el orden del mapa de recursos)
    nombres_attr = []

    def recorrer(e):
        for (ns, n, t, v) in e.atributos:
            if ns and n not in nombres_attr:
                nombres_attr.append(n)
        for h in e.hijos:
            recorrer(h)
    recorrer(raiz)
    nombres_attr.sort(key=lambda n: ATTR[n])
    cadenas = list(nombres_attr)

    def idx(c):
        if c not in cadenas:
            cadenas.append(c)
        return cadenas.index(c)

    for c in ("android", NS_ANDROID):
        idx(c)

    def preparar(e):
        idx(e.nombre)
        for (ns, n, t, v) in e.atributos:
            idx(n)
            if t == T_STR:
                idx(v)
        for h in e.hijos:
            preparar(h)
    preparar(raiz)

    cuerpo = b""
    linea = 1
    cuerpo += struct.pack("<HHIIiII", 0x0100, 16, 24, linea, -1, idx("android"), idx(NS_ANDROID))

    def escribir(e):
        nonlocal cuerpo
        attrs = sorted(e.atributos, key=lambda x: ATTR.get(x[1], 0x7FFFFFFF) if x[0] else -1)
        datos_attr = b""
        for (ns, n, t, v) in attrs:
            ns_i = idx(NS_ANDROID) if ns else 0xFFFFFFFF
            if t == T_STR:
                raw, dato = idx(v), idx(v)
            else:
                raw, dato = 0xFFFFFFFF, v & 0xFFFFFFFF
            datos_attr += struct.pack("<IIIHBBI", ns_i, idx(n), raw, 8, 0, t, dato)
        ext = struct.pack("<IIHHHHHH", 0xFFFFFFFF, idx(e.nombre), 20, 20, len(attrs), 0, 0, 0)
        tam = 16 + len(ext) + len(datos_attr)
        cuerpo += struct.pack("<HHIIi", 0x0102, 16, tam, linea, -1) + ext + datos_attr
        for h in e.hijos:
            escribir(h)
        cuerpo += struct.pack("<HHIIiII", 0x0103, 16, 24, linea, -1, 0xFFFFFFFF, idx(e.nombre))
    escribir(raiz)
    cuerpo += struct.pack("<HHIIiII", 0x0101, 16, 24, linea, -1, idx("android"), idx(NS_ANDROID))

    mapa = struct.pack("<HHI", 0x0180, 8, 8 + 4 * len(nombres_attr)) + \
        b"".join(struct.pack("<I", ATTR[n]) for n in nombres_attr)
    pool = pool_cadenas(cadenas)
    total = 8 + len(pool) + len(mapa) + len(cuerpo)
    return struct.pack("<HHI", 0x0003, 8, total) + pool + mapa + cuerpo


def manifiesto(version_code, version_name):
    return Elemento("manifest", [
        (False, "package", T_STR, PAQUETE),
        a("versionCode", T_DEC, version_code),
        a("versionName", T_STR, version_name),
    ], [
        Elemento("uses-sdk", [a("minSdkVersion", T_DEC, 21), a("targetSdkVersion", T_DEC, 29)]),
        Elemento("application", [
            a("label", T_STR, "Finlay"),
            a("icon", T_REF, ICONO),
            a("theme", T_REF, TEMA),
            a("allowBackup", T_BOOL, 0xFFFFFFFF),
            a("hardwareAccelerated", T_BOOL, 0xFFFFFFFF),
        ], [
            Elemento("activity", [
                a("name", T_STR, PAQUETE + ".Principal"),
                a("exported", T_BOOL, 0xFFFFFFFF),
                a("configChanges", T_HEX, 0x7B0),        # orientación, tamaño, teclado, modo noche
                a("windowSoftInputMode", T_HEX, 0x10),   # adjustResize
            ], [
                Elemento("intent-filter", [], [
                    Elemento("action", [a("name", T_STR, "android.intent.action.MAIN")]),
                    Elemento("category", [a("name", T_STR, "android.intent.category.LAUNCHER")]),
                ]),
            ]),
            Elemento("provider", [
                a("name", T_STR, PAQUETE + ".Archivos"),
                a("exported", T_BOOL, 0),
                a("authorities", T_STR, PAQUETE + ".archivos"),
                a("grantUriPermissions", T_BOOL, 0xFFFFFFFF),
            ]),
        ]),
    ])


# ---------------------------------------------------------------- resources.arsc
def arsc(ruta_icono):
    valores = pool_cadenas([ruta_icono])
    tipos = pool_cadenas(["drawable"])
    claves = pool_cadenas(["icono"])
    spec = struct.pack("<HHIBBHI", 0x0202, 16, 16 + 4, 1, 0, 0, 1) + struct.pack("<I", 0)
    config = struct.pack("<I", 64) + b"\x00" * 60
    cab_tipo = 8 + 1 + 1 + 2 + 4 + 4 + len(config)
    entradas_inicio = cab_tipo + 4
    entrada = struct.pack("<HHI", 8, 0, 0) + struct.pack("<HBBI", 8, 0, T_STR, 0)
    tipo = struct.pack("<HHIBBHII", 0x0201, cab_tipo, entradas_inicio + len(entrada), 1, 0, 0, 1, entradas_inicio) + \
        config + struct.pack("<I", 0) + entrada
    nombre = PAQUETE.encode("utf-16-le").ljust(256, b"\x00")
    cab_paq = 288
    off_tipos = cab_paq
    off_claves = off_tipos + len(tipos)
    cuerpo = tipos + claves + spec + tipo
    paquete = struct.pack("<HHII", 0x0200, cab_paq, cab_paq + len(cuerpo), 0x7F) + nombre + \
        struct.pack("<IIIII", off_tipos, 1, off_claves, 1, 0) + cuerpo
    total = 12 + len(valores) + len(paquete)
    return struct.pack("<HHII", 0x0002, 12, total, 1) + valores + paquete


# ---------------------------------------------------------------- construcción
def ejecutar(cmd):
    print("$", " ".join(str(c) for c in cmd))
    subprocess.run(cmd, check=True)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--android-jar", required=True)
    p.add_argument("--dx", required=True)
    p.add_argument("--keystore", required=True)
    p.add_argument("--clave", default=os.environ.get("FINLAY_CLAVE", "finlay-local"))
    p.add_argument("--salida", default="Finlay.apk")
    p.add_argument("--version-code", type=int, default=1)
    p.add_argument("--version-name", default="1.0")
    args = p.parse_args()

    tmp = Path(tempfile.mkdtemp(prefix="finlay-apk-"))
    clases = tmp / "clases"
    clases.mkdir()
    fuentes = sorted(str(f) for f in (RAIZ / "android" / "src").rglob("*.java"))
    ejecutar(["javac", "--release", "8", "-nowarn", "-encoding", "UTF-8", "-cp", args.android_jar,
              "-d", str(clases)] + fuentes)
    dex = tmp / "classes.dex"
    ejecutar(["java", "-cp", args.dx, "com.android.dx.command.Main", "--dex", "--min-sdk-version=21",
              "--output=" + str(dex), str(clases)])

    sin_firmar = tmp / "sin-firmar.apk"
    with zipfile.ZipFile(sin_firmar, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("AndroidManifest.xml", axml(manifiesto(args.version_code, args.version_name)))
        z.writestr(zipfile.ZipInfo("resources.arsc"), arsc("res/drawable/icono.png"), compress_type=zipfile.ZIP_STORED)
        z.write(dex, "classes.dex")
        z.write(RAIZ / "docs" / "iconos" / "icono-192.png", "res/drawable/icono.png", compress_type=zipfile.ZIP_STORED)
        for f in sorted((RAIZ / "docs").rglob("*")):
            if f.is_file():
                z.write(f, "assets/www/" + f.relative_to(RAIZ / "docs").as_posix())

    if not Path(args.keystore).exists():
        ejecutar(["keytool", "-genkeypair", "-keystore", args.keystore, "-alias", "finlay", "-keyalg", "RSA",
                  "-keysize", "2048", "-validity", "10000", "-storepass", args.clave, "-keypass", args.clave,
                  "-dname", "CN=Finlay, O=Finlay, C=CU"])
    ejecutar(["jarsigner", "-keystore", args.keystore, "-storepass", args.clave, "-keypass", args.clave,
              "-sigalg", "SHA256withRSA", "-digestalg", "SHA-256", str(sin_firmar), "finlay"])
    shutil.copy(sin_firmar, args.salida)
    print(f"\n✅ {args.salida} ({Path(args.salida).stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
