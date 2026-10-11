# Plugin Screen Stream

Captura una pantalla y la envía con ffmpeg mediante [RIST](https://www.rist.tv/) (Reliable Internet Stream Transport) a una dirección IP y un puerto. Úsalo para alimentar una pantalla en vivo a un mezclador de video, a un PC de transmisión o a cualquier receptor RIST (OBS, vMix, `ffplay`, `ffmpeg`).

## Uso

1. Activa **Screen Stream** en Configuración → Plugins, ajusta las opciones de abajo y reinicia si se solicita.
2. Abre **Plugins → Stream Screen (RIST)…** (o la entrada **Plugins** de la barra lateral).
3. Elige la pantalla y pulsa **Start Streaming**. **Stop Streaming** la detiene. Al cerrar la aplicación también se detiene.

Para probar, ejecuta un receptor en el equipo de destino, por ejemplo `ffplay "rist://@0.0.0.0:5000"`.

## Configuración

| Opción | Predeterminado | Significado |
|---|---|---|
| `host` | _(vacío)_ | Dirección IP o nombre del destino (IPv4, IPv6 o nombre). |
| `port` | 5000 | Puerto RIST de destino. RIST también usa el puerto siguiente para solicitudes de retransmisión; usa un número par con el perfil Simple. |
| `captureMethod` | `auto` | `auto`, `ffmpeg` o `browser` (ver abajo). |
| `fps` | 30 | Fotogramas por segundo. |
| `bitrateKbps` | 6000 | Tasa de bits del video. |
| `scaleHeight` | 0 | Escala a esta altura en píxeles; 0 mantiene el tamaño de la pantalla. |
| `latencyMs` | 1000 | Búfer de retransmisión RIST; debe coincidir con el receptor. 0 usa el valor predeterminado de ffmpeg. |
| `videoEncoder` | `libx264` | Cualquier codificador H.264 de tu ffmpeg (`h264_nvenc`, `h264_qsv`, `h264_videotoolbox`…). |
| `captureCursor` | activado | Incluye el puntero del ratón. |
| `encryption` | `none` | Cifrado RIST: `none`, `128` o `256` (AES, bits). El receptor debe usar el mismo tipo y la misma frase de contraseña. |
| `secret` | _(vacío)_ | La frase de contraseña del cifrado. Obligatoria si el cifrado está activado. |
| `browserPassthrough` | activado | Solo Wayland: el grabador de pantalla produce H.264 a `bitrateKbps` y ffmpeg lo envía sin cambios (menos CPU y retardo). `fps`, `scaleHeight` y `videoEncoder` no se aplican entonces. Desactivado, se recodifica con ffmpeg. Si no se puede grabar H.264, se recodifica. |

La transmisión es H.264 en MPEG-TS, solo video, cifrada solo si activas `encryption` (AES de RIST con una frase de contraseña compartida; protege la transmisión, no autentica al receptor). La frase se pasa a ffmpeg como opción de línea de comandos, por lo que otros usuarios del mismo equipo pueden verla en la lista de procesos mientras se transmite. Con el cifrado desactivado, envía solo por redes de confianza. Una URL de destino como `rist://host:5000?secret=pw&aes-type=128&buffer=300` equivale a `host`, `port`, `secret` = pw, `encryption` = 128 y `latencyMs` = 300.

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

- `plugin.js`: el proceso ffmpeg, la comprobación de capacidades y la ventana.
- `streamCommand.js`: construye la línea de comandos de ffmpeg (pura, cubierta por `tests/screenstream.test.js`).
- `screenstream.html`, `screenstream.js`: la ventana de control (también realiza la captura en Wayland).
