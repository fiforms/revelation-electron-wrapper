# Guía de Configuración

Esta guía explica la pantalla de Configuración en lenguaje sencillo:

- qué cambia cada opción en el uso real
- cuándo te conviene cambiarla
- qué esperar después de aplicar tus cambios

Para una vista general de la app, consulta [doc/GUI_REFERENCE.md](GUI_REFERENCE.md).

## Antes de cambiar la configuración

- La ventana de Configuración tiene siete pestañas: **Screens** (Pantallas), **Networking** (Redes), **Folders & Paths** (Carpetas y Rutas), **PIP**, **Hotkeys** (Atajos), **Plugins** (Complementos) y **Peer Pairing** (Emparejamiento de pares).
- El botón **Apply and Relaunch** (Aplicar y reiniciar), arriba a la derecha, permanece deshabilitado hasta que cambies algo. Al hacer clic, guarda todas las pestañas y reinicia la app para que todos los cambios surtan efecto.
- El botón ❔ abre esta guía dentro de la app. **Info ⓘ** muestra la información de versión.

---

## Recomendaciones rápidas para la mayoría

- Deja **Networking** en `localhost` salvo que necesites conectar otros dispositivos.
- Configura primero **Preferred Display** (Pantalla Preferida) si usas dos pantallas.
- Deja los puertos del servidor con sus valores por defecto, salvo que haya un conflicto.
- Solo define una ruta personalizada de **FFMPEG** si fallan las funciones de medios.

## Screens

### Preferred Display

- Elige en qué monitor se abre la presentación.

### Window Zoom Factor

- Escala la interfaz de todas las ventanas de la app (`1.00` = 100%, `1.25` = 125%). Rango de 0.5 a 3.

---

### Ayudantes para Wayland, GNOME y KDE

En Linux, la pestaña Screens muestra un aviso que describe cómo se colocan las ventanas de presentación en la pantalla elegida:

- **Wayland detected, mode is X11**: la app se ejecuta bajo XWayland y la selección de pantalla funciona con normalidad.
- **Wayland detected** (advertencia): el compositor no permite que la app coloque ventanas. Reinicia la app con `--ozone-platform=x11` o usa uno de los ayudantes descritos abajo.
- **GNOME Window Helper** (Asistente de ventanas de GNOME): en GNOME, una pequeña extensión del shell puede colocar las ventanas en la pantalla elegida sin X11. El panel muestra las versiones instalada y en ejecución, con los botones **Install GNOME Window Helper** y **Remove GNOME Window Helper**. Al instalarlo también se activa la opción "Use Extensions" de GNOME.
- **KDE Plasma**: cuando se detecta Plasma, las ventanas se colocan en la pantalla elegida mediante un script de KWin. No hay nada que instalar.

Consulta [TROUBLESHOOTING.md](TROUBLESHOOTING.md) para problemas de Wayland y X11.

---

### Language

- Cambia el idioma de la interfaz de la app (English o Español).
- La app se reinicia al aplicarlo, para que el idioma se use en todas partes.

### Preferred Presentation Language

- Un código de dos letras (por ejemplo `en` o `es`) que define la versión de idioma predeterminada de las presentaciones.
- Déjalo en blanco para seguir el idioma de la app. Solo lo necesitas si presentas en un idioma distinto al de la interfaz, por ejemplo cuando esta instancia presenta una versión traducida de tus presentaciones. También puedes dejarlo en blanco y configurar pantallas virtuales en otros idiomas.

### Screen Type Variant

- Define el estilo de presentación predeterminado: Normal, Lower Thirds, Confidence Monitor, Notes (Split View), Notes (Slide Preview) o Notes (Teleprompter).
- Si no estás seguro, deja `Normal`.

---

### CCLI License Number

Se configura en la pestaña **Plugins**, dentro de `credit_ccli`. Pone tu número a disposición de las diapositivas que usan bloques `:ccli:` y `:credits:`. Déjalo vacío si no usas contenido CCLI.

### Additional Screens (Virtual Peers)

Úsalo cuando quieras más de una salida al mismo tiempo, por ejemplo un proyector, un enlace en el navegador o una salida en otro idioma. Haz clic en **Add Screen** por cada salida extra. Cada fila tiene:

- **Screen**: `Window only` (una ventana local adicional), `URL Publish` (un enlace de navegador) o una pantalla específica.
- **Language**: reemplaza el idioma de esa salida (por ejemplo, pantalla principal en inglés, pantalla lateral en español).
- **Variant**: reemplaza el diseño (por ejemplo, notas en una pantalla, diapositivas normales en otra).
- **Default Screen**: lo que muestra la salida cuando no hay ninguna presentación abierta: `Use Main Default`, `Solid Black`, `Solid Green` o `Default Presentation`.
- **Default Pres Path**: la presentación que se muestra cuando **Default Screen** es `Default Presentation`.

---

### URL Publish Link

- Muestra el enlace de navegador (`/publish/{key}.html`) que los televisores, tabletas y teléfonos pueden abrir para seguir la presentación, con un botón **Copy URL**.
- Solo se rellena cuando al menos una fila usa `URL Publish`.

### Main Presentation Window Mode

- `Full Screen` cubre toda la pantalla. `Windowed` abre una ventana redimensionable.

### Open Main Presentation Window on Peer Push

- Cuando está desactivado, los comandos de un par nunca abren, navegan ni cierran la ventana principal de presentación. Las pantallas virtuales siguen siendo controladas por los pares.

### Mute Main Presentation Window

- Silencia todo el audio de la ventana principal de presentación.

---

### Presentation Screen Mode

Controla cuándo se abren las pantallas extra configuradas:

- `Always Open`: las abre automáticamente después de iniciar la app.
- `Group Control`: ábrelas manualmente con **Open Screens**.
- `On Demand`: las abre solo mientras se está presentando activamente.

### Main Screen Default y Main Default Presentation Path

- **Main Screen Default** define lo que muestra la salida principal antes de que empiecen las diapositivas: `Solid Black`, `Solid Green` o `Default Presentation`.
- **Main Default Presentation Path** (como `slug/presentation.md`) se usa cuando eso es `Default Presentation`, y como alternativa para cualquier pantalla virtual configurada en `Use Main Default`.

### Check for updates automatically

- Permite que la app busque nuevas versiones por sí sola. Desactívalo si tu entorno bloquea la búsqueda de actualizaciones o prefieres actualizar manualmente.

---

## Networking

Esta pestaña controla si la app permanece solo local o trabaja con otros dispositivos de la red.

> **Importa con quién compartes los enlaces.** Algunos plugins (`slidecontrol`, `markerboard`, `bibletext-live`, `captions` y `videostream`) están pensados para un control compartido y colaborativo. Cuando cualquiera de ellos está habilitado, **cualquiera que tenga un enlace de presentación o de multiplex puede actuar en ese espacio compartido**: avanzar las diapositivas para todos, dibujar en la pizarra, cambiar el versículo en vivo o los subtítulos. Esto es intencional, no una falla, pero significa que no hay visor de solo lectura, ni permisos por persona, ni forma de quitar a un participante. Comparte esos enlaces solo dentro de un grupo pequeño de personas de confianza, y trata el reenvío de un enlace como entregar los controles. Para cortar el acceso debes invalidar el enlace mismo: inicia una nueva sesión o usa **Reset Key** en **Server Access Key** más abajo.

### Networking (`localhost` o `network`)

- `localhost`: la app solo funciona en el mismo equipo.
- `network`: otros dispositivos de tu red pueden conectarse. Es necesario para el emparejamiento en modo maestro y para URL Publish.

---

### Enable HTTPS (experimental)

- Sirve la app por HTTPS usando un certificado autofirmado. Requiere OpenSSL.
- Añade poca seguridad real, pero habilita funciones que necesitan un contexto seguro, como WebRTC. Para un sitio con certificación adecuada, publica mediante el plugin WordPress Publish.

### Local Network Discovery (mDNS)

- **Enable Peering as Follower**: permite que esta app encuentre y siga a otro presentador. Otros presentadores pueden entonces compartir su presentación en tu pantalla. Esto también activa la pestaña **Peer Pairing**.
- **Enable Master Mode**: permite que esta app actúe como el presentador principal con el que se emparejan otros dispositivos. Solo funciona cuando Networking está en `network`.
- **Pairing PIN**: de 4 a 6 dígitos, requeridos cuando un seguidor se empareja. Si Master Mode está activado y no existe un PIN, se crea uno automáticamente. El PIN solo se verifica al emparejar. Cambiarlo no desconecta a los seguidores que ya están emparejados; para revocar uno, usa **Forget** en **Peer Pairing > Paired Followers**.
- **Instance Name**: el nombre que otros dispositivos ven durante el descubrimiento (por ejemplo `Front Stage PC`).

---

Para un comportamiento de red más detallado, consulta [doc/dev/PEERING.md](dev/PEERING.md).

### Server Access Key

- Una clave incluida en la URL del servidor local. **Reset Key** genera una nueva; hazlo si sospechas de acceso no autorizado. Los enlaces antiguos dejan de funcionar. El servidor de API local también usa esta clave para la autenticación.

### Vite Server Port

- El puerto web local que usa la app. Por defecto `8000`; cámbialo solo si otro programa lo usa.

### Local API Server

- **Enable Local API Server** inicia una interfaz HTTP local en `127.0.0.1` para acceso programático a los datos de los plugins. Requiere la clave de acceso del servidor.
- **API Server Port** es `8900` por defecto.
- Consulta [API_REFERENCE.md](API_REFERENCE.md).

---

### Reveal Remote Public Server

- La dirección del relé público que usan las **presentaciones independientes exportadas** (que no tienen servidor local) y, si activas la opción de abajo, esta app. Cámbiala solo si tu equipo ejecuta su propio relé.

### Route Live Features Through the Public Server

- **Desactivado (predeterminado):** el control remoto, el markerboard, los subtítulos en vivo, los versículos bíblicos en vivo y el video compartido se ejecutan en el servidor de este equipo. Ese tráfico permanece en tu red.
- **Activado:** esas funciones se conectan a través del relé público, de modo que los dispositivos que no pueden alcanzar tu red (por ejemplo un teléfono con datos móviles) aún pueden unirse.
- Déjalo desactivado cuando todos estén en la misma red; lo local es más rápido y confiable. Las presentaciones independientes exportadas siempre usan el relé público.
- Surte efecto cuando se reinician los servidores.

---

## Folders & Paths
### Presentations Folder

- Donde se almacenan las presentaciones y los medios compartidos. Usa **Browse** para elegirla.
- Muévela con cuidado y asegúrate de que los archivos existentes estén en la nueva ubicación. Una carpeta en almacenamiento en la nube (Google Drive, Nextcloud, OneDrive) puede sincronizar presentaciones entre equipos. La Media Library también vive aquí y puede crecer mucho.

### Prefer High Bitrate Media

- Prefiere variantes de medios de mayor calidad cuando existen opciones. Úsalo cuando tu hardware y tu red puedan manejarlo.

### Auto-convert AV1 media for older hardware and software

- Convierte los medios AV1 para que los sistemas más antiguos puedan reproducirlos. Déjalo desactivado salvo que veas problemas de reproducción.

### Path to FFMPEG

- Apunta a la herramienta `ffmpeg` usada para las miniaturas de video y otras tareas de medios. Defínelo solo si las funciones de medios fallan porque no se encuentra ffmpeg.

---

### Path to LibreOffice

- Apunta a LibreOffice (`soffice`), usado para convertir archivos de PowerPoint (`.pptx`, `.ppt`, `.ppsx`, `.pps`, `.odp`, Keynote `.key`) a PDF durante la importación.
- Déjalo en blanco para detectarlo automáticamente (ubicaciones de instalación habituales, Snap y Flatpak en Linux, y luego tu `PATH`). La nota bajo el campo muestra dónde se encontró.
- Defínelo solo si LibreOffice está instalado en un lugar poco habitual. Sin él, exporta la presentación a PDF tú mismo e importa el PDF.

Para la configuración de la importación de PDF (usada por el plugin Add Media), consulta [doc/dev/README-PDF.md](dev/README-PDF.md).

## PIP

Picture-in-picture, para herramientas de producción de video que usan flujos de trabajo de croma.

- **Enable PIP mode**: abre las presentaciones en un diseño apto para PIP.
- **PIP Side**: en qué lado se coloca el área de PIP.
- **Chroma key color**: el color de croma. Haz coincidir tu configuración de croma para evitar artefactos.

---

## Hotkeys

Los atajos globales controlan las diapositivas con atajos de teclado mientras hay una ventana de presentación abierta.

Acciones: `pipToggle` (envía `X`), `previous` (`P`), `next` (`Space`), `blank` (`B`), y `up`, `down`, `left`, `right`.

- Haz clic en **Record** junto a una acción y luego presiona tu combinación de teclas. **Clear** la elimina.
- No se permiten atajos duplicados. Presiona `Esc` durante la grabación para cancelar.
- Mantén los atajos simples para que los voluntarios puedan operar con fiabilidad.

---

## Plugins

- Activa o desactiva plugins y edita la configuración de cada plugin.
- Desactivar un plugin elimina sus funciones de la app. Algunas configuraciones de plugins requieren reiniciar la app, lo cual hace **Apply and Relaunch** por ti.
- Para el significado de las opciones de un plugin, consulta su `README.md` (por ejemplo [plugins/addmedia/README.md](../plugins/addmedia/README.md)).

Para los detalles técnicos internos de los plugins, consulta [doc/dev/PLUGINS.md](dev/PLUGINS.md).

---

## Peer Pairing

El emparejamiento conecta esta app con otro presentador en la red. La pestaña tiene dos mitades.

**Lado del seguidor** (requiere **Enable Peering as Follower** en la pestaña Networking; de lo contrario la pestaña lo indica):

- **Discovered Peers**: presentadores encontrados por mDNS con los que aún no te has emparejado. Elige uno e ingresa su PIN de emparejamiento.
- **Manual Pairing...**: empareja por **IP Address** y **Pairing Port** (por defecto `8000`) sin mDNS. **NAT Compatibility (rewrite master URLs)** ayuda cuando se llega al maestro a través de traducción de direcciones.
- **Paired Masters**: presentadores con los que estás emparejado, con un botón para desemparejar.

**Lado del maestro** (se muestra cuando **Enable Master Mode** está activado):

- **Paired Followers**: dispositivos que se emparejaron con este presentador. **Forget** revoca uno; **Forget All** revoca todos. Cambiar el PIN de emparejamiento no hace esto.

Consulta [doc/dev/PEERING.md](dev/PEERING.md) para saber cómo funciona el emparejamiento.
