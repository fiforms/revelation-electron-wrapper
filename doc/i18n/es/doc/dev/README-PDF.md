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

Si el plugin `popplerpdf` está habilitado e incluye una carga útil de Poppler empaquetada, estos valores se rellenan automáticamente para Add Media al iniciar.

En caso contrario, configure manualmente:

1. Abra la ventana de configuración de la app.
2. Vaya a la sección Plugins.
3. Busque el plugin Add Media.
4. Complete:
- `pdftoppmPath`
- `pdfinfoPath`
5. Guarde la configuración y reinicie la app.

Use rutas completas de binarios.

---

<a id="pdf-windows"></a>

## Configuración automática en Windows

1. Descargue e instale el plugin `popplerpdf-windows-XXXX.zip` desde la página de releases https://github.com/fiforms/revelation-electron-wrapper/releases
2. Instale el plugin: abra el software, en el menú haga clic en "Plugins" -> "Install Plugin from ZIP..." y seleccione el archivo descargado
3. Habilite el plugin: vaya a "Settings", desplácese hasta "Plugin Manager" y marque la casilla junto a popplerpdf.

## Configuración manual en Windows

(Use esto solo si ya tiene poppler o si no desea usar la opción de plugin en Windows)

1. Descargue Poppler para Windows:
https://github.com/oschwartz10612/poppler-windows/releases
2. Descomprima en una carpeta local (por ejemplo `C:\Tools\poppler`).
3. Ubique los binarios (ejemplo):

```text
<unzipped>\poppler-<version>\Library\bin\pdftoppm.exe
<unzipped>\poppler-<version>\Library\bin\pdfinfo.exe
```

4. Pegue esas rutas completas en la configuración del plugin Add Media.

Ejemplo:

```text
pdftoppmPath = C:\Tools\poppler\poppler-24.08.0\Library\bin\pdftoppm.exe
pdfinfoPath  = C:\Tools\poppler\poppler-24.08.0\Library\bin\pdfinfo.exe
```

---

<a id="pdf-macos"></a>

## Configuración en macOS

```bash
brew install poppler
which pdftoppm
which pdfinfo
```

Use las rutas resultantes en la configuración del plugin. En Apple Silicon suele ser:

```text
/opt/homebrew/bin/pdftoppm
/opt/homebrew/bin/pdfinfo
```

---

<a id="pdf-linux"></a>

## Configuración en Linux

Instale Poppler con su gestor de paquetes:

```bash
sudo apt install poppler-utils
sudo dnf install poppler-utils
sudo pacman -S poppler
```

Luego encuentre las rutas:

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

- Si la importación de PDF no puede ejecutar Poppler, verifique ambas rutas y reinicie la app.
- Asegúrese de que ambos binarios existan y sean ejecutables.
