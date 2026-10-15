# Plugin richbuilder

Editor de diapositivas de texto enriquecido para el Constructor de Presentaciones. Reemplaza el iframe de vista previa por una superficie de edición contenteditable que se serializa de vuelta a markdown de diapositiva.

Comportamiento actual:
- Añade un botón de modo `Rich Editor` en las acciones de Vista Previa en Vivo del constructor.
- Aloja el control de **Properties** de la diapositiva del constructor al final de su barra de herramientas, por lo que solo se muestra durante la edición enriquecida (permanece en el encabezado de Vista Previa en Vivo cuando este plugin está deshabilitado).
- Oculta `#preview-frame` mientras está activo y muestra un lienzo editable que se sincroniza en ambos sentidos con el cuerpo markdown de la diapositiva actual.
- Menú Animation (botón de estrella fugaz): Slide Animation (un diálogo elige `:animate:` o `:animate:restart:` y opcionalmente duplica la diapositiva), Fragment (`++`) y las entradas de plugins de `getAnimationTools` (appearance: "Appearance Animation…"). El clic derecho también incluye Fragment (`++`) junto a las herramientas de los plugins.
- Al hacer clic en un fragmento (`++` / `==`) se llama primero al hook `onRichFragmentEdit` de los plugins (appearance abre su diálogo de animación, también para un `++` simple); sin un manejador se abre un editor de texto del marcador.
- Al hacer clic en una tarjeta de macro (línea `:tag:` o bloque YAML) se llama primero al hook `onRichMacroEdit` de los plugins (credit_ccli abre su diálogo de créditos); sin un manejador se abre un editor de macro de texto plano. El menú Animation también lista las entradas `getBlockTools` de los plugins bajo «Plugin Blocks» (p. ej. «CCLI Credits…»).
- Embeds: las líneas `![youtube](…)`, `![youtube:fit](…)` y `![web](…)` se muestran como tarjetas con etiqueta (no como imágenes); el menú Insert pide primero la dirección. Las macros de audio muestran etiquetas Play/Loop/Stop.
- Portapapeles: Cut/Copy/Paste en la barra de herramientas, el menú de clic derecho y los atajos (`builder-clipboard.js`). Copy conserva el markdown exacto para pegar de enriquecido a enriquecido; Paste enruta el contenido propio, las diapositivas del clasificador de diapositivas, el texto/HTML corto (≤ 8 líneas, filtrado) en línea, y el texto más largo mediante Smart Paste + el diálogo Divide Slides. Los menús Slide Markdown del lado de texto ya no se toman prestados para la barra de herramientas.
- Barra de herramientas: encabezados, negrita/cursiva/subrayado, colores de texto (fragmentos `[text]{.red}`), cita en bloque, bloques de código, cita (cite), listas y listas de verificación, tablas (insertar/eliminar filas y columnas, alineación), bloques de dos columnas (`||`) y preajustes de diseño de diapositiva (estándar, información, tercio superior/inferior, desplazar a la izquierda/derecha).
- Las imágenes y los videos (incluidos los alias `media:`) se muestran en línea con opciones de ubicación; las macros desconocidas y el HTML sin procesar aparecen como tokens no editables.

---

Estructura: `builder.js` es el punto de entrada; `builder-markdown.js` (markdown a DOM), `builder-serialize.js` (DOM a markdown), `builder-format.js`, `builder-table.js`, `builder-layout.js`, `builder-media.js`, `builder-styles.js`, `builder-utils.js`. `color-spans.js` es una copia idéntica byte por byte de `http_admin/builder/color-spans.js` y debe mantenerse sincronizada.
