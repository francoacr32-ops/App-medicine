plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Cada armado en GitHub sube el número de versión (así se instala encima de la anterior)
val numero = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()

android {
    namespace = "cu.finlay.extractor"
    compileSdk = 34

    defaultConfig {
        applicationId = "cu.finlay.extractor"
        minSdk = 24
        targetSdk = 34
        versionCode = numero
        versionName = "1.0.$numero"
    }

    // Firma fija: viene de los "secretos" del repositorio en GitHub (nunca en el código).
    // Si no hay secreto, se usa la firma de prueba de Android.
    val llave = System.getenv("FIRMA_ARCHIVO")
    signingConfigs {
        if (llave != null && file(llave).exists()) {
            create("finlay") {
                storeFile = file(llave)
                storePassword = System.getenv("FIRMA_CLAVE")
                keyAlias = System.getenv("FIRMA_ALIAS") ?: "extractor"
                keyPassword = System.getenv("FIRMA_CLAVE")
            }
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("finlay") ?: signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    lint {
        abortOnError = false
        checkReleaseBuilds = false
    }
    packaging {
        resources { excludes += setOf("META-INF/DEPENDENCIES", "META-INF/LICENSE*", "META-INF/NOTICE*") }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    // Texto de los PDF (sin internet)
    implementation("com.tom-roush:pdfbox-android:2.0.27.0")
    // OCR de Google con el modelo incluido en la app (sin internet; letras latinas: español)
    implementation("com.google.mlkit:text-recognition:16.0.1")
}
