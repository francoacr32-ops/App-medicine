# Finlay Extractor

App Android sencilla que saca el texto de una carpeta de PDF (Año > Asignatura > PDF) y lo guarda en
un archivo `.md` por asignatura, sin internet. Las páginas escaneadas se leen con OCR (ML Kit, modelo
incluido en la app).

- Código: `app/src/main/java/cu/finlay/extractor/`
  - `Extractor.kt`: recorre las carpetas, saca el texto (PdfBox) y hace OCR (ML Kit) página por página.
  - `ServicioExtraccion.kt`: sigue trabajando con la pantalla apagada (servicio en primer plano).
  - `MainActivity.kt`: la pantalla.
- El APK lo arma GitHub Actions (`.github/workflows/finlay-extractor.yml`) y lo publica en *Releases*.
- Los archivos de salida se parten en partes de ~20 MB (GitHub acepta 25 MB desde el navegador del teléfono).
