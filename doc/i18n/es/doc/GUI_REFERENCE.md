# Referencia de GUI de Snapshot Builder

---

### Tabla de contenidos

* [Resumen](#gui-overview)
* [Pantallas principales](#gui-main-screens)
* [Lista de presentaciones y acciones](#gui-presentation-list)
* [Builder y herramientas de edición](#gui-builder)
* [Variantes de idioma](#gui-language-variants)
* [Biblioteca multimedia e importación](#gui-media-library)
* [Plugins en la GUI](#gui-plugins)
* [Flujos de handout y PDF](#gui-handout-pdf)
* [Flujos de exportación](#gui-export)
* [Configuración y red](#gui-settings-network)
* [Herramientas de depuración y recuperación](#gui-debug-recovery)
* [Problemas comunes](#gui-gotchas)
* [Flujo recomendado](#gui-workflow)

---

<a id="gui-overview"></a>

## Resumen

Esta guía cubre la experiencia de GUI de escritorio en `revelation-electron-wrapper`.

Use este documento cuando necesite orientación práctica a nivel de aplicación. Para sintaxis markdown e internals del framework, use la documentación del framework REVELation.

---

<a id="gui-main-screens"></a>

## Pantallas principales

Las áreas principales de la GUI incluyen:

- **Presentation List**: explorar, abrir y gestionar presentaciones.
- **Media Library**: gestionar medios compartidos en `_media`.
- **Presentation Builder**: edición visual y herramientas de inserción.
- **Settings**: configuración de app, plugins, medios y red.
- **Handout View**: renderizado de presentación amigable para impresión.

---

<a id="gui-presentation-list"></a>

## Lista de presentaciones y acciones

Desde la lista de presentaciones normalmente puede:

- Crear una nueva presentación
- Abrir/presentar una presentación
- Abrir vista handout
- Abrir builder/editor
- Mostrar carpeta de presentación
- Exportar artefactos (PDF/imágenes/paquete offline)
- Eliminar variantes de presentación o carpetas completas de presentación

---

<a id="gui-builder"></a>

## Builder y herramientas de edición

El builder está enfocado en flujos de autoría rápidos:

- Navegación de diapositivas/columnas y herramientas de estructura
- Insertar contenido desde menús (notas, tablas, medios, plantillas de plugins)
- Edición de metadatos y propiedades de la presentación
- Soporte de edición con variantes
- Atajos de vista previa y lanzamiento de presentación

Las acciones de inserción del builder son extensibles por plugins, por lo que los plugins instalados pueden agregar creadores de contenido personalizados.

---

<a id="gui-language-variants"></a>

## Variantes de idioma

REVELation admite variantes traducidas de presentación que permanecen vinculadas a un archivo markdown maestro.

Flujo rápido:

1. Construya su presentación en idioma maestro en Builder.
2. En Builder, abra `Variants ▾` y elija `Add Variant…`.
3. Ingrese un código de idioma (por ejemplo `es`) para crear un archivo variante vinculado y oculto.
4. Traduza el contenido de las diapositivas en el archivo variante.
5. Use dispositivos peer o `Additional Screens (Virtual Peers)` con ajustes de idioma y luego presione `Z` durante la presentación para enviar el deck a peers.

Para detalles completos y sintaxis YAML, consulte [revelation/doc/VARIANTS_REFERENCE.md](../revelation/doc/VARIANTS_REFERENCE.md).

---

<a id="gui-media-library"></a>

## Biblioteca multimedia e importación

Media Library le ayuda a:

- Importar archivos multimedia a `_media` compartido
- Generar y guardar metadatos sidecar
- Previsualizar medios e inspeccionar detalles de atribución/origen
- Eliminar o gestionar recursos multimedia existentes
- Reutilizar los mismos medios en muchas presentaciones

El flujo Add Media también puede importar fuentes externas (incluidos formatos como PDF/PPTX, según disponibilidad de herramientas y configuración de plugins).

Para detalles de configuración de importación PDF, consulte [doc/dev/README-PDF.md](dev/README-PDF.md).

---

<a id="gui-plugins"></a>

## Plugins en la GUI

Los puntos de integración de plugins en la GUI incluyen:

- Páginas de plugin en la barra lateral/menú
- Acciones de inserción del builder
- Herramientas basadas en diálogo (búsqueda/importación/efectos)
- Configuración y valores de plugins en Settings

Puede abrir la carpeta de plugins desde el menú Plugins e instalar paquetes de plugin adicionales (donde sea compatible).

---

<a id="gui-handout-pdf"></a>

## Flujos de handout y PDF

El modo handout ofrece una salida de presentación amigable para impresión con controles opcionales:

- Mostrar/ocultar notas
- Mostrar/ocultar imágenes
- Mostrar/ocultar atribuciones
- Comportamiento de enlaces en numeración de diapositivas

---

Flujo típico de PDF:

1. Abrir vista handout.
2. Establecer los toggles deseados.
3. Usar imprimir/guardar como PDF.

---

<a id="gui-export"></a>

## Flujos de exportación

Rutas comunes de exportación desde la GUI:

- Exportación PDF
- Exportación de imágenes de diapositivas
- Flujos de paquete offline/exportación

La disponibilidad depende del estado de la presentación, soporte de plugins y entorno/herramientas locales.

---

<a id="gui-settings-network"></a>

## Configuración y red

La configuración incluye:

- Preferencias de presentación y medios
- Valores de configuración de plugins
- Opciones de localización/idioma
- Modo de red y ajustes de presentación remota
- Opciones de emparejamiento/descubrimiento de peer presenter

En modo red, se habilita comportamiento adicional (descubrimiento, control remoto, enrutamiento de comandos peer).

Para una referencia de configuración campo por campo, consulte [doc/SETTINGS.md](SETTINGS.md).

---

<a id="gui-debug-recovery"></a>

## Herramientas de depuración y recuperación

Acciones de mantenimiento integradas útiles:

- Abrir log de depuración
- Limpiar/restablecer log de depuración
- Regenerar presentación de documentación
- Regenerar miniaturas de temas
- Restablecer toda la configuración y plugins

Para detalles de reset/desinstalación/rutas de log, consulte [doc/TROUBLESHOOTING.md](TROUBLESHOOTING.md).

---

<a id="gui-gotchas"></a>

## Problemas comunes

- **Problemas de pantalla en Wayland**: en algunas configuraciones Linux, iniciar con backend X11 es más estable.
- **Comportamiento faltante de plugin**: verifique que el plugin esté instalado/habilitado y que su configuración esté completa.
- **Medios no resueltos**: confirme que los archivos existan en `_media` y que alias/rutas coincidan con markdown/front matter.
- **Diferencias de exportación**: las salidas handout/print/offline pueden diferir del comportamiento reveal en vivo según restricciones de plugin/runtime.
- **Impacto inesperado de reset**: el reset elimina overrides/configuración local; haga copia de seguridad de datos locales críticos primero.

Guía de solución de problemas: [doc/TROUBLESHOOTING.md](TROUBLESHOOTING.md).

---

<a id="gui-workflow"></a>

## Flujo recomendado

1. Crear/abrir una presentación desde la lista.
2. Importar primero medios en `_media`.
3. Construir diapositivas y metadatos en builder.
4. Previsualizar en modo presentación.
5. Validar salida handout/PDF.
6. Exportar/compartir según necesidad.
