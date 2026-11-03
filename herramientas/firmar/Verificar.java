import com.android.apksig.ApkVerifier;

import java.io.File;

/** Verifica las firmas v1 y v2 de un APK con apksig (la biblioteca oficial de Android). */
public class Verificar {
    public static void main(String[] a) throws Exception {
        ApkVerifier.Result r = new ApkVerifier.Builder(new File(a[0])).build().verify();
        System.out.println("Verificado: " + r.isVerified() + " | v1: " + r.isVerifiedUsingV1Scheme()
                + " | v2: " + r.isVerifiedUsingV2Scheme());
        for (Object e : r.getErrors()) System.out.println("ERROR: " + e);
        for (Object w : r.getWarnings()) System.out.println("Aviso: " + w);
        if (!r.isVerified()) System.exit(1);
    }
}
