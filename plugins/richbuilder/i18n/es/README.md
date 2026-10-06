# Plugin richbuilder

Editor de diapositivas de texto enriquecido para el Constructor de Presentaciones. Reemplaza el iframe de vista previa por una superficie de edición contenteditable que se serializa de vuelta a markdown de diapositiva.

Comportamiento actual:
- Añade un botón de modo `Rich Editor` en las acciones de Vista Previa en Vivo del constructor.
- Aloja el control de **Properties** de la diapositiva del constructor al final de su barra de herramientas, por lo que solo se muestra durante la edición enriquecida (permanece en el encabezado de Vista Previa en Vivo cuando este plugin está deshabilitado).
- Oculta `#preview-frame` mientras está activo y muestra un lienzo editable que se sincroniza en ambos sentidos con el cuerpo markdown de la diapositiva actual.
- Barra de herramientas: encabezados, negrita/cursiva/subrayado, colores de texto (fragmentos `[text]{.red}`), cita en bloque/cita (cite), listas y listas de verificación, tablas (insertar/eliminar filas y columnas, alineación), bloques de dos columnas (`||`) y preajustes de diseño de diapositiva (estándar, información, tercio superior/inferior, desplazar a la izquierda/derecha).
- Las imágenes y los videos (incluidos los alias `media:`) se muestran en línea con opciones de ubicación; las macros desconocidas y el HTML sin procesar aparecen como tokens no editables.

---

Estructura: `builder.js` es el punto de entrada; `builder-markdown.js` (markdown a DOM), `builder-serialize.js` (DOM a markdown), `builder-format.js`, `builder-table.js`, `builder-layout.js`, `builder-media.js`, `builder-styles.js`, `builder-utils.js`. `color-spans.js` es una copia idéntica byte por byte de `http_admin/builder/color-spans.js` y debe mantenerse sincronizada.
