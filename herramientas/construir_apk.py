"""Construye el APK de Finlay sin el SDK de Android (solo Java + dx + jarsigner).

Uso:
  python herramientas/construir_apk.py --android-jar android-all.jar --dx dx.jar --apksig apksig.jar \
      --keystore finlay.keystore --salida Finlay.apk [--version-code 2 --version-name 1.1]

Piezas:
  - android-all.jar  (org.robolectric:android-all:10-robolectric-5803371, en Maven Central)
  - dx.jar           (com.jakewharton.android.repackaged:dalvik-dx:16.0.1, en Maven Central)
  - apksig.jar       (com.android.tools.build:apksig:2.3.0, en Maven Central): solo para verificar la firma
  La firma v1 la hace jarsigner y la v2 se calcula aquí (apksig 2.3.0 no funciona con Java moderno).
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
    "allowBackup": 0x01010280, "hardwareAccelerated": 0x010102D3, "drawable": 0x01010199,
}
NS_ANDROID = "http://schemas.android.com/apk/res/android"
TEMA = 0x01030241          # @android:style/Theme.Material.Light.NoActionBar
ICONO = 0x7F010000         # @drawable/icono (lo define resources.arsc)
ICONO_FONDO = 0x7F010001   # @drawable/icono_fondo  (capa de fondo del ícono adaptable)
ICONO_FRENTE = 0x7F010002  # @drawable/icono_frente (capa del dibujo del ícono adaptable)

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
        Elemento("uses-sdk", [a("minSdkVersion", T_DEC, 21), a("targetSdkVersion", T_DEC, 34)]),
        # Vibrar un poquito al fallar una pregunta (permiso normal: Android no pregunta nada)
        Elemento("uses-permission", [a("name", T_STR, "android.permission.VIBRATE")]),
        # Desde Android 11 hay que declarar qué servicios externos se usan: aquí, el motor de voz
        Elemento("queries", [], [
            Elemento("intent", [], [Elemento("action", [a("name", T_STR, "android.intent.action.TTS_SERVICE")])]),
        ]),
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
def icono_adaptable():
    """XML binario de <adaptive-icon>: Android 8+ recorta el ícono con la forma del teléfono."""
    return axml(Elemento("adaptive-icon", [], [
        Elemento("background", [a("drawable", T_REF, ICONO_FONDO)]),
        Elemento("foreground", [a("drawable", T_REF, ICONO_FRENTE)]),
    ]))


def arsc():
    """resources.arsc con tres imágenes (tipo drawable):
    icono        → res/drawable/icono.png (Android 5 a 7) y res/drawable-anydpi-v26/icono.xml (Android 8+)
    icono_fondo  → res/drawable/icono_fondo.png
    icono_frente → res/drawable/icono_frente.png
    """
    rutas = ["res/drawable/icono.png", "res/drawable/icono_fondo.png", "res/drawable/icono_frente.png",
             "res/drawable-anydpi-v26/icono.xml"]
    valores = pool_cadenas(rutas)
    tipos = pool_cadenas(["drawable"])
    nombres = ["icono", "icono_fondo", "icono_frente"]
    claves = pool_cadenas(nombres)
    n = len(nombres)
    # Spec: la entrada 0 cambia según la versión de Android (CONFIG_VERSION) y la densidad
    spec = struct.pack("<HHIBBHI", 0x0202, 16, 16 + 4 * n, 1, 0, 0, n) + struct.pack("<III", 0x0400 | 0x0100, 0, 0)

    def config(densidad=0, sdk=0):
        c = bytearray(64)
        struct.pack_into("<I", c, 0, 64)
        struct.pack_into("<H", c, 14, densidad)     # density
        struct.pack_into("<H", c, 24, sdk)          # sdkVersion
        return bytes(c)

    def chunk_tipo(cfg, valores_por_entrada):
        cab = 8 + 1 + 1 + 2 + 4 + 4 + len(cfg)
        offsets, datos = [], b""
        for v in valores_por_entrada:
            if v is None:
                offsets.append(0xFFFFFFFF)
                continue
            k, idx_valor = v
            offsets.append(len(datos))
            datos += struct.pack("<HHI", 8, 0, k) + struct.pack("<HBBI", 8, 0, T_STR, idx_valor)
        inicio = cab + 4 * len(offsets)
        return struct.pack("<HHIBBHII", 0x0201, cab, inicio + len(datos), 1, 0, 0, len(offsets), inicio) + \
            cfg + b"".join(struct.pack("<I", o) for o in offsets) + datos

    por_defecto = chunk_tipo(config(), [(0, 0), (1, 1), (2, 2)])
    android8 = chunk_tipo(config(densidad=0xFFFE, sdk=26), [(0, 3), None, None])   # drawable-anydpi-v26
    nombre = PAQUETE.encode("utf-16-le").ljust(256, b"\x00")
    cab_paq = 288
    off_tipos = cab_paq
    off_claves = off_tipos + len(tipos)
    cuerpo = tipos + claves + spec + por_defecto + android8
    paquete = struct.pack("<HHII", 0x0200, cab_paq, cab_paq + len(cuerpo), 0x7F) + nombre + \
        struct.pack("<IIIII", off_tipos, 1, off_claves, n, 0) + cuerpo
    total = 12 + len(valores) + len(paquete)
    return struct.pack("<HHII", 0x0002, 12, total, 1) + valores + paquete


# ---------------------------------------------------------------- firma v2 (APK Signature Scheme v2)
def firmar_v2(apk, keystore, clave):
    """Añade el bloque de firma v2 a un APK ya firmado con v1 y alineado.

    Sigue la especificación de Android: resumen SHA-256 por trozos de 1 MiB de las secciones
    (entradas, directorio central, fin de directorio) y firma RSA PKCS#1 v1.5 (algoritmo 0x0103).
    """
    import hashlib
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding
    from cryptography.hazmat.primitives.serialization import pkcs12

    llave, cert, _ = pkcs12.load_key_and_certificates(Path(keystore).read_bytes(), clave.encode())
    datos = Path(apk).read_bytes()
    eocd = datos.rfind(b"PK\x05\x06")
    tam_cd, off_cd = struct.unpack_from("<II", datos, eocd + 12)
    seccion_a, seccion_c, seccion_d = datos[:off_cd], datos[off_cd:off_cd + tam_cd], datos[eocd:]

    def trozos(b):
        return [b[i:i + 1048576] for i in range(0, len(b), 1048576)]
    lista = trozos(seccion_a) + trozos(seccion_c) + trozos(seccion_d)
    resumenes = b"".join(hashlib.sha256(b"\xa5" + struct.pack("<I", len(t)) + t).digest() for t in lista)
    resumen = hashlib.sha256(b"\x5a" + struct.pack("<I", len(lista)) + resumenes).digest()

    def lp(b):
        return struct.pack("<I", len(b)) + b
    ALG = 0x0103
    cert_der = cert.public_bytes(serialization.Encoding.DER)
    datos_firmados = lp(lp(struct.pack("<I", ALG) + lp(resumen))) + lp(lp(cert_der)) + lp(b"")
    firma = llave.sign(datos_firmados, padding.PKCS1v15(), hashes.SHA256())
    clave_publica = cert.public_key().public_bytes(serialization.Encoding.DER,
                                                   serialization.PublicFormat.SubjectPublicKeyInfo)
    firmante = lp(datos_firmados) + lp(lp(struct.pack("<I", ALG) + lp(firma))) + lp(clave_publica)
    valor = lp(lp(firmante))
    par = struct.pack("<QI", 4 + len(valor), 0x7109871A) + valor
    tam_bloque = len(par) + 8 + 16
    bloque = struct.pack("<Q", tam_bloque) + par + struct.pack("<Q", tam_bloque) + b"APK Sig Block 42"
    nuevo_eocd = bytearray(seccion_d)
    struct.pack_into("<I", nuevo_eocd, 16, off_cd + len(bloque))
    Path(apk).write_bytes(seccion_a + bloque + seccion_c + bytes(nuevo_eocd))


# ---------------------------------------------------------------- construcción
def ejecutar(cmd):
    print("$", " ".join(str(c) for c in cmd))
    subprocess.run(cmd, check=True)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--android-jar", required=True)
    p.add_argument("--dx", required=True)
    p.add_argument("--apksig", required=True)
    p.add_argument("--keystore", required=True)
    p.add_argument("--clave", default=os.environ.get("FINLAY_CLAVE", "finlay-local"))
    p.add_argument("--salida", default="Finlay.apk")
    p.add_argument("--version-code", type=int, default=1)
    p.add_argument("--version-name", default="1.0")
    p.add_argument("--paquetes", help="carpeta con paquetes .zip que la app carga sola al abrirse")
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
        z.writestr(zipfile.ZipInfo("resources.arsc"), arsc(), compress_type=zipfile.ZIP_STORED)
        z.write(RAIZ / "docs" / "iconos" / "icono-192.png", "res/drawable/icono.png", compress_type=zipfile.ZIP_STORED)
        # Ícono adaptable (Android 8+): fondo + dibujo, que el teléfono recorta con su forma
        z.write(RAIZ / "android" / "res" / "icono_fondo.png", "res/drawable/icono_fondo.png", compress_type=zipfile.ZIP_STORED)
        z.write(RAIZ / "android" / "res" / "icono_frente.png", "res/drawable/icono_frente.png", compress_type=zipfile.ZIP_STORED)
        z.writestr("res/drawable-anydpi-v26/icono.xml", icono_adaptable())
        z.write(dex, "classes.dex")
        for f in sorted((RAIZ / "docs").rglob("*")):
            if f.is_file():
                z.write(f, "assets/www/" + f.relative_to(RAIZ / "docs").as_posix())
        if args.paquetes:
            # Paquetes incluidos: van sin comprimir (ya son .zip) y con una lista para la app
            import hashlib, json
            lista = []
            for f in sorted(Path(args.paquetes).glob("*.zip")):
                z.write(f, "assets/www/paquetes/" + f.name, compress_type=zipfile.ZIP_STORED)
                lista.append({"archivo": f.name, "version": hashlib.sha1(f.read_bytes()).hexdigest()[:12]})
            z.writestr("assets/www/paquetes/lista.json", json.dumps(lista))

    if not Path(args.keystore).exists():
        ejecutar(["keytool", "-genkeypair", "-keystore", args.keystore, "-alias", "finlay", "-keyalg", "RSA",
                  "-keysize", "2048", "-validity", "10000", "-storepass", args.clave, "-keypass", args.clave,
                  "-dname", "CN=Finlay, O=Finlay, C=CU"])
    # 1) Firma v1 (JAR) con jarsigner
    ejecutar(["jarsigner", "-keystore", args.keystore, "-storepass", args.clave, "-keypass", args.clave,
              "-sigalg", "SHA256withRSA", "-digestalg", "SHA-256", str(sin_firmar), "finlay"])
    # 2) Realinear: lo que va sin comprimir debe empezar en múltiplo de 4 (Android 11+)
    alineado = tmp / "alineado.apk"
    with zipfile.ZipFile(sin_firmar) as ent, zipfile.ZipFile(alineado, "w") as sal:
        for info in ent.infolist():
            datos = ent.read(info)
            nueva = zipfile.ZipInfo(info.filename, date_time=info.date_time)
            nueva.compress_type = info.compress_type
            if info.compress_type == zipfile.ZIP_STORED:
                inicio = sal.fp.tell() + 30 + len(info.filename.encode("utf-8"))
                nueva.extra = b"\x00" * ((4 - inicio % 4) % 4)
            sal.writestr(nueva, datos)
    sin_firmar = alineado
    # 3) Firma v2 (Android 11+ la exige para apps que apuntan a Android 11 o más)
    firmar_v2(sin_firmar, args.keystore, args.clave)
    # 4) Verificar con apksig, la biblioteca oficial de Android
    verificador = tmp / "verificar"
    verificador.mkdir()
    ejecutar(["javac", "-nowarn", "-cp", args.apksig, "-d", str(verificador),
              str(RAIZ / "herramientas" / "firmar" / "Verificar.java")])
    abrir = []   # apksig 2.3.0 usa clases internas de Java (sun.security.*)
    for paquete in ("sun.security.x509", "sun.security.pkcs", "sun.security.util"):
        abrir += ["--add-exports", "java.base/" + paquete + "=ALL-UNNAMED"]
    ejecutar(["java"] + abrir + ["-cp", args.apksig + os.pathsep + str(verificador), "Verificar", str(sin_firmar)])
    shutil.copy(sin_firmar, args.salida)
    print(f"\n✅ {args.salida} ({Path(args.salida).stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
