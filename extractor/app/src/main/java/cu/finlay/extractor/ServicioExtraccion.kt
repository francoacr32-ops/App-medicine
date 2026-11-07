package cu.finlay.extractor

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import kotlin.concurrent.thread

/**
 * Servicio "en primer plano": deja trabajar a la app aunque se apague la pantalla o se cambie de app,
 * con un aviso fijo que muestra el avance y un botón de Pausar.
 */
class ServicioExtraccion : Service() {

    companion object {
        const val CANAL = "extraccion"
        const val AVISO = 7
        const val DETENER = "cu.finlay.extractor.DETENER"
    }

    private var bloqueo: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == DETENER) {
            Estado.detener = true
            Estado.fase = "Pausando…"
            return START_NOT_STICKY
        }
        crearCanal()
        ServiceCompat.startForeground(
            this, AVISO, aviso(),
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC else 0,
        )
        val carpeta = getSharedPreferences("finlay", MODE_PRIVATE).getString("carpeta", null)
        if (Estado.trabajando || carpeta == null) {
            if (!Estado.trabajando) detenerServicio()
            return START_NOT_STICKY
        }
        Estado.trabajando = true
        Estado.detener = false
        Estado.terminado = false
        bloqueo = (getSystemService(POWER_SERVICE) as PowerManager)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "finlay:extractor").apply { acquire() }

        // Actualiza el aviso cada 2 segundos mientras trabaja
        thread(name = "aviso") {
            while (Estado.trabajando) {
                try {
                    getSystemService(NotificationManager::class.java).notify(AVISO, aviso())
                    Thread.sleep(2000)
                } catch (e: Exception) {
                    break
                }
            }
        }
        thread(name = "extractor") {
            try {
                Extractor(this, Uri.parse(carpeta)).ejecutar()
                if (Estado.total > 0) {
                    Estado.terminado = !Estado.detener
                    Estado.fase = if (Estado.detener) "En pausa. Toca Seguir para continuar." else "¡Terminado!"
                }
            } catch (t: Throwable) {
                Estado.fase = "Se detuvo por un error: ${t.message ?: t.javaClass.simpleName}"
            } finally {
                Estado.trabajando = false
                Estado.archivoActual = ""
                try { bloqueo?.release() } catch (e: Exception) { }
                detenerServicio()
            }
        }
        return START_NOT_STICKY
    }

    private fun detenerServicio() {
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun crearCanal() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val canal = NotificationChannel(CANAL, "Sacando texto", NotificationManager.IMPORTANCE_LOW)
            getSystemService(NotificationManager::class.java).createNotificationChannel(canal)
        }
    }

    private fun aviso() = NotificationCompat.Builder(this, CANAL)
        .setSmallIcon(R.drawable.ic_notif)
        .setContentTitle("Finlay Extractor · ${Estado.avanceMil() / 10} %")
        .setContentText(
            if (Estado.total > 0) "${Estado.hechos} de ${Estado.total} PDF${if (Estado.conOcr) " · leyendo escaneado (OCR)" else ""}"
            else Estado.fase
        )
        .setProgress(1000, Estado.avanceMil(), Estado.total == 0)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setContentIntent(
            PendingIntent.getActivity(
                this, 0, Intent(this, MainActivity::class.java),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        )
        .addAction(
            0, "Pausar",
            PendingIntent.getService(
                this, 1, Intent(this, ServicioExtraccion::class.java).setAction(DETENER),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        )
        .build()
}
