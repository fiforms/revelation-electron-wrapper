# Plugin Video Stream

Transmite video en vivo (cámara web o pantalla compartida) a otros participantes de una presentación compartida.

## Resumen

El plugin Video Stream habilita el uso compartido de video de par a par dentro de una presentación que tiene un `remoteMultiplexId` compartido. Cualquier participante puede iniciar la transmisión de su cámara web o su pantalla, y el video aparecerá en las presentaciones de todos los demás participantes en una ubicación configurable (superposición, fondo o flotante).

---

**Decisiones de diseño clave:**
- **Una sola transmisión activa:** Solo un par puede transmitir a la vez (el enfoque más simple para LAN)
- **WebRTC de malla completa:** Cada transmisor se conecta directamente con cada espectador (ideal para grupos pequeños en LAN)
- **Señalización mediante Socket.io:** Usa el namespace existente `/presenter-plugins-socket` para los intercambios iniciales de WebRTC
- **Fuente seleccionable por el usuario:** Los espectadores pueden elegir cámara web o pantalla compartida al iniciar
- **Visualización configurable:** Superposición (esquina), fondo (detrás de las diapositivas) o ventana flotante

---

## Arquitectura

```
videostream/
├── plugin.js              # Plugin metadata and config schema
├── client.js              # Browser-side implementation (all-in-one for now)
├── offline.js             # Export handler (for offline presentations)
└── README.md
```

---

### Cómo funciona

1. **Iniciar una transmisión:**
   - Haz clic derecho en una diapositiva y elige "Start Stream (Webcam)" o "Start Stream (Screen)" (menú contextual de la presentación; no hay un botón Stream en pantalla)
   - Selecciona cámara web o pantalla compartida
   - El navegador solicita acceso al dispositivo de medios
   - El par anuncia `videostream:stream-started` a todos los demás mediante el socket

2. **Recibir una transmisión:**
   - Los demás pares reciben la notificación de la transmisión entrante
   - Solicitan una oferta WebRTC al transmisor
   - Se establecen conexiones de pares de malla completa (transmisor → cada espectador)
   - El video remoto aparece en la ubicación configurada

3. **Detener:**
   - Haz clic derecho y elige "Stop Stream"
   - Las pistas locales se cierran y las conexiones de pares se limpian
   - Los pares reciben la notificación y limpian su lado

---

### Configuración

Ajustes del plugin (en `config.json` o en la interfaz de configuración):

### Ajustes de Visualización

| Opción | Valores | Predeterminado | Propósito |
|--------|--------|---------|---------|
| `displayMode` | `overlay`, `background`, `floating` | `overlay` | Dónde aparece el video en las diapositivas |
| `overlayPosition` | `top-left`, `top-right`, `bottom-left`, `bottom-right` | `top-right` | Esquina de posición de la superposición |
| `overlayOpacity` | 0–100 | 85 | Transparencia de la superposición (%) |

---

### Ajustes de Captura de Video

| Opción | Valores | Predeterminado | Propósito |
|--------|--------|---------|---------|
| `videoWidth` | 320–1920 píxeles | 640 | Ancho de video preferido (se adapta a la capacidad del dispositivo) |
| `videoHeight` | 240–1080 píxeles | 480 | Alto de video preferido (se adapta a la capacidad del dispositivo) |
| `videoFramerate` | 5–60 fps | 24 | Cuadros por segundo objetivo (menor = menos ancho de banda) |

---

### Ajustes de Tasa de Bits y Calidad

| Opción | Valores | Predeterminado | Propósito |
|--------|--------|---------|---------|
| `maxVideoBitrate` | 300–10000 kbps | 2500 | Tasa de bits máxima del video (controla el equilibrio entre calidad y fluidez) |
| `maxAudioBitrate` | 16–256 kbps | 64 | Tasa de bits máxima del audio |
| `degradationPreference` | `maintain-framerate`, `maintain-resolution`, `balanced` | `maintain-framerate` | Qué sacrificar cuando el ancho de banda es limitado |

---

### Consejos de Ajuste

**Para LAN (red local rápida):**
- `videoWidth`: 1280, `videoHeight`: 720, `videoFramerate`: 30
- `maxVideoBitrate`: 3500–5000 kbps
- `degradationPreference`: `maintain-framerate` (un video fluido importa más que la resolución)

**Para menor ancho de banda / WiFi:**
- `videoWidth`: 640, `videoHeight`: 480, `videoFramerate`: 15–20
- `maxVideoBitrate`: 1500–2500 kbps
- `degradationPreference`: `maintain-resolution` (un video más nítido importa más que la fluidez)

**Para compartir pantalla (el texto necesita claridad):**
- `videoWidth`: 1280, `videoHeight`: 720, `videoFramerate`: 15
- `maxVideoBitrate`: 2000–3000 kbps
- `degradationPreference`: `maintain-resolution`

---

## Limitaciones y Pendientes
### Implementación Actual (v0.1.0 - Esbozo Preliminar)
- ✅ Andamiaje de señalización con Socket.io
- ✅ Configuración de la conexión de pares WebRTC
- ✅ Interfaz para controles de inicio/detención y selección de fuente
- ✅ Modos y posiciones de visualización configurables
- ⚠️ **Aún no implementado:**
  - **Señalización del lado del servidor:** No hay controladores reales de eventos de socket en el backend de Node
  - **Flujo de oferta/respuesta:** La lógica del intercambio está esbozada pero sin probar
  - **Manejo de candidatos ICE:** Necesita un manejo de errores robusto
  - (Los límites de tasa de bits SÍ se aplican: `maxVideoBitrate` / `maxAudioBitrate` / `degradationPreference` se establecen en el RTCRtpSender en client.js; una versión anterior de esta lista decía lo contrario)
  - **Arrastre de la ventana flotante:** Puede añadirse si se necesita
  - **Múltiples transmisiones simultáneas:** Actualmente admite solo una (por diseño)
  - **Servidores STUN de respaldo:** Solo usa los de Google; podrían añadirse más
  - **Indicadores de nivel de audio:** Serían útiles para depurar
  - **Grabación de la transmisión:** Fuera de alcance para v0.1

---

### Pruebas Necesarias
- Flujo de permisos de medios del navegador (distinto en cada sistema operativo)
- Establecimiento de la conexión WebRTC en LAN
- Reconexión de Socket.io y limpieza de salas
- Limpieza al cerrarse la ventana de la presentación
- Rendimiento con restricciones de tasa de bits

## Implementación del Lado del Servidor

El plugin **solo hace señalización**: no requiere ningún código del lado del servidor más allá del que ya existe:
- El namespace `/presenter-plugins-socket` ya está escuchando
- El plugin solo necesita emitir/escuchar eventos personalizados en ese socket
- No se requiere gestión de estado (retransmisión sin estado)

Si quieres añadir registro del lado del servidor o validación de retransmisión, modifica `revelation/server/presenter-plugins-broker.js` para manejar los nuevos tipos de evento.

---

## Uso

1. **Crea una presentación compartida** con un par que use un `remoteMultiplexId`
2. **Haz clic derecho en una diapositiva** → Verás:
   - 📷 **Start Stream (Webcam)**
   - 🖥️ **Start Stream (Screen)**
3. **Haz clic en tu elección** → el navegador solicita permiso para acceder a la cámara web o pantalla
4. **El video comienza** y aparece en ambas presentaciones:
   - Tu vista previa (normalmente solo te ves a ti mismo)
   - La presentación de tu par (en la ubicación que tenga configurada: superposición, fondo o flotante)
5. **Un indicador rojo pulsante** ("● Streaming") aparece en la esquina superior derecha
6. **Haz clic derecho de nuevo** → Selecciona "⏹️ Stop Stream" para terminar la transmisión
7. Ambos lados limpian las conexiones y quedan listos para la siguiente transmisión

---

**Consejo:** Puedes seguir presentando e interactuando con las diapositivas mientras transmites. Tu par ve el video en su ubicación de visualización configurada y puede trabajar con las diapositivas normalmente.

## Mejoras Futuras

- **Adaptación de la tasa de bits:** Monitorear la calidad de la conexión y ajustar la codificación
- **Cuadrícula de múltiples transmisiones:** Admitir transmisiones simultáneas (requiere SFU o una interfaz más compleja)
- **Estadísticas de la transmisión:** Mostrar ancho de banda, pérdida de paquetes, latencia (API de estadísticas de WebRTC)
- **Grabación:** Guardar las transmisiones entrantes en disco
- **Control remoto de la transmisión:** Quien la solicita puede pausar/ocultar/cambiar transmisiones
