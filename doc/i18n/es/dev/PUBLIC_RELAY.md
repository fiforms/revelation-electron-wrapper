# Ejecutar un relay público

Cómo alojar el relay de sockets de REVELation en un servidor público, y por qué es
un modo separado y no una configuración de firewall.

---

## Para qué sirve un relay

Reveal Remote y el canal de plugins del presentador normalmente se ejecutan en la
máquina del propio presentador, y todo permanece en la LAN. Ese es el valor
predeterminado y casi siempre la mejor opción.

Un relay existe para el caso en que un participante no puede alcanzar esa LAN:

- un teléfono que actúa como control remoto por red celular en lugar del Wi-Fi del lugar
- un espectador que sigue una presentación desde otro sitio
- una presentación independiente exportada, que no tiene ningún servidor local

`revealremote.fiforms.org` es un relay de este tipo. Este documento trata sobre cómo
ejecutar uno.

En la aplicación, los usuarios lo activan por instalación en **Settings → Networking → Route Live
Features Through the Public Server**. Las presentaciones independientes exportadas siempre
usan el relay, porque no tienen nada local con qué comunicarse.

---

## Por qué un modo dedicado

El servidor Vite aloja mucho más que los sockets: el árbol de presentaciones, el
árbol de plugins, un servicio de miniaturas que lanza `ffmpeg`, una interfaz de administración, los endpoints
de emparejamiento peer y la raíz estática propia de Vite, incluido `/@fs`. Varios de
ellos están protegidos solo por una verificación de loopback —
`isLoopbackAddress(req.socket.remoteAddress)`.

**Un proxy inverso en la misma máquina anula todos ellos.** Las solicitudes reenviadas
llegan desde `127.0.0.1`, así que la verificación pasa para quien esté al otro lado
del proxy — que, en un relay público, es internet. Cualquiera podría leer
`index.json`, abrir `/admin` o leer `/peer/status`.

La solución no es una lista más larga de reglas `deny` en el proxy. Las listas de bloqueo se pudren: una ruta
agregada después queda expuesta por defecto, y una sola regla faltante es una brecha. El modo
de relay público, en cambio, **nunca registra** las funciones de la máquina local, así que
no hay nada detrás de las verificaciones a lo que llegar.

---

## Iniciar un relay

```bash
cd revelation
npm ci
npm run relay          # REVELATION_PUBLIC_SERVER=1 vite --host
```

Equivalentes:

```bash
REVELATION_PUBLIC_SERVER=1 npx vite --host --port 8000
npx vite --host --public-server
```

Prefiere la variable de entorno. No puede colisionar con el análisis de opciones de la CLI
de Vite, y sobrevive a que un administrador de procesos la envuelva.

Confirma el banner al iniciar:

---

```
🔒 PUBLIC RELAY MODE
   serving: /socket.io, /presenter-plugins-socket, /_remote/ui/
   disabled: presentations, plugins, thumbnails, media, admin, peer endpoints, file watching, Vite static root
```

Si esa línea no aparece, el modo **no** está activo — no expongas el puerto.
La causa más común es iniciar Vite desde el directorio de trabajo equivocado, de modo que
`vite.config.js` (y por lo tanto el plugin) nunca se carga.

---

## Qué sirve el relay

| Ruta | Propósito |
|---|---|
| `/socket.io` | Broker de Reveal Remote: presentador, control remoto, seguidor multiplex |
| `/presenter-plugins-socket` | Canal de plugins del presentador (slidecontrol, markerboard, captions, videostream, bibletext-live) |
| `/_remote/ui/**` | Interfaz web de control remoto estática, autocontenida |
| `/` | Una cadena de una línea que indica que está activo. Sin hostname, sin versión |

Todo lo demás devuelve un `404` plano sin indicar si la ruta
existe.

---

Explícitamente **no** se montan:

- `/presentations_<key>/`, `/plugins_<key>/`, `/thumbs_<key>/`
- `/media-share/<token>`, `/publish/`, `/admin/`
- `/peer/*` y el servidor Socket.IO `/peer-commands`
- `**/index.json`
- La raíz estática de Vite, `/@fs`, `/@id`, `/@vite/client`
- El observador de archivos chokidar y la generación de índices de presentaciones/medios

Por lo tanto, un relay no necesita directorio de presentaciones, ni `config.json`, ni
carpeta de plugins, ni `ffmpeg`. La ruta de presentaciones nunca se resuelve, así que
el error habitual de inicio "No presentations folder found" no puede ocurrir.

---

## Notas de despliegue

**Pon TLS delante.** El relay habla HTTP plano; termina TLS en un
proxy o balanceador de carga. Los navegadores exigen un contexto seguro para varias funciones de la
presentación, y un origen `wss://` para la conexión de socket.

**Reenvía las actualizaciones de WebSocket.** Socket.IO recurrirá al long-polling HTTP
si se descartan las actualizaciones, lo cual funciona pero es lento y verboso. En nginx:

---

```nginx
location / {
    proxy_pass         http://127.0.0.1:8000;
    proxy_http_version 1.1;
    proxy_set_header   Upgrade $http_upgrade;
    proxy_set_header   Connection "upgrade";
    proxy_set_header   Host $host;
    proxy_read_timeout 7d;      # sockets idle between slide changes
}
```

No se necesitan reglas `deny`. Ese es el objetivo del modo.

**Ejecútalo como un usuario sin privilegios** y sin acceso al contenido de las presentaciones. El
relay nunca lee ninguno.

---

**Las salas no tienen autenticación por diseño.** Cualquiera que tenga el id de una sala es un participante
completo — consulta la excepción de colaboración en
`revelation/doc/SECURITY.md`. Un relay es infraestructura
compartida: cada instalación que apunta a él usa los mismos servidores Socket.IO,
separadas solo por el id de sala. Los ids de Reveal Remote son UUIDv4 y
`presenterLiveRoomId` tiene 128 bits aleatorios, así que las colisiones y las adivinanzas no son una
preocupación práctica, pero el operador de un relay puede leer todo el tráfico que pasa por él.
Ejecuta el tuyo si eso te importa.

**No esperes persistencia.** Todo el estado de las salas está en memoria y se descarta cuando el
presentador se desconecta. Reiniciar el relay termina todas las sesiones activas.

---

## Verificar un despliegue

```bash
curl -s https://relay.example.org/                       # one-line liveness string
curl -s -o /dev/null -w '%{http_code}\n' \
     https://relay.example.org/admin/                    # expect 404
curl -s -o /dev/null -w '%{http_code}\n' \
     https://relay.example.org/package.json              # expect 404
curl -s -o /dev/null -w '%{http_code}\n' \
     https://relay.example.org/@fs/etc/passwd            # expect 404
curl -s 'https://relay.example.org/socket.io/?EIO=4&transport=polling' | head -c 80
                                                         # expect a JSON handshake with "sid"
```

Si alguna de las verificaciones de 404 devuelve contenido, el modo relay no está activo. Desconecta el
servidor de la red antes de investigar.
