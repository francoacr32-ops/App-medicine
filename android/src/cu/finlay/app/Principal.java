package cu.finlay.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.DialogInterface;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Finlay para Android: muestra la app web (carpeta assets/www) dentro de una ventana propia
 * y le da tres cosas que el navegador interno no trae: elegir archivos, voz y guardar/compartir.
 */
public class Principal extends Activity {

    /** Dirección reservada por Android para servir archivos propios de la app como si fueran web. */
    static final String HOST = "appassets.androidplatform.net";
    static final int PEDIR_ARCHIVOS = 1;
    static final int GUARDAR_ARCHIVO = 2;

    WebView web;
    ValueCallback<Uri[]> esperandoArchivos;
    TextToSpeech tts;
    boolean vozLista = false;
    String ultimoTrozo = null;
    byte[] pendienteGuardar;

    @Override
    protected void onCreate(Bundle guardado) {
        super.onCreate(guardado);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setTextZoom(100);

        web.setWebViewClient(new ClienteWeb());
        web.setWebChromeClient(new ClienteChrome());
        web.addJavascriptInterface(new Puente(), "FinlayAndroid");

        tts = new TextToSpeech(this, new TextToSpeech.OnInitListener() {
            @Override
            public void onInit(int estado) {
                if (estado != TextToSpeech.SUCCESS) return;
                int r = tts.setLanguage(new Locale("es", "ES"));
                if (r < 0) r = tts.setLanguage(new Locale("es"));
                vozLista = true;
                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override public void onStart(String id) { }
                    @Override public void onDone(String id) { if (id.equals(ultimoTrozo)) avisarFinVoz(); }
                    @Override public void onError(String id) { avisarFinVoz(); }
                });
            }
        });

        if (guardado != null) web.restoreState(guardado);
        else web.loadUrl("https://" + HOST + "/index.html");
    }

    @Override
    protected void onSaveInstanceState(Bundle estado) {
        super.onSaveInstanceState(estado);
        web.saveState(estado);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (tts != null) tts.shutdown();
        super.onDestroy();
    }

    void avisarFinVoz() {
        runOnUiThread(new Runnable() {
            @Override public void run() {
                web.evaluateJavascript("window.__finlayVozFin && window.__finlayVozFin()", null);
            }
        });
    }

    // ---------- Servir la app desde assets/www ----------
    class ClienteWeb extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView vista, WebResourceRequest pedido) {
            Uri u = pedido.getUrl();
            if (!HOST.equals(u.getHost())) return null;
            String ruta = u.getPath();
            if (ruta == null || ruta.equals("/") || ruta.isEmpty()) ruta = "/index.html";
            try {
                InputStream datos = getAssets().open("www" + ruta);
                Map<String, String> cabeceras = new HashMap<String, String>();
                cabeceras.put("Cache-Control", "no-cache");
                return new WebResourceResponse(tipo(ruta), "UTF-8", 200, "OK", cabeceras, datos);
            } catch (IOException e) {
                return new WebResourceResponse("text/plain", "UTF-8", 404, "No encontrado",
                        new HashMap<String, String>(), null);
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView vista, WebResourceRequest pedido) {
            Uri u = pedido.getUrl();
            if (HOST.equals(u.getHost())) return false;
            // Los enlaces externos se abren en el navegador del teléfono
            try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception e) { }
            return true;
        }
    }

    static String tipo(String ruta) {
        String r = ruta.toLowerCase(Locale.ROOT);
        if (r.endsWith(".html")) return "text/html";
        if (r.endsWith(".js") || r.endsWith(".mjs")) return "application/javascript";
        if (r.endsWith(".css")) return "text/css";
        if (r.endsWith(".json")) return "application/json";
        if (r.endsWith(".webmanifest")) return "application/manifest+json";
        if (r.endsWith(".png")) return "image/png";
        if (r.endsWith(".svg")) return "image/svg+xml";
        if (r.endsWith(".jpg") || r.endsWith(".jpeg")) return "image/jpeg";
        return "application/octet-stream";
    }

    // ---------- Elegir archivos (PDF, Word, PowerPoint, paquetes) ----------
    class ClienteChrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView vista, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (esperandoArchivos != null) esperandoArchivos.onReceiveValue(null);
            esperandoArchivos = callback;
            Intent i = new Intent(Intent.ACTION_GET_CONTENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("*/*");
            if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            try {
                startActivityForResult(Intent.createChooser(i, "Elegir archivo"), PEDIR_ARCHIVOS);
            } catch (Exception e) {
                esperandoArchivos = null;
                return false;
            }
            return true;
        }
    }

    @Override
    protected void onActivityResult(int pedido, int resultado, Intent datos) {
        if (pedido == PEDIR_ARCHIVOS) {
            if (esperandoArchivos == null) return;
            Uri[] elegidos = null;
            if (resultado == RESULT_OK && datos != null) {
                ClipData clip = datos.getClipData();
                if (clip != null) {
                    ArrayList<Uri> lista = new ArrayList<Uri>();
                    for (int k = 0; k < clip.getItemCount(); k++) lista.add(clip.getItemAt(k).getUri());
                    elegidos = lista.toArray(new Uri[0]);
                } else if (datos.getData() != null) {
                    elegidos = new Uri[]{datos.getData()};
                }
            }
            esperandoArchivos.onReceiveValue(elegidos);
            esperandoArchivos = null;
        } else if (pedido == GUARDAR_ARCHIVO) {
            if (resultado == RESULT_OK && datos != null && datos.getData() != null && pendienteGuardar != null) {
                try {
                    OutputStream sal = getContentResolver().openOutputStream(datos.getData());
                    sal.write(pendienteGuardar);
                    sal.close();
                    Toast.makeText(this, "✅ Archivo guardado", Toast.LENGTH_LONG).show();
                } catch (Exception e) {
                    Toast.makeText(this, "No se pudo guardar el archivo", Toast.LENGTH_LONG).show();
                }
            }
            pendienteGuardar = null;
        } else {
            super.onActivityResult(pedido, resultado, datos);
        }
    }

    // ---------- Guardar o enviar un archivo ----------
    void guardarOEnviar(final String nombre, final String contenido, final String mime) {
        final byte[] bytes;
        try {
            bytes = contenido.getBytes("UTF-8");
        } catch (Exception e) {
            return;
        }
        String[] opciones = {"💾 Guardar en el teléfono", "📤 Enviar (Zapya, WhatsApp, Claude, Bluetooth…)"};
        new AlertDialog.Builder(this)
                .setTitle(nombre)
                .setItems(opciones, new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface d, int cual) {
                        if (cual == 0) guardar(nombre, bytes, mime);
                        else enviar(nombre, bytes, mime);
                    }
                })
                .setNegativeButton("Cancelar", null)
                .show();
    }

    void guardar(String nombre, byte[] bytes, String mime) {
        pendienteGuardar = bytes;
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType(mime);
        i.putExtra(Intent.EXTRA_TITLE, nombre);
        try {
            startActivityForResult(i, GUARDAR_ARCHIVO);
        } catch (Exception e) {
            Toast.makeText(this, "Este teléfono no permite elegir dónde guardar", Toast.LENGTH_LONG).show();
        }
    }

    void enviar(String nombre, byte[] bytes, String mime) {
        try {
            File carpeta = new File(getCacheDir(), "compartir");
            carpeta.mkdirs();
            File[] viejos = carpeta.listFiles();
            if (viejos != null) for (File f : viejos) f.delete();
            String seguro = nombre.replaceAll("[\\\\/:*?\"<>|]", "-");
            File archivo = new File(carpeta, seguro);
            FileOutputStream sal = new FileOutputStream(archivo);
            sal.write(bytes);
            sal.close();
            Uri uri = Uri.parse("content://" + Archivos.AUTORIDAD + "/" + Uri.encode(seguro));
            Intent i = new Intent(Intent.ACTION_SEND);
            i.setType(mime);
            i.putExtra(Intent.EXTRA_STREAM, uri);
            i.putExtra(Intent.EXTRA_SUBJECT, nombre);
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(Intent.createChooser(i, "Enviar " + nombre));
        } catch (Exception e) {
            Toast.makeText(this, "No se pudo preparar el archivo para enviar", Toast.LENGTH_LONG).show();
        }
    }

    // ---------- Puente con la página (window.FinlayAndroid) ----------
    class Puente {
        @JavascriptInterface
        public boolean vozDisponible() {
            return vozLista;
        }

        @JavascriptInterface
        public void hablar(String texto, float velocidad) {
            if (!vozLista || texto == null) { avisarFinVoz(); return; }
            tts.stop();
            tts.setSpeechRate(velocidad > 0 ? velocidad : 1f);
            int maximo = Math.min(3000, TextToSpeech.getMaxSpeechInputLength() - 1);
            String resto = texto.trim();
            int n = 0;
            String ultimo = null;
            while (!resto.isEmpty()) {
                int corte = resto.length();
                if (corte > maximo) {
                    corte = resto.lastIndexOf(". ", maximo);
                    if (corte < maximo / 2) corte = resto.lastIndexOf(' ', maximo);
                    if (corte < maximo / 2) corte = maximo;
                    corte++;
                }
                String trozo = resto.substring(0, Math.min(corte, resto.length()));
                resto = resto.substring(Math.min(corte, resto.length())).trim();
                ultimo = "finlay-" + (n++);
                ultimoTrozo = ultimo;
                Bundle p = new Bundle();
                tts.speak(trozo, TextToSpeech.QUEUE_ADD, p, ultimo);
            }
            if (ultimo == null) avisarFinVoz();
        }

        @JavascriptInterface
        public void detener() {
            if (tts != null) tts.stop();
            ultimoTrozo = null;
        }

        @JavascriptInterface
        public void guardar(final String nombre, final String contenido, final String mime) {
            runOnUiThread(new Runnable() {
                @Override public void run() { guardarOEnviar(nombre, contenido, mime); }
            });
        }
    }
}
