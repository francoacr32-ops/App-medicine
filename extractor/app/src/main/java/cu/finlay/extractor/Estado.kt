package cu.finlay.extractor

/** Estado del trabajo, compartido entre el servicio (que trabaja) y la pantalla (que lo muestra). */
object Estado {
    @Volatile var trabajando = false
    @Volatile var detener = false
    @Volatile var terminado = false
    @Volatile var fase = "Listo para empezar"
    @Volatile var archivoActual = ""
    @Volatile var pagina = 0
    @Volatile var paginas = 0
    @Volatile var conOcr = false
    @Volatile var hechos = 0
    @Volatile var total = 0
    @Volatile var bytesHechos = 0L
    @Volatile var bytesTotal = 0L
    @Volatile var errores = 0

    /** Avance de 0 a 1000 (por bytes: los libros grandes pesan más que una conferencia). */
    fun avanceMil(): Int =
        if (bytesTotal > 0) ((bytesHechos * 1000) / bytesTotal).toInt().coerceIn(0, 1000) else 0
}
