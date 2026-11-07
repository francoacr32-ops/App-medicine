package cu.finlay.extractor

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.DocumentsContract
import android.view.View
import android.widget.Button
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import java.io.File
import kotlin.concurrent.thread

class MainActivity : Activity() {

    private companion object {
        const val ELEGIR_ORIGEN = 10
        const val ELEGIR_DESTINO = 20
    }

    private val prefs by lazy { getSharedPreferences("finlay", MODE_PRIVATE) }
    private val reloj = Handler(Looper.getMainLooper())
    private lateinit var tCarpeta: TextView
    private lateinit var tPorcentaje: TextView
    private lateinit var tFase: TextView
    private lateinit var tDetalle: TextView
    private lateinit var tErrores: TextView
    private lateinit var tResumen: TextView
    private lateinit var barra: ProgressBar
    private lateinit var bEmpezar: Button
    private var ultimoResumen = 0L

    private val refrescar = object : Runnable {
        override fun run() {
            pintar()
            reloj.postDelayed(this, 500)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        tCarpeta = findViewById(R.id.carpeta)
        tPorcentaje = findViewById(R.id.porcentaje)
        tFase = findViewById(R.id.fase)
        tDetalle = findViewById(R.id.detalle)
        tErrores = findViewById(R.id.errores)
        tResumen = findViewById(R.id.resumen)
        barra = findViewById(R.id.barra)
        bEmpezar = findViewById(R.id.empezar)

        findViewById<Button>(R.id.elegir).setOnClickListener {
            if (Estado.trabajando) return@setOnClickListener aviso("Primero pausa el trabajo.")
            @Suppress("DEPRECATION")
            startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT_TREE), ELEGIR_ORIGEN)
        }
        bEmpezar.setOnClickListener { empezarOPausar() }
        findViewById<Button>(R.id.compartir).setOnClickListener { compartir() }
        findViewById<Button>(R.id.guardar).setOnClickListener {
            if (archivosDeTexto().isEmpty()) return@setOnClickListener aviso("Todavía no hay archivos de texto.")
            @Suppress("DEPRECATION")
            startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT_TREE), ELEGIR_DESTINO)
        }
        findViewById<Button>(R.id.verErrores).setOnClickListener { verErrores() }
        findViewById<Button>(R.id.reiniciar).setOnClickListener { reiniciar() }

        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
    }

    override fun onResume() {
        super.onResume()
        ultimoResumen = 0
        reloj.post(refrescar)
    }

    override fun onPause() {
        super.onPause()
        reloj.removeCallbacks(refrescar)
    }

    // ---------- Pantalla ----------
    private fun pintar() {
        val carpeta = prefs.getString("carpeta", null)
        tCarpeta.text = if (carpeta == null) "Todavía no elegiste la carpeta." else "📁 " + nombreDeCarpeta(Uri.parse(carpeta))
        val mil = Estado.avanceMil()
        barra.progress = mil
        tPorcentaje.text = "${mil / 10} %"
        tFase.text = Estado.fase
        tDetalle.text = buildString {
            if (Estado.total > 0) append("${Estado.hechos} de ${Estado.total} PDF")
            if (Estado.trabajando && Estado.archivoActual.isNotEmpty()) {
                append("\n").append(Estado.archivoActual)
                if (Estado.paginas > 0) append("\nPágina ${Estado.pagina} de ${Estado.paginas}")
                if (Estado.conOcr) append(" · leyendo escaneado (OCR)")
            }
        }
        tErrores.visibility = if (Estado.errores > 0) View.VISIBLE else View.GONE
        tErrores.text = "⚠ ${Estado.errores} PDF con error (se saltaron)"
        bEmpezar.text = when {
            Estado.trabajando -> "⏸  Pausar"
            Estado.hechos in 1 until Estado.total -> "▶  Seguir"
            else -> "▶  Empezar"
        }
        bEmpezar.isEnabled = carpeta != null && !(Estado.detener && Estado.trabajando)
        // El resumen de archivos se recalcula cada 5 s
        val ahora = System.currentTimeMillis()
        if (ahora - ultimoResumen > 5000) {
            ultimoResumen = ahora
            val lista = archivosDeTexto().filter { it.name.endsWith(".md") }
            val mb = lista.sumOf { it.length() } / 1048576.0
            tResumen.text = if (lista.isEmpty()) "Todavía no hay archivos."
            else "${lista.size} archivo${if (lista.size == 1) "" else "s"} de texto · ${"%.1f".format(mb)} MB\n" +
                lista.take(6).joinToString("\n") { "• " + it.name } + if (lista.size > 6) "\n• …" else ""
        }
    }

    private fun nombreDeCarpeta(uri: Uri): String = try {
        DocumentsContract.getTreeDocumentId(uri).substringAfter(":").ifBlank { "Carpeta principal" }
    } catch (e: Exception) {
        uri.toString()
    }

    private fun aviso(t: String) = Toast.makeText(this, t, Toast.LENGTH_LONG).show()

    // ---------- Acciones ----------
    private fun empezarOPausar() {
        if (Estado.trabajando) {
            startService(Intent(this, ServicioExtraccion::class.java).setAction(ServicioExtraccion.DETENER))
            return
        }
        if (prefs.getString("carpeta", null) == null) return aviso("Primero elige la carpeta.")
        Estado.fase = "Empezando…"
        ContextCompat.startForegroundService(this, Intent(this, ServicioExtraccion::class.java))
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        val uri = data?.data ?: return
        if (resultCode != RESULT_OK) return
        val permisos = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
        try {
            contentResolver.takePersistableUriPermission(uri, permisos)
        } catch (e: Exception) {
            contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        when (requestCode) {
            ELEGIR_ORIGEN -> {
                prefs.edit().putString("carpeta", uri.toString()).apply()
                Estado.fase = "Carpeta elegida. Toca Empezar."
                pintar()
            }
            ELEGIR_DESTINO -> guardarEn(uri)
        }
    }

    private fun archivosDeTexto(): List<File> =
        Extractor.carpetaTextos(this).listFiles()?.filter { it.isFile && it.length() > 0 }?.sortedBy { it.name } ?: emptyList()

    private fun compartir() {
        val lista = archivosDeTexto()
        if (lista.isEmpty()) return aviso("Todavía no hay archivos de texto.")
        val uris = ArrayList(lista.map { FileProvider.getUriForFile(this, "cu.finlay.extractor.archivos", it) })
        val intent = Intent(Intent.ACTION_SEND_MULTIPLE)
            .setType("text/plain")
            .putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        startActivity(Intent.createChooser(intent, "Compartir los textos"))
    }

    /** Copia los textos a la carpeta elegida (si ya existía un archivo con el mismo nombre, lo reemplaza). */
    private fun guardarEn(destino: Uri) {
        val lista = archivosDeTexto()
        aviso("Guardando ${lista.size} archivos…")
        thread {
            var bien = 0
            val padre = DocumentsContract.buildDocumentUriUsingTree(destino, DocumentsContract.getTreeDocumentId(destino))
            val existentes = mutableMapOf<String, Uri>()
            contentResolver.query(
                DocumentsContract.buildChildDocumentsUriUsingTree(destino, DocumentsContract.getTreeDocumentId(destino)),
                arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME),
                null, null, null,
            )?.use { c ->
                while (c.moveToNext()) existentes[c.getString(1)] = DocumentsContract.buildDocumentUriUsingTree(destino, c.getString(0))
            }
            for (f in lista) {
                try {
                    existentes[f.name]?.let { DocumentsContract.deleteDocument(contentResolver, it) }
                    val nuevo = DocumentsContract.createDocument(contentResolver, padre, "application/octet-stream", f.name) ?: continue
                    contentResolver.openOutputStream(nuevo)?.use { o -> f.inputStream().use { it.copyTo(o) } }
                    bien++
                } catch (e: Exception) {
                }
            }
            runOnUiThread { aviso("✅ Guardados $bien de ${lista.size} archivos") }
        }
    }

    private fun verErrores() {
        val f = Extractor.archivoErrores(this)
        val texto = if (f.exists() && f.length() > 0) f.readText().takeLast(6000) else "No hubo errores. 🎉"
        AlertDialog.Builder(this)
            .setTitle("PDF con error")
            .setMessage(texto)
            .setPositiveButton("Cerrar", null)
            .show()
    }

    private fun reiniciar() {
        if (Estado.trabajando) return aviso("Primero pausa el trabajo.")
        AlertDialog.Builder(this)
            .setTitle("¿Empezar de cero?")
            .setMessage("Se borran los textos ya sacados y la lista de PDF hechos. Tus PDF no se tocan.\n\nSi necesitas los textos, compártelos o guárdalos antes.")
            .setPositiveButton("Borrar y empezar de cero") { _, _ ->
                Extractor.carpetaTextos(this).listFiles()?.forEach { it.delete() }
                Extractor.archivoHechos(this).delete()
                Estado.hechos = 0; Estado.total = 0; Estado.bytesHechos = 0; Estado.bytesTotal = 0; Estado.errores = 0
                Estado.terminado = false
                Estado.fase = "Listo para empezar"
                ultimoResumen = 0
                pintar()
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }
}
