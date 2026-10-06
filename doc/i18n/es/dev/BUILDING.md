# Compilación de REVELation Snapshot Presenter

## Requisitos previos

- **Node.js** 22.12+ y npm (requerido por Electron 44; el flujo de trabajo de CI de macOS usa Node 20 para las instalaciones, que es inferior a este requisito)
- **Git** (con soporte para submódulos)
- **Python** (para la compilación de módulos nativos)
- Herramientas de compilación específicas de cada plataforma (consulta las secciones de cada plataforma más abajo)

---

## Configuración inicial

### 1. Clonar el repositorio con submódulos

```bash
git clone --recurse-submodules https://github.com/fiforms/revelation-electron-wrapper.git
cd revelation-electron-wrapper
```

Si ya clonaste sin submódulos, inicialízalos:

```bash
git submodule update --init --recursive
```

---

### 2. Instalar dependencias

Instalación estándar:

```bash
npm install
```

Esto hará lo siguiente (mediante `scripts/preinstall.js` y `scripts/postinstall.js`):
- Ejecutar `npm install --omit=dev` y `npm run build` dentro del submódulo `revelation/`
- Instalar todos los paquetes de npm
- Descargar recursos remotos (Biblias, ffmpeg solo en macOS/Windows, effectgenerator, miniaturas de temas, oldcss, galería de mediafx)
- Descargar desde GitHub las dependencias PHP del plugin de WordPress

Los paquetes de plugins (highlight, math, revealchart, appearance) *no* se copian en el momento de la instalación; `npm run build` se encarga de ello.

---

## Recursos remotos e instalación sin conexión

El proyecto descarga varios recursos precompilados durante `npm install`:

---

### Recursos de www.pastordaniel.net

- **Bibles** — Archivos XML de traducciones de la Biblia
  - Como alternativa, descarga traducciones desde https://sourceforge.net/projects/zefania-sharp/files/Bibles/ u otra fuente XMLBIBLE
  - Coloca los archivos XML extraídos en `plugins/bibletext/bibles`
- **effectgenerator** — Binario nativo para la generación de efectos
  - Como alternativa, descarga la última versión desde https://github.com/fiforms/effectgenerator
  - Coloca el binario `effectgenerator` o `effectgenerator.exe` de tu plataforma en `bin/`
- **Miniaturas de temas** — Imágenes de vista previa de los temas disponibles
  - Se almacenan en la carpeta de código fuente: `revelation/css/theme-thumbnails/`
  - Se copian a dist durante la compilación (sobreviven a las recompilaciones)
  - Como alternativa, genéralas iniciando la aplicación y eligiendo "Help → Debug → Generate Theme Thumbnails" (se guardan en la carpeta de código fuente)
- **oldcss** — Recursos CSS heredados
  - Se pueden ignorar si la compatibilidad total con versiones anteriores no es una prioridad
  - Como alternativa, extráelos de una versión anterior
- **Galería de mediafx** — Videos de vista previa de los efectos de MediaFX
  - Como alternativa, genérala ejecutando `./generate_gallery.sh` dentro de `plugins/mediafx/gallery/` (solo Linux/Mac)

---

### Bibliotecas PHP desde GitHub

- **Dependencias del plugin de WordPress** — Bibliotecas de Composer para el plugin de WordPress
  - Se descargan de las versiones publicadas en GitHub (league/commonmark, componentes de symfony, utilidades de nette, etc.)
  - Se extraen en `WordPress/revelation-presentations/vendor/`
  - **Descarga**: `npm run fetch-wordpress-libs` — Descarga únicamente las dependencias PHP de GitHub para el plugin de WordPress

---

### Omitir las descargas durante la instalación

Si quieres instalar las dependencias manualmente o www.pastordaniel.net no está disponible:

```bash
SKIP_BLOBS=true npm install
```

Esto completará la instalación sin descargar ningún recurso remoto (ni los recursos de www.pastordaniel.net ni las bibliotecas de WordPress alojadas en GitHub).

---

### Descargar los recursos más tarde

Si omitiste las descargas y quieres obtenerlas después:

- `npm run fetch-blobs` — Descarga Biblias, ffmpeg (solo macOS/Windows), effectgenerator, miniaturas de temas, oldcss, la galería de mediafx y las bibliotecas PHP de WordPress (la misma lista que ejecuta `npm install`)

Si alguna descarga específica falla, el proceso continúa con las demás (no son críticas para el desarrollo).

### Cómo funciona el almacenamiento en caché

Las miniaturas de temas se almacenan en caché en la **carpeta de código fuente** (`revelation/css/theme-thumbnails/`) en lugar de la carpeta de salida de la compilación (`revelation/dist/css/theme-thumbnails/`). Durante `npm run build`:

1. El proceso de compilación de Revelation reconstruye `revelation/dist` desde cero
2. Las miniaturas de temas se obtienen (o se verifican) en la carpeta de código fuente
3. Luego se copian de la carpeta de código fuente a dist

Este enfoque garantiza que:
- Los archivos se descarguen una sola vez y se almacenen en caché de forma persistente
- Las recompilaciones no requieran volver a descargar desde la red
- El script de generación escriba de forma natural en la carpeta de código fuente, por coherencia

---

## Compilación en macOS

Antes de compilar, asegúrate de tener Homebrew, Node.js y Git instalados. Desde una terminal:

```shell
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Verificar disponibilidad
brew --version

# Instalar Node:
brew install node

# Verificar:
node -v
npm -v

# Instalar Git
brew install git

# Verificar
git --version
```

---

### Compilar la aplicación (Apple Silicon)

```shell
git clone --recurse-submodules https://github.com/fiforms/revelation-electron-wrapper.git
cd revelation-electron-wrapper

npm install

# Probar la app
npm start

# Opcional: compilar el plugin PopplerPDF para este Mac (consulta plugins/popplerpdf/README.md)
npm run build-popplerpdf-mac

npm run dist-mac
```

`dist-mac` también escribe `dist/PopplerPDF.Plugin.<ver>.for.REVELation.macOS-<arch>.zip`
cuando antes se compiló un payload de Poppler.

### Compilación en macOS (Intel, compilación cruzada desde arm64)

- Instala Rosetta
- Configura la app Terminal para abrir usando Rosetta
- Sigue las instrucciones de compilación anteriores en un directorio nuevo

---

## Compilación en Windows

Primero instala [Git](https://gitforwindows.org/) y [Node](https://nodejs.org/en/download)

Abre una ventana de PowerShell

```shell
git clone --recurse-submodules https://github.com/fiforms/revelation-electron-wrapper.git
cd revelation-electron-wrapper
npm install

# Probar la app
npm start

# Compilar el plugin Poppler
npm run build-popplerpdf-win
npm run dist-popplerpdf

# Compilar el paquete
npm run dist-win
```

---

## Compilación en Linux

Configurar el entorno (Ubuntu):

```shell
sudo apt install git npm libnspr4 libnss3 ffmpeg
sudo npm install -g node@latest
sudo npm install -g npm@latest
```

Compilar:

```shell
git clone --recurse-submodules https://github.com/fiforms/revelation-electron-wrapper.git
cd revelation-electron-wrapper
npm install
npm start
npm run dist-linux
```

---

## Asociación de archivos `.revel`

Los instaladores registran la extensión `.revel` (tipo MIME `application/vnd.revelation.presentation+zip`). La configuración está en la sección `build` de `package.json`:

- `fileAssociations` registra la extensión para NSIS (Windows), deb/rpm (Linux) y macOS.
- `mac.extendInfo` agrega la entrada `UTExportedTypeDeclarations` de macOS (`com.revelation.snapshot.presentation`).
- Los íconos están en `build-resources/`: `file-icon.ico` (Windows), `file-icon.icns` (macOS) y `file-icon.png` (maestro de 1024 px). electron-builder recurre al ícono de la aplicación si falta el archivo de la plataforma. electron-builder no puede establecer un ícono de archivo en Linux, por lo que la aplicación instala uno por usuario al iniciar (consulta [REVEL_IMPLEMENTATION.md](REVEL_IMPLEMENTATION.md#linux-file-icon)); `file-icon.png` se distribuye como recurso adicional para ese fin.

Las compilaciones AppImage no tienen paso de instalación y no registran la extensión. El flujo de trabajo `build-macos.yml` no necesita cambios; ambos trabajos toman la configuración de `package.json`.

Para verificar una compilación: instálala, haz doble clic en un archivo `.revel` y confirma que se abre en el lightbox; desinstala y confirma que la asociación desaparece. Consulta [REVEL_IMPLEMENTATION.md](REVEL_IMPLEMENTATION.md#os-registration) para los detalles del registro y [REVEL_FORMAT.md](REVEL_FORMAT.md) para el formato de archivo.

---

## Desarrollo

### Ejecutar en modo de desarrollo

```bash
npm run dev
```

Inicia la aplicación Electron con recarga en caliente para el desarrollo de temas.

---

### Compilar solo los recursos

```bash
npm run build
```

Ejecuta, en orden: la compilación de `revelation/`, `revelation/scripts/fetch-oldcss.js`, `fetch-theme-thumbnails.js`
(ambos se omiten si ya existen), `copy-theme-thumbnails.js`, `copy-plugins.js`,
`build-offline-plugins.js`, `wp:sync-runtime` y `wp:package`. Los dos últimos copian los recursos de
ejecución en `WordPress/revelation-presentations/` y escriben
`WordPress/build/revelation-presentations-wordpress-plugin-<version>.zip`
(ambas ubicaciones están en gitignore). No descarga Biblias ni otros blobs.

---

### Flujo de empaquetado (`npm run dist-<platform>`)

`dist-win`, `dist-linux`, `dist-mac` y `dist-mac-intel` ejecutan `npm run build` y luego
`node scripts/package.js --<platform>`, que:

1. `prepackage.js` depura el árbol: elimina los plugins que no se distribuyen, copia el zip del plugin de WordPress en `dist/`, y aparta `revelation/presentations_*`, los archivos `.json` de Biblias, los paquetes de `revelation/node_modules` solo para desarrollo y `plugins/popplerpdf` (comprimido primero en `dist/PopplerPDF.Plugin.*.zip` si existe un payload de Poppler).
2. Ejecuta `electron-builder` (la configuración es la sección `build` de `package.json`; los instaladores quedan en `dist/`).
3. Restaura todo desde `.package-stash/` (también con Ctrl+C). Si una ejecución fue interrumpida, la siguiente ejecución restaura automáticamente, o ejecuta `node scripts/package-stash.js`.

### Compilar plugins sin conexión

```bash
npm run build:offline-plugins
```

---

## Solución de problemas

### "Revelation submodule not found"

Asegúrate de que los submódulos estén inicializados:

```bash
git submodule update --init --recursive
npm install
```

### Blobs faltantes

Si algunos recursos no se descargan durante la instalación:

1. Intenta descargarlos de nuevo: `npm run fetch-blobs`
2. Algunos recursos pueden fallar en silencio; la app puede funcionar sin ellos, pero con funcionalidad reducida

### Problemas de compilación de módulos nativos

Si ves errores al compilar módulos nativos, asegúrate de tener instaladas las herramientas de compilación específicas de tu plataforma:

- **macOS**: Xcode Command Line Tools (`xcode-select --install`)
- **Windows**: Visual Studio Build Tools para C++
- **Linux**: `build-essential` y otras herramientas de desarrollo

---

## Estructura del proyecto

- `revelation/` — Submódulo del framework central REVELation (Reveal.js, compilado con Vite)
- `plugins/` — Módulos de plugins (BibleText, MediaFX, etc.)
- `WordPress/` — Código fuente del plugin de WordPress
- `scripts/` — Scripts de compilación y utilidades
- `gnome-extension/`, `kwin-script/` — Ayudantes de colocación de ventanas en Wayland usados por `lib/gnomeWindowHelper.js` y `lib/kwinWindowHelper.js`
- `http_admin/` — Interfaz de administración del servidor

Consulta [AGENTS.md](../../AGENTS.md) para la documentación detallada de la arquitectura.
