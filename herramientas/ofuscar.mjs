// Copia docs/ a otra carpeta con el código JavaScript de la app minificado y con los nombres
// internos cambiados (más difícil de leer y de copiar). Uso:
//   node herramientas/ofuscar.mjs <carpeta de salida> [carpeta donde está instalado terser]
// Después: construir_apk.py --www <carpeta de salida>
import { cpSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const salida = resolve(process.argv[2] || "www-ofuscado");
const require = createRequire(join(resolve(process.argv[3] || raiz), "x.js"));
const { minify } = require("terser");

rmSync(salida, { recursive: true, force: true });
cpSync(join(raiz, "docs"), salida, { recursive: true });
let antes = 0, despues = 0;
for (const nombre of readdirSync(join(salida, "js")).filter((n) => n.endsWith(".js"))) {
  const ruta = join(salida, "js", nombre);
  const codigo = readFileSync(ruta, "utf8");
  const r = await minify(codigo, { module: true, compress: { passes: 2 }, mangle: { toplevel: true }, format: { comments: false } });
  writeFileSync(ruta, r.code);
  antes += codigo.length; despues += r.code.length;
}
console.log(`ofuscado: ${Math.round(antes / 1024)} KB → ${Math.round(despues / 1024)} KB en ${salida}`);
