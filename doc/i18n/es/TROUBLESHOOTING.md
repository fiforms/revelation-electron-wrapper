# Solución de problemas del wrapper

---

## Tabla de contenidos

* [Wayland y X11 en Linux](#troubleshooting-wayland-x11)
* [Habilitar DevTools en runtime](#troubleshooting-runtime-devtools)
* [Problemas de emparejamiento y mDNS](#troubleshooting-peering-mdns)
* [El emparejamiento debe renovarse después de actualizar](#troubleshooting-peering-repair-after-update)
* [Verificaciones rápidas de emparejamiento](#troubleshooting-peering-quick-checks)
* [Emparejamiento manual por IP](#troubleshooting-peering-manual-pairing)
* [Emparejado pero Z no hace nada](#troubleshooting-peering-send-fail)
* [Notas de firewall y red](#troubleshooting-peering-firewall)
* [Restablecer configuración y plugins](#troubleshooting-reset)
* [Abrir el log de depuración](#troubleshooting-debug-log)
* [Desinstalar y eliminar datos locales](#troubleshooting-uninstall)

---

<a id="troubleshooting-wayland-x11"></a>

## Wayland y X11 en Linux

Wayland no permite que las aplicaciones posicionen sus propias ventanas, así que
en una sesión Wayland la ventana de presentación se abre en el monitor que GNOME
elija (normalmente el que está bajo el puntero del ratón), no en tu **Preferred
Display**.

---

### Ayudante de ventanas de GNOME (recomendado en Ubuntu/GNOME)

En GNOME, la app puede instalar una pequeña extensión de GNOME Shell que coloca
las ventanas de presentación, de notas del orador y de pantallas adicionales en
la pantalla elegida, manteniendo el renderizado nativo de Wayland (aceleración
por hardware completa).

1. Abre **Settings → Screens** y haz clic en **Install GNOME Window Helper**.
2. Cierra sesión en GNOME y vuelve a iniciarla. GNOME solo carga las extensiones recién instaladas al iniciar sesión.
3. Settings → Screens ahora muestra *GNOME window helper active*.

La instalación copia la extensión a
`~/.local/share/gnome-shell/extensions/revelation-window-helper@pastordaniel.net/`,
la agrega a las extensiones habilitadas de GNOME y activa el interruptor **Use
Extensions** de GNOME si estaba apagado.

---

Settings → Screens también muestra tres versiones del ayudante: **Running**
(cargada ahora en GNOME Shell), **Installed** (en tu carpeta de extensiones) y
**Bundled with app**. Cuando la app incluya una versión más nueva, haz clic en
**Reinstall GNOME Window Helper** y luego cierra sesión y vuelve a iniciarla.
GNOME sigue ejecutando la copia anterior hasta entonces.

**Remove GNOME Window Helper** desactiva la extensión, la quita de las
extensiones habilitadas de GNOME y borra su carpeta. Deja el interruptor **Use
Extensions** de GNOME como está, porque otras extensiones pueden necesitarlo.

Para comprobarlo desde una terminal:

---

```bash
# Installed version and state (ACTIVE, INACTIVE, ERROR, ...)
gnome-extensions info revelation-window-helper@pastordaniel.net

# Version actually running in GNOME Shell
gdbus call --session --dest org.gnome.Shell --object-path /org/revelation/WindowHelper \
  --method org.revelation.WindowHelper.GetVersion

# Errors from loading the extension
journalctl --user -b | grep -i revelation
```

La extensión declara compatibilidad con GNOME Shell 45–50. Después de una
actualización importante de GNOME puede quedar deshabilitada hasta que una
actualización de la app agregue la nueva versión. Mientras tanto, usa la opción
X11 que se describe abajo.

---

### KDE Plasma

En KDE Plasma bajo Wayland no hay nada que instalar. Para cada ventana, la app
carga por D-Bus un script de KWin de corta duración que mueve la ventana a la
pantalla elegida y luego se descarga solo. Settings → Screens muestra *KDE
Plasma detected* cuando el scripting de KWin es accesible.

Probado en Plasma 6 (Fedora KDE). Plasma 5.27 (por ejemplo Kubuntu 24.04 en su
sesión Wayland) es compatible con el mismo script, pero aún no se ha probado.

Si las ventanas siguen abriéndose en la pantalla equivocada, revisa el log de la
app en busca de líneas `KWin window helper`, y el log propio de KWin en busca de
errores del script:

```bash
journalctl --user -b | grep -i -E 'kwin|revelation'
```

---

### Forzar X11

Si no usas GNOME ni KDE Plasma, o el ayudante no está disponible, puedes forzar
X11. Esto restablece la colocación de ventanas, pero pierde parte de la
aceleración por hardware, por lo que el video y la composición pueden ser menos
fluidos, especialmente en 4K. En algunas configuraciones Ubuntu/Wayland, el
renderizado de Electron también funciona con mayor estabilidad al forzar X11:

```bash
revelation-electron --ozone-platform=x11
```

---

### Errores de GPU en X11 (video de fondo ausente, caída del proceso de GPU)

Si ves errores de GPU como `gbm_bo_import` devolviendo nullptr o `GPU process exited unexpectedly` en la consola, el controlador de GPU está fallando al compartir búferes con Chromium bajo XWayland. Esto también hace que desaparezcan los videos de fondo en las presentaciones.

Pasa una de las siguientes banderas adicionales, de la menos a la más agresiva:

```bash
# Option 1: Disable GPU sandbox only (least invasive)
revelation-electron --ozone-platform=x11 --disable-gpu-sandbox

# Option 2: Software GL renderer — bypasses GBM entirely (recommended)
revelation-electron --ozone-platform=x11 --use-gl=swiftshader

# Option 3: Disable GPU compositing
revelation-electron --ozone-platform=x11 --disable-gpu-compositing

# Option 4: Disable GPU entirely (most stable, no hardware acceleration)
revelation-electron --ozone-platform=x11 --disable-gpu
```

`--use-gl=swiftshader` (opción 2) es el punto de partida recomendado: usa renderizado por software basado en CPU para evitar la caída de GBM manteniendo funcional la composición, lo que permite que los videos de fondo se muestren correctamente.

---

Si inicias desde el escritorio, puedes usar una entrada `.desktop` como esta:

```ini
[Desktop Entry]
Name=REVELation Snapshot Presenter
Exec=revelation-electron --ozone-platform=x11 --use-gl=swiftshader
Terminal=false
Type=Application
Categories=Utility;
```

---

<a id="troubleshooting-runtime-devtools"></a>

## Habilitar el modo de depuración

De forma predeterminada la app no imprime nada en la consola, no escribe `debug.log` y oculta el menú **Help → Debug**. Para activarlos, inicia la app con:

```bash
revelation-electron --enable-debug
```

o en entorno de desarrollo:

```bash
npm start -- --enable-debug
```

---

## Habilitar DevTools en runtime

Si necesitas depurar el comportamiento de la UI en cualquier ventana de la app, inicia la app con:

```bash
revelation-electron --enable-devtools
```

o en entorno de desarrollo:

```bash
npm start -- --enable-devtools
```

Con esta bandera habilitada, presionar `F12` en cualquier `BrowserWindow` abre DevTools en una ventana separada (detached).

---

<a id="troubleshooting-peering-mdns"></a>

## Problemas de emparejamiento y mDNS

Si el control de pares (peer) no funciona, estas son las causas más comunes:

- Descubrimiento mDNS bloqueado por firewall/política de red.
- El maestro no está publicando realmente (`Networking` no está en modo `network`).
- El seguidor no tiene permitido explorar pares (`mDNS Browse` deshabilitado).
- Host/puerto o PIN de emparejamiento incorrecto al emparejar manualmente.
- Enlace de comandos peer aún no establecido (parece que al presionar `Z` no pasa nada).
- El emparejamiento se hizo antes de una actualización de seguridad y ahora necesita renovarse (ver abajo).
- El maestro olvidó a este seguidor (ver abajo).

---

<a id="troubleshooting-peering-repair-after-update"></a>

### "Pairing must be renewed" después de actualizar

La versión 1.0.12 cambió la forma en que se autentican los pares. El emparejamiento
ahora tiene su propia clave de firma, separada de la que se usa para publicar en
WordPress. El PIN de emparejamiento ahora se usa solo una vez, al emparejar, y
después el seguidor demuestra quién es con su propia clave. **Los emparejamientos
hechos antes de la actualización dejan de funcionar y deben renovarse una vez.**

Verás uno de estos mensajes:

- En la lista `Paired Masters` del seguidor: `Paired with an older version. Pair
  again to reconnect.`
- Al emparejar: `Master … is running an older, incompatible peering protocol.
  Update the app on the master and try again.`

---

Para solucionarlo:

1. **Actualiza ambas máquinas.** Un seguidor con la versión nueva no puede
   emparejarse con un maestro con una versión anterior; se niega a propósito en
   lugar de recurrir a un método anterior.
2. En el seguidor, abre `Peer Presenter Pairing...`, busca el maestro en
   `Paired Masters` y elige `Pair Again`.
3. Ingresa el PIN actual del maestro.

No hay que cambiar nada más. El PIN, los puertos y la configuración de mDNS no
se ven afectados, y los emparejamientos de WordPress existentes siguen funcionando.

---

<a id="troubleshooting-peering-forgotten"></a>

### "This master no longer recognizes this device"

Se le indicó al maestro que olvidara a este seguidor (`Settings → Peer Pairing →
Paired Followers → Forget` en el maestro), o se perdió la lista de seguidores del
maestro. El seguidor deja de intentar conectarse en lugar de reintentar, para que
el maestro no se inunde de intentos fallidos.

Para reconectar, elige `Pair Again` en el seguidor e ingresa el PIN del maestro.

Cambiar el PIN en el maestro **no** causa esto. Los seguidores que ya están
emparejados siguen funcionando después de un cambio de PIN. Solo los nuevos
emparejamientos necesitan el nuevo PIN.

---

<a id="troubleshooting-peering-quick-checks"></a>

### Verificaciones rápidas primero

En la máquina que debe actuar como maestra:

1. Abre `Settings...`.
2. Configura `Networking` en `network`.
3. Habilita `Enable Master Mode (mDNS Publish and Peering Endpoints)`.
4. Verifica `Vite Server Port` (comúnmente `8000`).
5. Confirma el `Pairing PIN`.

En la máquina que debe actuar como seguidora:

1. Abre `Settings...`.
2. Habilita `Enable Peering as Follower (mDNS Browse)`.
3. Confirma que puede alcanzar la máquina maestra en la misma LAN/subred.

Luego abre `Peer Presenter Pairing...` y verifica que el maestro aparezca en `Discovered Peers`.

---

<a id="troubleshooting-peering-manual-pairing"></a>

### Cuando el descubrimiento mDNS está roto

Algunos entornos bloquean el descubrimiento multicast/broadcast (Wi-Fi de invitados, VLAN, firewalls estrictos, redes corporativas gestionadas).  
Si el descubrimiento no funciona, usa el emparejamiento manual por IP:

1. Abre `Peer Presenter Pairing...` en el seguidor.
2. Haz clic en `Manual Pairing...`.
3. En `Pair by IP Address`, ingresa la IP del maestro (ejemplo `192.168.1.50`).
4. Ingresa `Pairing Port` (normalmente el `Vite Server Port` del maestro, comúnmente `8000`).
5. Haz clic en `Pair` e ingresa el `Pairing PIN` del maestro.

Si esto funciona, mDNS puede seguir siendo inestable; el emparejamiento manual sigue funcionando como alternativa.

---

<a id="troubleshooting-peering-send-fail"></a>

### Si el emparejamiento funciona pero enviar-a-par no

Si los pares están emparejados pero presionar `Z` no hace nada:

1. Inicia primero una presentación en el maestro.
2. Asegúrate de que Reveal Remote esté disponible/inicializado en esa sesión.
3. Presiona `Z` de nuevo, o usa el menú contextual de la presentación `Send Presentation to Peers (z)`.
4. Revisa `Peer Presenter Pairing...` para ver los maestros actualmente emparejados y las pistas de host/puerto.

También verifica que ambas máquinas sigan en la misma red accesible y que no haya cambiado una regla de firewall a mitad de sesión.

---

<a id="troubleshooting-peering-firewall"></a>

### Notas de firewall y red

- mDNS usa DNS multicast en redes locales y comúnmente está bloqueado por políticas de firewall.
- El emparejamiento y los comandos peer requieren conectividad TCP al `Vite Server Port` del maestro (a menudo `8000`).
- Si usas redes enrutadas/VLAN, espera que falle el descubrimiento y prefiere el emparejamiento manual por IP.

---

### Dónde continuar

- Detalles completos de protocolo y arquitectura: [doc/dev/PEERING.md](dev/PEERING.md)
- Flujo de pares para variantes multi-idioma: [revelation/doc/VARIANTS_REFERENCE.md](../revelation/doc/VARIANTS_REFERENCE.md)

---

<a id="troubleshooting-reset"></a>

## Restablecer configuración y plugins

Usa la acción de restablecimiento integrada:

1. Abre la app.
2. Ve a `Revelation` (o al menú de la app en macOS).
3. Haz clic en `Reset All Settings and Plugins...`.
4. Confirma el restablecimiento.

Esto restablece la configuración local de la app y elimina los recursos locales sobrescritos de plugins/framework para que la app vuelva a los valores predeterminados.

---

<a id="troubleshooting-debug-log"></a>

## Abrir el log de depuración

Desde el menú de la app:

1. Abre `Help`.
2. Abre `Debug`.
3. Haz clic en `Open Log`.

---

El archivo de log se guarda en la carpeta user-data de la app como `debug.log`.

Ubicaciones predeterminadas comunes de user-data:

- Windows: `%APPDATA%/revelation-electron/`
- macOS: `~/Library/Application Support/revelation-electron/`
- Linux: `~/.config/revelation-electron/`

---

<a id="troubleshooting-uninstall"></a>

## Desinstalar y eliminar datos locales

Si deseas una eliminación completamente limpia, haz ambas cosas:

1. Desinstalar la app.
2. Eliminar los datos locales y cachés.

---

### 1) Desinstalar la app

Ubicaciones típicas de instalación (varían según el instalador/gestor de paquetes):

- Windows (NSIS): desinstalar desde Apps/Programas, generalmente instalado en `C:\Program Files\REVELation Snapshot Presenter\`
- macOS: eliminar la app de `/Applications`
- Linux (`.deb`/`.rpm`): eliminar el paquete con tu gestor de paquetes

---

### 2) Eliminar datos locales y cachés

Elimina la carpeta user-data de la app:

- Windows: `%APPDATA%/revelation-electron/`
- macOS: `~/Library/Application Support/revelation-electron/`
- Linux: `~/.config/revelation-electron/`

---

Opcional: si también deseas eliminar tu biblioteca de presentaciones creada por defecto, borra:

- `~/Documents/REVELation Presentations/`

Solo elimina esa carpeta si ya no necesitas tus presentaciones y medios locales.
