# Arquitectura del Builder

Este documento cubre la mecánica interna poco evidente del constructor (`http_admin/builder/`).

- **Mapa de módulos:** consulta [ARCHITECTURE.md](ARCHITECTURE.md) (la sección del constructor lista cada módulo por área de responsabilidad).
- **API de extensión para plugins** (`RevelationBuilderHost`, `getBuilderExtensions`): consulta [BUILDER_EXTENSIONS.md](BUILDER_EXTENSIONS.md).

---

## Sincronización del Builder con los pares

### Resumen

La página del constructor nunca llama a RevealRemote. RevealRemote vive por completo **dentro del iframe de vista previa**, que es una presentación Reveal.js real. El constructor se comunica con el iframe exclusivamente mediante un puente `postMessage` (`revelation-builder-preview-bridge`). Cuando el constructor quiere pausar o reanudar la transmisión multiplex, envía una cadena de comando; el iframe la obedece.

Los pares reciben las actualizaciones del estado de las diapositivas mediante el broker Socket.io integrado en el servidor Vite — no tienen conexión directa con el constructor.

```
Builder (outer page)
  │  postMessage commands:
  │  pauseRevealRemote / resumeRevealRemote
  ▼
Preview iframe  ──RevealRemote plugin──▶  Socket.io broker (Vite server)
                                                │
                                       peer windows (followers)
```

---

### Variables de estado clave (`preview.js`)

| Variable | Significado |
|---|---|
| `previewPeerModeEnabled` | el iframe se recargó con `builderPreviewPeer=1`; RevealRemote está activo |
| `peerPushActive` | los pares se han abierto y están siguiendo esta sesión |
| `peerLinked` | la transmisión multiplex está activa en este momento (no pausada) |
| `peerPushResolve` | callback de un solo uso que se emplea para recibir el `multiplexId` del iframe |
| `resetPeerPushState()` | función exportada que limpia `peerPushActive`, `peerLinked` y `peerPushResolve` y, si el modo par estaba activado, reconstruye la URL de la vista previa sin `builderPreviewPeer` para que RevealRemote se desconecte |
| `_peerSaveFn` | referencia a `savePresentation()`, inyectada por `events.js` mediante `setPeerSaveFn()` |

---

### Cronología: se hace clic en el botón "Push to Peers"

**1. El constructor recarga el iframe con el modo par habilitado**

`pushToPeers()` guarda el contenido actual en el archivo temporal y luego reconstruye la URL `src` del iframe agregando `builderPreviewPeer=1`. Esto hace que Reveal.js se reinicialice dentro del iframe.

**2. Dentro del iframe (`presentations.js`)**

- `builderPreviewPeerEnabled = true` (leído del parámetro de la URL)
- `enableRevealRemote` pasa a `true` → el plugin RevealRemote se agrega a Reveal
- En `deck.on('ready')`: el multiplex se **pre-pausa de inmediato** (`setMultiplexPaused(true)`) para suprimir la ráfaga de sincronización inicial antes de que el constructor esté listo
- 300 ms después, `pollForMultiplexId()` comienza a sondear `remote.getMultiplexId()` (o localStorage como alternativa) esperando que RevealRemote reciba un `multiplexId` del broker

**3. Se obtiene el `multiplexId` — el iframe notifica al constructor**

Una vez que el broker asigna un multiplexId, el iframe envía `{ event: 'revealRemoteReady', payload: { multiplexId } }` al padre mediante `postMessage`.

---

**4. El constructor resuelve su promesa**

`peerPushResolve(multiplexId)` resuelve la promesa de `waitForMultiplexId()`. El constructor ya tiene el multiplexId.

**5. Se construye y se envía la URL para los pares**

`getBuilderPresentationUrl(multiplexId)` agrega `remoteMultiplexId=<id>` a la URL normal de la presentación. Esa URL se envía a las pantallas par mediante `electronAPI.sendPeerCommand({ type: 'open-presentation', ... })`.

Los pares cargan la presentación con `remoteMultiplexId` en su URL, lo que los pone en el **modo seguidor** de RevealRemote — se suscriben a los eventos de estado de diapositivas del broker en lugar de transmitir.

**6. El constructor activa el vínculo**

`peerPushActive = true`, `peerLinked = true`, y luego se envía `resumeRevealRemote` al iframe → `setMultiplexPaused(false)` + `sendCurrentState()`. Los pares reciben de inmediato la diapositiva actual.

---

### El interruptor Vincular / Desvincular

El botón de vínculo pausa o reanuda la transmisión sin desconectar a los pares.

**Desvincular:** `peerLinked = false` → `pauseRevealRemote` → el iframe llama a `setMultiplexPaused(true)`. Los pares se quedan congelados en la última diapositiva.

**Volver a vincular:** Si `state.dirty`, el constructor llama primero a `_peerSaveFn()` (= `savePresentation()`) y espera de 1 a 5.2 s (consulta "Repintado de los pares tras las ediciones") para que el servidor tenga el archivo actualizado antes de que los pares reciban un cambio de diapositiva. Luego `peerLinked = true` → `resumeRevealRemote` → `setMultiplexPaused(false)` + `sendCurrentState()`.

---

### `resetPeerPushState()`

La llama `unpushPeers()` después de enviar `close-presentation`, y el botón **Re-parse** en `events.js`
(volver a analizar reemplaza el documento, por lo que cualquier envío anterior queda obsoleto). Solo restablece el estado propio
del constructor; no le dice nada a los pares, así que envía primero `close-presentation` si los pares deben cerrarse.

---

### Repintado de los pares tras las ediciones

Diseño deliberado para eventos en vivo: las ediciones hechas en el constructor no deben perturbar la pantalla grande a mitad de un evento. En `setHotReloading()` (`revelation/js/presentations.js`), un par (seguidor) que recibe un evento Vite `reload-presentations` **no** recarga; marca la recarga como pendiente y espera el siguiente mensaje de navegación del presentador (`RevealRemote.onBeforeSync`), y entonces hace un fundido y recarga. Un cambio de diapositiva en el par también dispara la recarga pendiente.

- **Forzar una actualización:** desactiva y vuelve a activar el vínculo (Link). Al volver a vincular se envía `sendCurrentState()`, que cuenta como mensaje de navegación y dispara la recarga pendiente. La información emergente del estado vinculado lo indica ("Toggle again for peer reload").
- **Los medios la bloquean:** mientras se reproduce cualquier `<audio>` (o un video en primer plano en la diapositiva actual), la recarga sigue pendiente y el interruptor no tiene efecto. Se ejecuta en la siguiente navegación después de que los medios se hayan detenido; que los medios terminen por sí solos no la dispara.
- **Protección de 3 segundos:** una navegación dentro de los 3 s posteriores al evento HMR es ignorada por `onBeforeSync` (se trata como el mismo evento).
- **Volver a vincular con cambios sin guardar:** el constructor recuerda dónde se enviaron los pares por última vez (`peerLastSentIndices`, registrado al enviar y cuando se rompe el vínculo), guarda y luego espera antes de reanudar. El observador del servidor aplica un debounce de ~1.2 s (`presentation-watcher.js`), de modo que los pares reciben el evento HMR en ≈1.3–2 s.
  - *Misma diapositiva que los pares* → espera `PEER_RELINK_SAME_SLIDE_MS` (1 s): normalmente el nuevo vínculo llega antes del evento HMR, así que no hay nada pendiente y nada se recarga (si el HMR llega primero, la protección de 3 s del par ignora el nuevo vínculo).
  - *Diapositiva distinta* → espera `PEER_RELINK_NEW_SLIDE_MS` (5.2 s): el nuevo vínculo llega después de la protección, por lo que `onBeforeSync` hace un fundido a negro, descarta la navegación y recarga sobre la diapositiva actual actualizada (sin un salto visible a la nueva diapositiva con contenido obsoleto).
  - Esperar menos que el debounce del observador hace que el nuevo vínculo llegue *antes* del HMR, dejando la recarga pendiente.
- **Alternar justo después de un guardado manual:** si el constructor ya está limpio (p. ej., Ctrl+S antes) no hay espera, por lo que volver a vincular más de 3 s después del guardado fuerza una recarga incluso en la misma diapositiva.

---

### Unpush

El botón ⏏️ (visible junto al botón de vínculo mientras `peerPushActive`) llama a `unpushPeers()`: envía `close-presentation` a los pares (el mismo manejador que el cierre de la interfaz principal) y luego `resetPeerPushState()`, que recarga el iframe de vista previa sin `builderPreviewPeer` para que RevealRemote se desconecte.

---

### Desvinculación automática al editar

`initPeerPushButtons()` registra `addDirtyListener(() => unlinkPeers())`. Cualquier edición que llame a `markDirty()` rompe automáticamente el vínculo, evitando que los cambios de diapositiva a mitad de una edición se transmitan a los pares. Volver a vincular es manual (y dispara un guardado si es necesario, como se indicó arriba).

---

### Recuperación tras la recarga del iframe

Si el iframe de vista previa se recarga (p. ej., tras una actualización de la vista previa), RevealRemote se reinicializa y el multiplex vuelve a comenzar pausado. El constructor lo maneja en `bindPreviewBridgeListener`: cuando el iframe dispara un evento `ready` y `peerPushActive` es true, el constructor reenvía de inmediato `resumeRevealRemote` o `pauseRevealRemote` para restaurar el estado correcto del vínculo. El constructor es la autoridad sobre el estado del vínculo; el iframe no guarda estado al respecto.

---

### Cómo se crea el `multiplexId`

El multiplexId lo asigna el **broker Socket.io de RevealRemote** integrado en el servidor Vite (`createRevealRemoteBroker()` en `revelation/server/reveal-remote-broker.js`). El plugin RevealRemote del iframe se conecta como presentador, y el broker devuelve un multiplexId de sesión. El constructor nunca toca el broker directamente — solo sondea el iframe hasta que aparece el ID y luego lo usa para construir la URL del seguidor.

Consulta también: `lib/serverManager.js` → `writeRevealRemoteJSFile()` para ver cómo se genera `reveal-remote.js` al iniciar, de modo que la presentación dentro de la app apunte a la URL correcta del broker.
