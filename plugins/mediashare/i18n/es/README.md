# Plugin Media Share

Permite que el equipo maestro envíe un archivo de medios local (video, audio o imagen) directamente a todas las pantallas de los pares emparejados, sin tener que crear antes una presentación ni importar el archivo a la biblioteca de medios.

## Propósito

El flujo de trabajo normal para mostrar medios a los pares requiere crear una presentación, importar el archivo y abrirla. Media Share es un atajo para el caso común en que solo quieres poner algo en las pantallas de los pares _ahora mismo_: eliges un archivo y aparece.

**Medios admitidos:**

| Tipo | Extensiones |
|---|---|
| Video | `.mp4` `.webm` `.mov` `.m4v` `.ogv` `.mkv` |
| Audio | `.mp3` `.ogg` `.wav` `.m4a` `.aac` `.opus` |
| Imagen | `.jpg` `.png` `.webp` `.gif` `.avif` `.svg` |

---

## Uso

1. Cambia al **modo LAN (red)** en la Configuración: los pares en otros dispositivos necesitan poder acceder al servidor Vite del maestro.
2. Abre **Presentation → Share Media to Peers…** desde la barra de menú.
3. Haz clic en **Share a Media File…** y elige un archivo desde cualquier parte del sistema de archivos local.
4. El archivo se abre en la ventana de presentación local y se sirve mediante una URL con token; presiona Z allí para enviarlo a los pares. El panel de administración muestra todos los recursos compartidos activos.
5. Haz clic en **Stop** en un recurso compartido individual (o en **Stop All Shares**) cuando termines. El acceso por token se revoca al instante y la presentación temporal se elimina.

El archivo nunca se copia ni se mueve. Se sirve en su lugar, desde su ubicación original, mientras dure el recurso compartido.

---

## Cómo funciona el sistema de tokens

Un enfoque ingenuo para servir un archivo local arbitrario por la red, como añadir un directorio estático o pasar la ruta como parámetro de URL, crea un riesgo de recorrido de rutas (path traversal): un par malicioso o comprometido podría recorrer el sistema de archivos. El sistema de tokens evita esto por completo.

### Componentes

**Registro de tokens** (`createMediaShare()` en `revelation/server/media-share.js`)

Un `Map<token, { absolutePath, mimeType }>` propiedad de la instancia del plugin vive dentro del proceso utilitario de Vite. Es la única fuente de verdad sobre qué archivos se pueden compartir actualmente. La ruta real del archivo nunca se transmite a ningún cliente; solo el token opaco sale del servidor.

**Escucha de mensajes de `parentPort`** (`revelation/vite.plugins.js`, gestionada por `handleParentMessage()` en `server/media-share.js`)

---

Como Vite se ejecuta en un `utilityProcess.fork()` de Electron, está aislado del proceso principal. Ambos lados se comunican mediante el canal IPC integrado de procesos utilitarios de Electron. El proceso de Vite escucha dos tipos de mensaje:

- `register-media-token`: añade `{ absolutePath, mimeType }` al Map bajo el token dado.
- `revoke-media-token`: elimina la entrada, haciendo que la URL devuelva 404 de inmediato.

**`registerMediaToken` / `revokeMediaToken`** (`lib/serverManager.js`)

Métodos contenedores del objeto `serverManager`. Generan el token y llaman a `viteProc.postMessage()` para transmitir la instrucción a través del límite entre procesos. La generación del token usa `crypto.randomBytes(24).toString('hex')`, lo que produce una cadena hexadecimal aleatoria de 192 bits y 48 caracteres, astronómicamente improbable de adivinar.

**Middleware `/media-share/<token>`** (`revelation/server/media-share.js`)

---

Registrado al inicio de la pila de middleware Connect de Vite, antes de cualquier servicio de archivos estáticos. Para cada solicitud entrante:

1. La URL debe comenzar con el prefijo `/media-share/`; todas las demás pasan al siguiente middleware.
2. El token extraído se valida con la expresión regular `/^[a-f0-9]{48}$/`. Cualquier cosa que no coincida (longitud incorrecta, caracteres incorrectos, separadores de ruta, secuencias codificadas) devuelve 404 de inmediato, sin consulta al Map ni acceso al sistema de archivos.
3. El token se busca en el registro. Si no está, 404.
4. Se consulta el estado (stat) del archivo. Si desapareció desde el registro, 404.
5. El archivo se transmite en flujo con soporte completo de `Range` de HTTP, de modo que los reproductores de video pueden avanzar sin descargar primero todo el archivo.

---

### Propiedades de seguridad

| Amenaza | Mitigación |
|---|---|
| Recorrido de rutas | La URL nunca contiene una ruta. La ruta del archivo se almacena solo en el servidor, asociada al token opaco. |
| Adivinar el token | Token aleatorio de 192 bits: la fuerza bruta no es factible. |
| Escape mediante enlaces simbólicos | `fs.realpathSync()` se llama al momento del registro. Lo que se almacena es la ruta real resuelta, por lo que los enlaces simbólicos no pueden usarse para eludir el acceso. |
| Acceso obsoleto tras detener | `revokeMediaToken()` elimina la entrada del Map. La siguiente solicitud a esa URL devuelve 404 antes de intentar cualquier E/S del sistema de archivos. |
| Exposición no deseada por LAN | La URL con token solo se sirve cuando Vite ya se ejecuta en modo `--host` (red), que el usuario habilitó explícitamente. No se abre ninguna superficie de red nueva. |
| Visibilidad en el índice de presentaciones | Las presentaciones temporales usan `alternatives: hidden` en su front matter YAML para que se filtren de la interfaz de la biblioteca. |

---

### Ciclo de vida

```
User picks file
  → plugin.js: fs.realpathSync() validates the path
  → serverManager.registerMediaToken() generates token, postMessages to Vite
  → Vite process: token added to the media-share registry
  → plugin.js: temp presentation written to presentationsDir/_mediashare_<id>/
  → plugin.js: presentationWindow.openWindow() shows the temp presentation locally
  → Presenter pushes it to peers (Z key in the presentation window); peers load the
    temp presentation, which references /media-share/<token>
  → Vite middleware: validates token, streams file with Range support

User clicks Stop (or app quits)
  → serverManager.revokeMediaToken() postMessages revocation to Vite
  → Vite process: token removed from Map — URL returns 404 immediately
  → plugin.js: temp presentation directory deleted from disk
  → (the plugin sends no peer command itself; the presenter closes/replaces the peer view)
```
