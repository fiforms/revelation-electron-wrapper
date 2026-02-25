# Plugin MediaFX

## Tabla de contenidos
* [Resumen](#mediafx-overview)
* [Qué agrega](#mediafx-what-it-adds)
* [Cómo funciona](#mediafx-how-it-works)
* [Uso de la galería de presets](#mediafx-preset-gallery)
* [Capas avanzadas de efectos](#mediafx-advanced-layering)
* [Notas de redimensionado y salida](#mediafx-resize-output)

---

<a id="mediafx-overview"></a>
## Resumen

El plugin MediaFX aplica efectos/transformaciones visuales a medios y ayuda a insertar resultados en presentaciones.

Combina dos motores de efectos:

- `ffmpeg`: herramienta de línea de comandos potente y ampliamente usada para procesamiento de video
- `effectgenerator`: backend personalizado de REVELation para pipelines de efectos avanzados/personalizados

---

<a id="mediafx-what-it-adds"></a>
## Qué agrega

- Flujos de listado y ejecución de efectos
- Selector de medios y diálogos de guardado
- Soporte para guardar/cargar presets
- Rutas de conversión de medios por lotes y gestionadas por proceso
- Flujos de redimensionado de video y conversión de formato

---

<a id="mediafx-how-it-works"></a>
## Cómo funciona

El plugin coordina diálogos de UI, ejecuta pipelines de efectos (flujos con effectgenerator y ffmpeg), rastrea trabajos activos y devuelve medios de salida para insertarlos en presentaciones.

Cuando se aplican múltiples efectos, primero se procesan los efectos basados en ffmpeg y luego continúa el procesamiento adicional de effectgenerator sobre la salida.

---

<a id="mediafx-preset-gallery"></a>
## Uso de la galería de presets

El flujo más sencillo es elegir un preset desde la galería incorporada:

1. Abra MediaFX.
2. Elija un archivo multimedia fuente.
3. Seleccione un preset de la galería.
4. Renderice y guarde/inserte el resultado.

Esta es la forma más rápida de obtener efectos pulidos sin ajustes manuales.

---

<a id="mediafx-advanced-layering"></a>
## Capas avanzadas de efectos

Para mayor control, construya su propio pipeline seleccionando y apilando uno o más efectos.

- Mezcle pasos de efectos para estilos personalizados
- Ajuste parámetros por efecto
- Guarde y recargue presets para flujos repetibles

Advertencia:
- Los efectos ffmpeg siempre se ejecutan primero en el pipeline.

---

<a id="mediafx-resize-output"></a>
## Notas de redimensionado y salida

MediaFX también puede usarse para redimensionar la salida de video para necesidades específicas de presentación o exportación.

Nota de audio:
- Los videos producidos mediante pipelines de efectos generalmente quedan sin audio.
- Si necesita audio, use un editor de video externo para mezclar/recuperar audio.
- Versiones futuras podrían agregar mejor manejo de audio directamente en MediaFX.
