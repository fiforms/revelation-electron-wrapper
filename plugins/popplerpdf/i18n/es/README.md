# Plugin Poppler PDF

Este plugin incluye una carga útil local de Poppler y configura las rutas de herramientas PDF de Add Media cuando está habilitado.

Hay un ZIP del plugin por plataforma y arquitectura:

- `PopplerPDF.Plugin.<ver>.for.REVELation.Windows-x64.zip`
- `PopplerPDF.Plugin.<ver>.for.REVELation.macOS-arm64.zip`
- `PopplerPDF.Plugin.<ver>.for.REVELation.macOS-x64.zip`

La pantalla de configuración de primera ejecución descarga e instala el adecuado para el equipo.

---

## Comportamiento

- Al registrarse, escanea esta carpeta en busca de cargas `poppler-*` compiladas para esta plataforma y arquitectura.
- Selecciona la más nueva que contenga `pdftoppm`.
- Escribe estos ajustes de Add Media en la configuración de la app:
  - `pluginConfigs.addmedia.pdftoppmPath`
  - `pluginConfigs.addmedia.pdfinfoPath`

Estructuras de carga esperadas:

---

```text
# Windows (from poppler-windows)
plugins/popplerpdf/poppler-26.09.0/Library/bin/pdftoppm.exe
plugins/popplerpdf/poppler-26.09.0/Library/bin/pdfinfo.exe

# macOS (from scripts/build-popplerpdf-mac.js)
plugins/popplerpdf/poppler-26.09.0-macos-arm64/bin/pdftoppm      # wrapper script
plugins/popplerpdf/poppler-26.09.0-macos-arm64/bin/pdfinfo       # wrapper script
plugins/popplerpdf/poppler-26.09.0-macos-arm64/libexec/          # real binaries
plugins/popplerpdf/poppler-26.09.0-macos-arm64/lib/              # bundled dylibs
plugins/popplerpdf/poppler-26.09.0-macos-arm64/etc/fonts/fonts.conf
```

---

En macOS, Add Media llama a los scripts envoltorio de `bin/`. Estos establecen
`FONTCONFIG_FILE` apuntando al `fonts.conf` incluido, porque fontconfig de conda-forge
tiene compilada su ubicación de instalación y no puede encontrar su propia configuración una vez movido.
poppler-data no se incluye en macOS por la misma razón. Solo importa para
PDF en chino, japonés o coreano que no incrustan sus fuentes.

---

## Compilación

```shell
# Windows: download the poppler-windows release into this folder
npm run build-popplerpdf-win
npm run dist-popplerpdf

# macOS (run on a Mac): install conda-forge Poppler with micromamba, bundle it,
# re-sign it ad hoc and test it from another folder
npm run build-popplerpdf-mac                 # this Mac's architecture
npm run build-popplerpdf-mac -- --arch=x64   # or arm64
npm run dist-popplerpdf
```

---

El paso dist escribe el ZIP con sufijo de arquitectura en `dist/`. `scripts/prepackage.js`
hace lo mismo durante una compilación completa de la app y luego elimina `plugins/popplerpdf` antes
de la compilación del paquete principal de Electron. El flujo de trabajo de GitHub `build-macos` compila ambos
ZIP de macOS, imprime su SHA-256 y los sube como artefactos.

Después de publicar nuevos ZIP, actualiza las URL y los hashes SHA-256 en
`POPPLER_PLUGIN_DOWNLOADS` en `lib/popplerRelease.js` (un archivo pequeño solo de datos; la
etiqueta de versión es `POPPLER_PLUGIN_RELEASE` en el mismo archivo). Se rechaza una descarga cuyo hash no coincida,
y no se ofrece una plataforma que no tenga hash.

## SOLUCIÓN DE PROBLEMAS

Si el programa no se ejecuta en Windows, quizá necesites instalar el Microsoft Visual C++ 2015 Redistributable desde
https://aka.ms/vs/17/release/vc_redist.x64.exe
