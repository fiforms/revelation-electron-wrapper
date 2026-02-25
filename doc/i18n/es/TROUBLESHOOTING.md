# Solución de problemas del wrapper

---

## Tabla de contenidos

* [Wayland y X11 en Linux](#troubleshooting-wayland-x11)
* [Habilitar DevTools en runtime](#troubleshooting-runtime-devtools)
* [Problemas de peering y mDNS](#troubleshooting-peering-mdns)
* [Verificaciones rápidas de peering](#troubleshooting-peering-quick-checks)
* [Emparejamiento manual por IP](#troubleshooting-peering-manual-pairing)
* [Emparejado pero Z no hace nada](#troubleshooting-peering-send-fail)
* [Notas de firewall y red](#troubleshooting-peering-firewall)
* [Restablecer configuración y plugins](#troubleshooting-reset)
* [Abrir el log de depuración](#troubleshooting-debug-log)
* [Desinstalar y eliminar datos locales](#troubleshooting-uninstall)

---

<a id="troubleshooting-wayland-x11"></a>

## Wayland y X11 en Linux

En algunas configuraciones Ubuntu/Wayland, el renderizado de Electron funciona con mayor estabilidad al forzar X11:

```bash
revelation-electron --ozone-platform=x11
```

---

Si inicia desde el escritorio, puede usar una entrada `.desktop` como esta:

```ini
[Desktop Entry]
Name=REVELation Snapshot Presenter
Exec=revelation-electron --ozone-platform=x11
Terminal=false
Type=Application
Categories=Utility;
```

---

<a id="troubleshooting-runtime-devtools"></a>

## Habilitar DevTools en runtime

Si necesita depurar comportamiento de UI en cualquier ventana de la app, inicie la app con:

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

## Problemas de peering y mDNS

Si el control peer no funciona, estas son las causas más comunes:

- Descubrimiento mDNS bloqueado por firewall/política de red.
- El maestro no está publicando realmente (`Networking` no está en modo `network`).
- El seguidor no tiene permitido explorar peers (`mDNS Browse` deshabilitado).
- Host/puerto o PIN de emparejamiento incorrecto al emparejar manualmente.
- Enlace de comando peer aún no establecido (parece que al presionar `Z` no pasa nada).

---

<a id="troubleshooting-peering-quick-checks"></a>

### Verificaciones rápidas primero

En la máquina que debe actuar como maestra:

1. Abra `Settings...`.
2. Configure `Networking` en `network`.
3. Habilite `Enable Master Mode (mDNS Publish and Peering Endpoints)`.
4. Verifique `Vite Server Port` (comúnmente `8000`).
5. Confirme el `Pairing PIN`.

En la máquina que debe actuar como seguidora:

1. Abra `Settings...`.
2. Habilite `Enable Peering as Follower (mDNS Browse)`.
3. Confirme que puede alcanzar la máquina maestra en la misma LAN/subred.

Luego abra `Peer Presenter Pairing...` y verifique que el maestro aparezca en `Discovered Peers`.

---

<a id="troubleshooting-peering-manual-pairing"></a>

### Cuando el descubrimiento mDNS está roto

Algunos entornos bloquean descubrimiento multicast/broadcast (Wi-Fi de invitados, VLAN, firewalls estrictos, redes corporativas gestionadas).  
Si el descubrimiento no funciona, use emparejamiento manual por IP:

1. Abra `Peer Presenter Pairing...` en el seguidor.
2. Haga clic en `Manual Pairing...`.
3. En `Pair by IP Address`, ingrese la IP del maestro (ejemplo `192.168.1.50`).
4. Ingrese `Pairing Port` (normalmente `Vite Server Port` del maestro, comúnmente `8000`).
5. Haga clic en `Pair` e ingrese el `Pairing PIN` del maestro.

Si esto funciona, mDNS puede seguir siendo inestable; el emparejamiento manual sigue funcionando como alternativa.

---

<a id="troubleshooting-peering-send-fail"></a>

### Si el emparejamiento funciona pero enviar-a-peer no

Si los peers están emparejados pero presionar `Z` no hace nada:

1. Inicie primero una presentación en el maestro.
2. Asegúrese de que Reveal Remote esté disponible/inicializado en esa sesión.
3. Presione `Z` de nuevo, o use menú contextual de presentación `Send Presentation to Peers (z)`.
4. Revise `Peer Presenter Pairing...` para maestros actualmente emparejados y pistas de host/puerto.

También verifique que ambas máquinas sigan en la misma red accesible y que no haya cambiado una regla de firewall a mitad de sesión.

---

<a id="troubleshooting-peering-firewall"></a>

### Notas de firewall y red

- mDNS usa DNS multicast en redes locales y comúnmente está bloqueado por políticas de firewall.
- Emparejamiento/comandos peer requieren conectividad TCP al `Vite Server Port` del maestro (a menudo `8000`).
- Si usa redes enrutadas/VLAN, espere que falle el descubrimiento y prefiera emparejamiento manual por IP.

---

### Dónde continuar

- Detalles completos de protocolo y arquitectura: [doc/dev/PEERING.md](dev/PEERING.md)
- Flujo peer para variantes multi-idioma: [revelation/doc/VARIANTS_REFERENCE.md](../revelation/doc/VARIANTS_REFERENCE.md)

---

<a id="troubleshooting-reset"></a>

## Restablecer configuración y plugins

Use la acción de restablecimiento integrada:

1. Abra la app.
2. Vaya a `Revelation` (o menú de app en macOS).
3. Haga clic en `Reset All Settings and Plugins...`.
4. Confirme el restablecimiento.

Esto restablece la configuración local de la app y elimina recursos locales override de plugins/framework para volver a valores predeterminados.

---

<a id="troubleshooting-debug-log"></a>

## Abrir el log de depuración

Desde el menú de la app:

1. Abra `Help`.
2. Abra `Debug`.
3. Haga clic en `Open Log`.

---

El archivo de log se guarda en la carpeta user-data de la app como `debug.log`.

Ubicaciones predeterminadas comunes de user-data:

- Windows: `%APPDATA%/revelation-electron/`
- macOS: `~/Library/Application Support/revelation-electron/`
- Linux: `~/.config/revelation-electron/`

---

<a id="troubleshooting-uninstall"></a>

## Desinstalar y eliminar datos locales

Si desea una eliminación completamente limpia, haga ambas cosas:

1. Desinstalar la app.
2. Eliminar datos locales y cachés.

---

### 1) Desinstalar app

Ubicaciones típicas de instalación (varían según instalador/gestor de paquetes):

- Windows (NSIS): desinstalar desde Apps/Programas, generalmente instalado en `C:\Program Files\REVELation Snapshot Presenter\`
- macOS: eliminar app de `/Applications`
- Linux (`.deb`/`.rpm`): eliminar paquete con su gestor de paquetes

---

### 2) Eliminar datos locales y cachés

Eliminar la carpeta user-data de la app:

- Windows: `%APPDATA%/revelation-electron/`
- macOS: `~/Library/Application Support/revelation-electron/`
- Linux: `~/.config/revelation-electron/`

---

Opcional: si también desea eliminar su biblioteca de presentaciones creada por defecto, borre:

- `~/Documents/REVELation Presentations/`

Solo elimine esa carpeta si ya no necesita sus presentaciones y medios locales.
