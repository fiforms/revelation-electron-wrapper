# Configuración de importación de PDF (Poppler)

### Tabla de contenidos
* [Resumen](#pdf-overview)
* [Configurar rutas en la app](#pdf-configure-paths)
* [Configuración en Windows](#pdf-windows)
* [Configuración en macOS](#pdf-macos)
* [Configuración en Linux](#pdf-linux)
* [Solución de problemas](#pdf-troubleshooting)

---

<a id="pdf-overview"></a>

## Resumen

Esta guía explica cómo instalar Poppler y configurar el plugin Add Media para que las páginas PDF puedan importarse como diapositivas.

---

<a id="pdf-configure-paths"></a>

## Configurar rutas en la app

Si el plugin `popplerpdf` está habilitado e incluye un payload de Poppler empaquetado, estos valores se rellenan automáticamente para Add Media al iniciar.

En caso contrario, configura manualmente:

1. Abre la ventana de configuración de la app.
2. Ve a la sección Plugins.
3. Busca el plugin Add Media.
4. Completa:
- `pdftoppmPath`
- `pdfinfoPath`
5. Guarda la configuración y reinicia la app.

Usa rutas completas de los binarios.

---

<a id="pdf-windows"></a>

## Configuración automática en Windows

1. Descarga e instala el plugin `popplerpdf-windows-XXXX.zip` desde la página de versiones https://github.com/fiforms/revelation-electron-wrapper/releases
2. Instala el plugin: abre el software, en el menú haz clic en "Plugins" -> "Install Plugin from ZIP..." y selecciona el archivo descargado
3. Habilita el plugin: ve a "Settings", desplázate hasta "Plugin Manager" y marca la casilla junto a popplerpdf.

---

## Configuración manual en Windows

(Usa esto solo si ya tienes poppler o si no quieres usar la opción del plugin anterior en Windows)

1. Descarga Poppler para Windows:
https://github.com/oschwartz10612/poppler-windows/releases
2. Descomprime en una carpeta local (por ejemplo `C:\Tools\poppler`).
3. Ubica los binarios (ejemplo):

```text
<unzipped>\poppler-<version>\Library\bin\pdftoppm.exe
<unzipped>\poppler-<version>\Library\bin\pdfinfo.exe
```

4. Pega esas rutas completas en la configuración del plugin Add Media.

Ejemplo:

```text
pdftoppmPath = C:\Tools\poppler\poppler-24.08.0\Library\bin\pdftoppm.exe
pdfinfoPath  = C:\Tools\poppler\poppler-24.08.0\Library\bin\pdfinfo.exe
```

---

<a id="pdf-macos"></a>

## Configuración en macOS

La pantalla de configuración de primer inicio puede descargar e instalar el plugin PopplerPDF para
tu Mac (Apple Silicon o Intel). Para instalar Poppler con Homebrew en su lugar:

```bash
brew install poppler
which pdftoppm
which pdfinfo
```

Add Media también busca en `/opt/homebrew/bin` y `/usr/local/bin`, por lo que esto
normalmente funciona después de reiniciar la app. Si no funciona, usa las rutas resultantes
en la configuración del plugin. En Apple Silicon suele ser:

```text
/opt/homebrew/bin/pdftoppm
/opt/homebrew/bin/pdfinfo
```

---

<a id="pdf-linux"></a>

## Configuración en Linux

Instala Poppler con tu gestor de paquetes:

```bash
sudo apt install poppler-utils
sudo dnf install poppler-utils
sudo pacman -S poppler
```

Luego encuentra las rutas:

```bash
which pdftoppm
which pdfinfo
```

Rutas típicas:

```text
/usr/bin/pdftoppm
/usr/bin/pdfinfo
```

---

<a id="pdf-troubleshooting"></a>

## Solución de problemas

- Si la importación de PDF no puede ejecutar Poppler, verifica ambas rutas y reinicia la app.
- Asegúrate de que ambos binarios existan y sean ejecutables.
