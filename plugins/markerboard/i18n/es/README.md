# Plugin Markerboard

## Tabla de Contenido
* [Resumen](#markerboard-overview)
* [Qué Añade](#markerboard-what-it-adds)
* [Controles](#markerboard-controls)
* [Modelo de Datos](#markerboard-data-model)
* [Sincronización en Tiempo Real](#markerboard-realtime-sync)
* [Configuración del Plugin](#markerboard-plugin-settings)
* [Notas Actuales](#markerboard-current-notes)

<a id="markerboard-overview"></a>
## Resumen

El plugin Markerboard añade una capa de anotación para dibujar encima de presentaciones Reveal.

Está diseñado alrededor de coordenadas del espacio de la diapositiva para que las anotaciones permanezcan alineadas con el contenido en diferentes tamaños de pantalla.

---

<a id="markerboard-what-it-adds"></a>
## Qué Añade

- Superposición de marcador con activación/desactivación en la vista de presentación
- Almacenamiento de anotaciones por diapositiva
- Herramientas de pluma, resaltador y borrador
- Paleta de colores y control deslizante de grosor
- Borrado por diapositiva y deshacer paso a paso
- Comportamiento de ocultar/desvanecer/repintar durante transiciones
- Canal opcional de sincronización en tiempo real para presentaciones compartidas

---

<a id="markerboard-controls"></a>
## Controles

- Menú contextual:
- `Markerboard: Enable/Disable`
- `Markerboard: Undo`

- Barra lateral izquierda (cuando está habilitado):
- `✏️` pluma
- `🖍️` resaltador
- `🧽` borrador
- círculos de color
- control deslizante `📏 Width`
- `↩️` deshacer
- `🗑️` borrar diapositiva actual
- `✖️` desactivar markerboard

---

<a id="markerboard-data-model"></a>
## Modelo de Datos

El runtime usa un documento en memoria basado en operaciones:

- `doc` con `coordinateSpace`, `slides`, `opLog`
- por diapositiva:
- mapa `strokes`
- `order` de dibujo
- `tombstones`

Tipos de operación principales:

- `begin_stroke`
- `append_points`
- `end_stroke`
- `clear_slide`

Las coordenadas se almacenan en unidades de diapositiva (`config.width`/`config.height`), no en píxeles crudos del viewport.

---

<a id="markerboard-realtime-sync"></a>
## Sincronización en Tiempo Real

Markerboard puede sincronizarse mediante una ruta compartida de socket para plugins del presentador:

- Ruta de socket: `/presenter-plugins-socket`
- Canal de eventos: `presenter-plugin:event`
- Alcance del plugin: `markerboard`

Comportamiento de resolución de sala:

- URLs de seguidor/compartidas: usan el parámetro `remoteMultiplexId`
- URLs de maestro: si no existe el parámetro, la sala puede resolverse desde el mismo mapeo en localStorage que usa la lógica de compartir enlaces, y solo cuando markerboard está habilitado

Los payloads en tiempo real actualmente incluyen:

- `markerboard-op`
- `markerboard-snapshot`
- `markerboard-request-snapshot`
- `markerboard-enabled`

---

Las operaciones `append_points` se envían en lotes antes de emitirse (configurable en `client.js`).

<a id="markerboard-plugin-settings"></a>
## Configuración del Plugin

- `allowPeerFirstToggle` (booleano; valor predeterminado del formulario de configuración `false`, valor de respaldo del cliente `true` si falta la clave)
- Cuando es `true`, el maestro intenta conectarse a la sala al cargar (usando el multiplex id almacenado) para que un peer conectado pueda activar markerboard primero y sincronizarlo de inmediato a todos los clientes.
- Cuando es `false`, el maestro mantiene el comportamiento previo y normalmente se une a la sala solo cuando markerboard se habilita localmente.

- `publicMode` (booleano; valor predeterminado del formulario de configuración `false`, valor de respaldo del cliente `true` si falta la clave)
- Cuando es `true`, cualquier peer conectado en la sala multiplex puede dibujar y transmitir cambios de markerboard.
- Cuando es `false`, los clientes seguidores quedan en modo solo lectura y solo el presentador/maestro puede dibujar, borrar, restaurar, importar o transmitir cambios del estado habilitado de markerboard.
- Nota del modelo de permisos: `publicMode` es un control aplicado del lado del cliente (acceso cooperativo), no una autorización del lado del servidor.

---

<a id="markerboard-current-notes"></a>
## Notas Actuales

- El documento activo está en memoria; el navegador también guarda instantáneas y preferencias de herramientas en `localStorage`, y la barra de herramientas puede exportar/importar JSON y exportar SVG.
- El soporte en tiempo real es intencionalmente liviano y sirve como base para robustecer más adelante.
- Si no se puede resolver un multiplex room id, la sincronización por socket se omite y markerboard queda solo local.
