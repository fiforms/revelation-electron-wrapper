# Plugin Screen Stream

Captura una pantalla y la envía con ffmpeg mediante [RIST](https://www.rist.tv/) (Reliable Internet Stream Transport) a una dirección IP y un puerto. Úsalo para alimentar una pantalla en vivo a un mezclador de video, a un PC de transmisión o a cualquier receptor RIST (OBS, vMix, `ffplay`, `ffmpeg`).

## Uso

1. Activa **Screen Stream** en Configuración → Plugins, ajusta las opciones de abajo y reinicia si se solicita.
2. Abre **Plugins → Stream Screen (RIST)…** (o la entrada **Plugins** de la barra lateral).
3. Elige la pantalla y pulsa **Start Streaming**. **Stop Streaming** la detiene. Al cerrar la aplicación también se detiene.

Para probar, ejecuta un receptor en el equipo de destino, por ejemplo `ffplay "rist://@0.0.0.0:5000"`.

## Sonido

De forma predeterminada la transmisión es silenciosa. Para añadir sonido, elige una fuente en la lista **Audio** de la ventana antes de empezar. Funciona con **Start Streaming (RIST)** y con **Stream Screen to Peers**. El sonido se codifica en AAC (128 kbit/s por defecto); el video no se toca, así que el passthrough de Wayland sigue copiando el H.264 sin recodificar.

| Plataforma | Qué ofrece la lista |
|---|---|
| Linux (PulseAudio o PipeWire) | **System sound (default output)**, es decir, lo que suenan los altavoces, más todas las demás fuentes. |
| Windows | Las entradas de sonido que lista DirectShow. Windows no tiene por defecto una entrada de sonido del escritorio: activa **Mezcla estéreo** en la configuración de sonido, o instala un capturador de audio virtual, y aparecerá. No se ofrecen los dispositivos cuyo nombre contiene `:` o `=`. |
| macOS | Los dispositivos de audio que lista avfoundation. macOS no puede capturar el sonido del escritorio por sí mismo: instala un dispositivo virtual como BlackHole, envíale la salida del sistema y elígelo. |

Notas:
- Modo peers: los seguidores reproducen el sonido en su ventana de reproductor. El emisor indica a los seguidores si la transmisión incluye sonido, así que una transmisión silenciosa se comporta como antes.
- **Sincronía labial en Wayland.** Allí el video de la pantalla viene del navegador y el sonido de ffmpeg, como dos capturas separadas, por lo que no pueden fijarse exactamente. El plugin inicia ffmpeg solo cuando llega el primer video, lo que hace que el desfase sea pequeño y repetible. En pruebas con video simulado quedó en unos 200 ms, con el sonido algo adelantado. Usa el campo **Audio delay (ms)** que aparece en la ventana al elegir una fuente de sonido (parte del ajuste `audioOffsetMs` y se recuerda): si oyes las cosas antes de verlas, auméntalo; si después, redúcelo, en pasos de unos 100 y reiniciando la transmisión cada vez. Las pantallas capturadas directamente por ffmpeg, y macOS, se capturan juntas y no necesitan ajuste (macOS además ignora `audioOffsetMs`).
- **Pantalla negra en un receptor al activar el sonido.** Un receptor no puede mostrar video hasta haber visto un fotograma clave y leído los parámetros del video. Si el intervalo de fotogramas clave es mayor que el tiempo de análisis del receptor, uno que no exija la pista de video puede quedarse solo con el sonido. Mantén `browserGopSeconds` corto y sube `peerProbeMs` por encima del intervalo real si aún ocurre. Los receptores deberían asignar el video como obligatorio (ver PEERING.md, «El video es obligatorio»).
- Electron puede capturar por sí mismo el sonido del escritorio en Windows, pero este plugin todavía no lo usa.

## Stream Screen to Peers

El segundo botón, **Stream Screen to Peers**, envía la pantalla a todos los seguidores REVELation emparejados de la red local en lugar de a una dirección fija. No necesita destino.

1. En el equipo emisor, activa el modo de red y publica esta instancia (Configuración), y empareja los seguidores como de costumbre (ver [PEERING.md](../../../../doc/i18n/es/dev/PEERING.md)).
2. En cada seguidor, activa el plugin **Screen Stream**.
3. Pulsa **Stream Screen to Peers**. El emisor escucha conexiones RIST y envía un solo comando `rist-screen` por el canal peer. Cada seguidor abre una ventana de reproductor a pantalla completa (en su pantalla de presentación habitual) y reproduce la transmisión. **Stop Streaming** envía una parada que cierra el reproductor en todos los seguidores, la haya iniciado el maestro que sea. Cerrar la ventana del reproductor en un seguidor termina la transmisión allí.

Notas:
- Cada seguidor ejecuta su propio ffmpeg para recibir la transmisión y **no** la recodifica. Emisor y seguidores necesitan un ffmpeg con librist. Solo se admite H.264.
- El comando se envía una sola vez, como al enviar una presentación: un seguidor que se conecta o se reinicia a mitad de la transmisión se une en el siguiente inicio. Si el emisor se cierra sin detener, los seguidores conservan su ventana de reproductor (reintentando) hasta que se cierre.
- El emisor debe permitir UDP entrante en `peerPort` y el puerto siguiente a través de su cortafuegos.
- Cada transmisión nueva se cifra con una frase de contraseña aleatoria (AES-128 por defecto) que se envía a los seguidores por el canal peer. Ese canal no está cifrado salvo que HTTPS esté activado, así que esto impide la captura casual del video, no a un atacante que también pueda leer el tráfico peer.
- **Retardo antes de que un seguidor muestre imagen.** Un seguidor necesita un fotograma clave para mostrar algo, y ffmpeg analiza antes la transmisión durante un tiempo fijo. Las transmisiones que codifica ffmpeg (todas las plataformas salvo el passthrough de Wayland) usan un intervalo de fotogramas clave de 2 segundos y una ventana de análisis de 3 segundos, así que la imagen aparece en unos 3 segundos. En el passthrough de Wayland, Chromium elige el intervalo de fotogramas clave, por lo que `peerProbeMs` (8000 por defecto) debe ser mayor: si es demasiado bajo, los seguidores no muestran nada. Una vez que se muestra, el retardo suele ser bastante inferior a un segundo.
- Un seguidor ignora la transmisión si ha desactivado «abrir la ventana de presentación cuando un peer envía una presentación», y no reproduce transmisiones mientras está capturando él mismo.

## Configuración

| Opción | Predeterminado | Significado |
|---|---|---|
| `host` | _(vacío)_ | Dirección IP o nombre del destino (IPv4, IPv6 o nombre). |
| `port` | 5000 | Puerto RIST de destino. RIST también usa el puerto siguiente para solicitudes de retransmisión; usa un número par con el perfil Simple. |
| `captureMethod` | `auto` | `auto`, `ffmpeg` o `browser` (ver abajo). |
| `fps` | 30 | Fotogramas por segundo. |
| `bitrateKbps` | 6000 | Tasa de bits predeterminada del video. La ventana tiene un campo **Video bitrate (kbit/s)**, rellenado con este valor y recordado entre ejecuciones, para cambiarla en cada transmisión; se aplica a ambos botones y surte efecto en el siguiente inicio. En el passthrough de Wayland es el tope del grabador, así que una pantalla estática usa menos. |
| `scaleHeight` | 0 | Escala a esta altura en píxeles; 0 mantiene el tamaño de la pantalla. |
| `latencyMs` | 1000 | Búfer de retransmisión RIST; debe coincidir con el receptor. 0 usa el valor predeterminado de ffmpeg. |
| `videoEncoder` | `libx264` | Cualquier codificador H.264 de tu ffmpeg (`h264_nvenc`, `h264_qsv`, `h264_videotoolbox`…). |
| `captureCursor` | activado | Incluye el puntero del ratón. |
| `encryption` | `none` | Cifrado RIST: `none`, `128` o `256` (AES, bits). El receptor debe usar el mismo tipo y la misma frase de contraseña. |
| `secret` | _(vacío)_ | La frase de contraseña del cifrado. Obligatoria si el cifrado está activado. |
| `peerPort` | 5100 | Stream to Peers: el puerto en el que escucha el emisor. |
| `peerEncryption` | `128` | Stream to Peers: `none`, `128` o `256`. Se genera una frase aleatoria para cada transmisión. |
| `peerProbeMs` | 8000 | Stream to Peers, solo passthrough de Wayland: cuánto analizan la transmisión los seguidores. Debe superar el intervalo de fotogramas clave. |
| `audioBitrateKbps` | 128 | Tasa de bits del AAC cuando se elige una fuente de sonido. |
| `audioOffsetMs` | 0 | Desfase predeterminado de la sincronía labial: retrasa el sonido estos milisegundos (un valor negativo lo adelanta). La ventana tiene su propio campo **Audio delay (ms)**, rellenado con este valor, para cambiarlo en cada transmisión. |
| `browserGopSeconds` | 2 | Passthrough de Wayland: pide al grabador de pantalla un fotograma clave al menos con esta frecuencia, en segundos (0 lo deja a Chromium, que puede elegir 10 s o más). Los receptores no muestran nada hasta que llega un fotograma clave, así que cuanto más corto, mejor para la conexión. |
| `browserPassthrough` | activado | Solo Wayland: el grabador de pantalla produce H.264 a `bitrateKbps` y ffmpeg lo envía sin cambios (menos CPU y retardo). `fps`, `scaleHeight` y `videoEncoder` no se aplican entonces. Desactivado, se recodifica con ffmpeg. Si no se puede grabar H.264, se recodifica. |

La transmisión es H.264 en MPEG-TS (más sonido AAC si eliges una fuente de audio), cifrada solo si activas `encryption` (AES de RIST con una frase de contraseña compartida; protege la transmisión, no autentica al receptor). La frase se pasa a ffmpeg como opción de línea de comandos, por lo que otros usuarios del mismo equipo pueden verla en la lista de procesos mientras se transmite. Con el cifrado desactivado, envía solo por redes de confianza. Una URL de destino como `rist://host:5000?secret=pw&aes-type=128&buffer=300` equivale a `host`, `port`, `secret` = pw, `encryption` = 128 y `latencyMs` = 300.

## Cómo captura

| Plataforma | `auto` usa | Notas |
|---|---|---|
| Windows | ffmpeg `gdigrab` | Captura el rectángulo de la pantalla elegida. |
| macOS | ffmpeg `avfoundation` | Requiere el permiso de Grabación de pantalla para la aplicación (Ajustes del Sistema → Privacidad y seguridad). La lista de pantallas se asocia en orden con los dispositivos «Capture screen N» de avfoundation, empezando por la principal. |
| Linux, X11 | ffmpeg `x11grab` | Captura el rectángulo de la pantalla elegida. |
| Linux, Wayland | el aviso de compartir pantalla del sistema | ffmpeg no tiene un capturador de Wayland sin privilegios. La aplicación captura mediante el portal del escritorio (PipeWire), lo envía a ffmpeg. De forma predeterminada el grabador produce H.264 y ffmpeg lo envía sin cambios (ver `browserPassthrough`); si no, ffmpeg recodifica. El selector del portal elige la pantalla, y recodificar (passthrough desactivado) añade latencia. |

## Requisitos

- ffmpeg se localiza de la forma habitual (ruta en Configuración, copia incluida o `PATH`).
- Esa compilación de ffmpeg debe incluir **librist**. La ventana muestra una advertencia si no es así. Comprueba con `ffmpeg -protocols | grep rist`.

## Archivos

- `plugin.js`: el proceso ffmpeg, la comprobación de capacidades, la ventana de control y las dos mitades, de emisor y de seguidor, del comando peer `rist-screen`.
- `streamCommand.js`: construye la línea de comandos de ffmpeg (pura, cubierta por `tests/screenstream.test.js`).
- `peerStream.js`, `fmp4.js`, `peerReceiver.js`, `player.html`, `player.js`: Stream to Peers (el comando `rist-screen`, el analizador de MP4 fragmentado, el receptor del seguidor y su reproductor MSE). Cubiertos por `tests/screenstreamPeers.test.js`.
- `screenstream.html`, `screenstream.js`: la ventana de control (también realiza la captura en Wayland).
