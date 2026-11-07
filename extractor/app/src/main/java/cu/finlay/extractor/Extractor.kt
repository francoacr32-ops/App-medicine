package cu.finlay.extractor

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.DocumentsContract
import android.provider.DocumentsContract.Document
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.io.MemoryUsageSetting
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.text.PDFTextStripper
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.Writer

/**
 * Recorre la carpeta (Año > Asignatura > PDF), saca el texto de cada PDF página por página
 * y lo junta en un archivo .md por asignatura (partido en partes de ~20 MB).
 *
 * - Texto normal: PdfBox (sin internet).
 * - Páginas escaneadas (sin texto): se dibujan como imagen y se leen con ML Kit (OCR sin internet).
 * - Si se interrumpe, continúa donde iba: cada PDF terminado se apunta en "hechos.txt".
 * - Un PDF solo se añade al archivo de su asignatura cuando se terminó entero (no se duplica).
 */
class Extractor(private val ctx: Context, private val arbol: Uri) {

    data class Pdf(
        val uri: Uri, val nombre: String, val tamano: Long, val modificado: Long,
        val anio: String, val asignatura: String,
    ) {
        val clave get() = "$uri|$tamano|$modificado"
    }

    companion object {
        const val LIMITE_PARTE = 20L * 1024 * 1024   // ~20 MB por archivo (GitHub acepta 25 MB desde el navegador)
        const val MIN_LETRAS = 25                     // menos letras que esto en una página = escaneada → OCR
        fun carpetaTextos(ctx: Context) = File(ctx.filesDir, "textos").apply { mkdirs() }
        fun archivoErrores(ctx: Context) = File(carpetaTextos(ctx), "_errores.txt")
        fun archivoHechos(ctx: Context) = File(ctx.filesDir, "hechos.txt")
    }

    private val resolver = ctx.contentResolver
    private val textos = carpetaTextos(ctx)
    private var reconocedor: TextRecognizer? = null

    fun ejecutar() {
        PDFBoxResourceLoader.init(ctx.applicationContext)
        Estado.fase = "Buscando los PDF…"
        Estado.archivoActual = ""
        val pdfs = mutableListOf<Pdf>()
        listar(DocumentsContract.getTreeDocumentId(arbol), emptyList(), pdfs)
        pdfs.sortWith(compareBy<Pdf>({ it.anio }, { it.asignatura }, { it.nombre.lowercase() }))

        val hechosArchivo = archivoHechos(ctx)
        val hechos = if (hechosArchivo.exists()) hechosArchivo.readLines().toHashSet() else hashSetOf()
        Estado.total = pdfs.size
        Estado.bytesTotal = pdfs.sumOf { it.tamano }
        Estado.hechos = pdfs.count { it.clave in hechos }
        Estado.bytesHechos = pdfs.filter { it.clave in hechos }.sumOf { it.tamano }
        Estado.errores = archivoErrores(ctx).let { if (it.exists()) it.readLines().count { l -> l.isNotBlank() } else 0 }
        if (pdfs.isEmpty()) {
            Estado.fase = "No encontré ningún PDF en esa carpeta"
            return
        }

        Estado.fase = "Sacando el texto…"
        try {
            for (pdf in pdfs) {
                if (Estado.detener) break
                if (pdf.clave in hechos) continue
                Estado.archivoActual = "${pdf.asignatura} · ${pdf.nombre}"
                Estado.pagina = 0
                Estado.paginas = 0
                val base = Estado.bytesHechos
                try {
                    val tmp = procesar(pdf) { fraccion -> Estado.bytesHechos = base + (pdf.tamano * fraccion).toLong() }
                        ?: break   // se pidió pausar a mitad del PDF: se repetirá entero la próxima vez
                    agregar(pdf, tmp)
                    tmp.delete()
                } catch (t: Throwable) {   // incluye falta de memoria: se salta el PDF y se sigue
                    Estado.errores++
                    archivoErrores(ctx).appendText(
                        "${pdf.anio} / ${pdf.asignatura} / ${pdf.nombre}  →  ${t.javaClass.simpleName}: ${t.message ?: "error desconocido"}\n"
                    )
                }
                hechosArchivo.appendText(pdf.clave + "\n")
                Estado.hechos++
                Estado.bytesHechos = base + pdf.tamano
            }
        } finally {
            reconocedor?.close()
            reconocedor = null
            Estado.conOcr = false
        }
    }

    // ---------- Recorrer las carpetas ----------
    private fun listar(docId: String, ruta: List<String>, salida: MutableList<Pdf>) {
        val hijos = DocumentsContract.buildChildDocumentsUriUsingTree(arbol, docId)
        val columnas = arrayOf(
            Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME, Document.COLUMN_MIME_TYPE,
            Document.COLUMN_SIZE, Document.COLUMN_LAST_MODIFIED,
        )
        val carpetas = mutableListOf<Pair<String, String>>()
        resolver.query(hijos, columnas, null, null, null)?.use { c ->
            while (c.moveToNext()) {
                val id = c.getString(0) ?: continue
                val nombre = c.getString(1) ?: continue
                val tipo = c.getString(2) ?: ""
                if (tipo == Document.MIME_TYPE_DIR) {
                    carpetas.add(id to nombre)
                } else if (tipo == "application/pdf" || nombre.lowercase().endsWith(".pdf")) {
                    salida.add(
                        Pdf(
                            uri = DocumentsContract.buildDocumentUriUsingTree(arbol, id),
                            nombre = nombre,
                            tamano = if (c.isNull(3)) 0L else c.getLong(3),
                            modificado = if (c.isNull(4)) 0L else c.getLong(4),
                            anio = ruta.getOrNull(0) ?: "Sin año",
                            asignatura = ruta.getOrNull(1) ?: "General",
                        )
                    )
                }
            }
        }
        for ((id, nombre) in carpetas) listar(id, ruta + nombre, salida)
    }

    // ---------- Un PDF ----------
    /** Devuelve un archivo temporal con el texto del PDF, o null si se pidió pausar. */
    private fun procesar(pdf: Pdf, avance: (Double) -> Unit): File? {
        val copia = File(ctx.cacheDir, "actual.pdf")
        val entrada = resolver.openInputStream(pdf.uri) ?: throw IOException("No se pudo abrir el archivo")
        entrada.use { i -> copia.outputStream().use { o -> i.copyTo(o, 1 shl 16) } }
        val salida = File(ctx.cacheDir, "actual.md")
        try {
            salida.bufferedWriter().use { w ->
                val doc: PDDocument? = try {
                    // Con archivo temporal: no carga el libro entero en la memoria
                    PDDocument.load(copia, MemoryUsageSetting.setupTempFileOnly())
                } catch (e: Exception) {
                    null
                }
                val pfd = try { ParcelFileDescriptor.open(copia, ParcelFileDescriptor.MODE_READ_ONLY) } catch (e: Exception) { null }
                val render = try { pfd?.let { PdfRenderer(it) } } catch (e: Exception) { null }
                try {
                    val n = doc?.numberOfPages ?: render?.pageCount
                        ?: throw IOException("El PDF está dañado o tiene contraseña")
                    Estado.paginas = n
                    val stripper = if (doc != null) PDFTextStripper() else null
                    for (i in 1..n) {
                        if (Estado.detener) return null
                        Estado.pagina = i
                        var texto = ""
                        if (doc != null && stripper != null) {
                            try {
                                stripper.startPage = i
                                stripper.endPage = i
                                texto = stripper.getText(doc)
                            } catch (e: Exception) {
                                texto = ""
                            }
                        }
                        var ocr = false
                        if (texto.count { !it.isWhitespace() } < MIN_LETRAS && render != null && i <= render.pageCount) {
                            Estado.conOcr = true
                            val leido = try { ocrPagina(render, i - 1) } catch (e: Exception) { "" }
                            if (leido.isNotBlank()) {
                                texto = leido
                                ocr = true
                            }
                        } else {
                            Estado.conOcr = false
                        }
                        escribirPagina(w, i, limpiar(texto), ocr)
                        avance(i.toDouble() / n)
                    }
                } finally {
                    doc?.close()
                    render?.close()
                    pfd?.close()
                }
            }
            return salida
        } finally {
            copia.delete()
        }
    }

    private fun escribirPagina(w: Writer, n: Int, texto: String, ocr: Boolean) {
        if (texto.isBlank()) return
        w.write("\n**[pág. $n${if (ocr) " · OCR" else ""}]**\n\n")
        w.write(texto)
        w.write("\n")
    }

    /** Dibuja la página como imagen y la lee con el OCR de Google (sin internet). */
    private fun ocrPagina(render: PdfRenderer, indice: Int): String {
        val pagina = render.openPage(indice)
        try {
            var escala = minOf(3f, 1800f / pagina.width.coerceAtLeast(1))
            if (pagina.height * escala > 4000f) escala = 4000f / pagina.height
            val ancho = (pagina.width * escala).toInt().coerceAtLeast(1)
            val alto = (pagina.height * escala).toInt().coerceAtLeast(1)
            val imagen = Bitmap.createBitmap(ancho, alto, Bitmap.Config.ARGB_8888)
            try {
                imagen.eraseColor(Color.WHITE)
                pagina.render(imagen, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                val ocr = reconocedor ?: TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS).also { reconocedor = it }
                return Tasks.await(ocr.process(InputImage.fromBitmap(imagen, 0))).text
            } finally {
                imagen.recycle()
            }
        } finally {
            pagina.close()
        }
    }

    private fun limpiar(t: String): String = t
        .replace("\r", "")
        .replace(Regex("-\n(?=[a-záéíóúñü])"), "")        // palabras partidas al final de línea
        .replace(Regex("[ \t]+\n"), "\n")
        .replace(Regex("\n{3,}"), "\n\n")
        .trim()

    // ---------- Juntar en el archivo de la asignatura ----------
    private fun nombreSeguro(s: String) = s.replace(Regex("[\\\\/:*?\"<>|]"), "-").trim()
    private fun archivoParte(base: String, n: Int) = File(textos, if (n == 1) "$base.md" else "$base (parte $n).md")

    private fun agregar(pdf: Pdf, tmp: File) {
        val base = nombreSeguro("${pdf.anio} - ${pdf.asignatura}")
        var n = 1
        while (archivoParte(base, n + 1).exists()) n++
        var actual = archivoParte(base, n)
        if (actual.exists() && actual.length() > 0 && actual.length() + tmp.length() > LIMITE_PARTE) {
            n++
            actual = archivoParte(base, n)
        }
        val titulo = pdf.nombre.replace(Regex("\\.pdf$", RegexOption.IGNORE_CASE), "")
        var w = FileOutputStream(actual, true).bufferedWriter()
        var tam = actual.length()
        fun escribir(s: String) {
            w.write(s)
            tam += s.toByteArray(Charsets.UTF_8).size
        }
        try {
            if (tam == 0L) escribir("# ${pdf.anio} — ${pdf.asignatura}${if (n > 1) " (parte $n)" else ""}\n\n_Texto extraído con Finlay Extractor._\n")
            escribir("\n\n## $titulo\n\n_Archivo original: ${pdf.nombre}_\n")
            tmp.bufferedReader().useLines { lineas ->
                lineas.forEach { linea ->
                    if (tam > LIMITE_PARTE) {   // un libro enorme sigue en la parte siguiente
                        w.close()
                        n++
                        actual = archivoParte(base, n)
                        w = FileOutputStream(actual, true).bufferedWriter()
                        tam = 0
                        escribir("# ${pdf.anio} — ${pdf.asignatura} (parte $n)\n\n## $titulo (continuación)\n")
                    }
                    escribir(linea + "\n")
                }
            }
        } finally {
            w.close()
        }
    }
}
