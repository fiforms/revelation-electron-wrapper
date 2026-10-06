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
* [Referencia de la API](#api-reference)
* [Herramientas de depuración y recuperación](#gui-debug-recovery)
* [Problemas comunes](#gui-gotchas)
* [Flujo recomendado](#gui-workflow)

---

<a id="gui-overview"></a>

## Resumen

Esta guía cubre la experiencia de GUI de escritorio en `revelation-electron-wrapper`.

Usa este documento cuando necesites orientación práctica a nivel de aplicación. Para la sintaxis markdown y los internals del framework, usa la documentación del framework REVELation.

---

<a id="gui-main-screens"></a>

## Pantallas principales

Las áreas principales de la GUI incluyen:

- **Presentation List**: explorar, abrir y gestionar presentaciones.
- **Media Library**: gestionar los medios compartidos en `_media`.
- **Presentation Builder**: edición visual y herramientas de inserción.
- **Settings**: configuración de la app, plugins, medios y red.
- **Handout View**: renderizado de la presentación apto para impresión.

---

<a id="gui-presentation-list"></a>

## Lista de presentaciones y acciones

Desde la lista de presentaciones normalmente puedes:

- Crear una nueva presentación
- Abrir/presentar una presentación
- Abrir la vista handout
- Abrir el builder/editor
- Mostrar la carpeta de la presentación
- Exportar artefactos (PDF/imágenes/paquete offline)
- Eliminar variantes de presentación o carpetas completas de presentación

---

<a id="gui-opening-revel-files"></a>

## Abrir archivos `.revel`

Al hacer doble clic en un archivo `.revel` (el formato de exportación nativo de REVELation; por dentro es un ZIP, y las exportaciones `.zip` antiguas aún se importan) se abre en la app. También puedes usar **Presentation → Open Presentation**. El instalador registra la extensión `.revel` en Windows, Linux (deb/rpm) y macOS; al desinstalar, se elimina la asociación.

El archivo se extrae a una copia temporal de solo lectura y se muestra en un lightbox sobre la lista de presentaciones. Desde ahí puedes iniciar la presentación, abrir la vista handout, exportarla (por ejemplo a PDF o PowerPoint) sin importarla, o verla en el Builder, que es de solo lectura. **Import to Library** (en el lightbox o en el banner del Builder) la mueve a tu biblioteca como una presentación normal y editable.

Después de importar, los cambios se guardan solo en tu biblioteca local de presentaciones, no en el archivo `.revel` original. Vuelve a exportar la presentación para actualizar el archivo. Cerrar el lightbox sin importar elimina la copia temporal.

Para el diseño del archivo y el tipo MIME, consulta la [especificación del formato `.revel`](dev/REVEL_FORMAT.md); para saber cómo la app abre, importa y registra los archivos, consulta las [notas de implementación](dev/REVEL_IMPLEMENTATION.md).

---

<a id="gui-builder"></a>

## Builder y herramientas de edición

El builder está enfocado en flujos de autoría rápidos:

- Navegación de diapositivas/columnas y herramientas de estructura
- Insertar contenido desde menús (notas, tablas, medios, plantillas de plugins)
- Edición de metadatos y propiedades de la presentación
- Soporte de edición con variantes
- Atajos de vista previa y de inicio de la presentación

Las acciones de inserción del builder son extensibles por plugins, por lo que los plugins instalados pueden agregar creadores de contenido personalizados.

---

<a id="gui-language-variants"></a>

## Variantes de idioma

REVELation admite variantes traducidas de presentación que permanecen vinculadas a un archivo markdown maestro.

Flujo rápido:

1. Construye tu presentación en el idioma maestro en Builder.
2. En Builder, abre `Variants ▾` y elige `Add Variant…`.
3. Ingresa un código de idioma (por ejemplo `es`) para crear un archivo de variante vinculado y oculto.
4. Traduce el contenido de las diapositivas en el archivo de variante.
5. Usa dispositivos peer o `Additional Screens (Virtual Peers)` con ajustes de idioma y luego presiona `Z` durante la presentación para enviar el deck a los peers.

Para detalles completos y sintaxis YAML, consulta [revelation/doc/VARIANTS_REFERENCE.md](../revelation/doc/VARIANTS_REFERENCE.md).

---

<a id="gui-media-library"></a>

## Biblioteca multimedia e importación

Media Library te ayuda a:

- Importar archivos multimedia al `_media` compartido
- Generar y guardar metadatos sidecar
- Previsualizar medios e inspeccionar detalles de atribución/origen
- Eliminar o gestionar recursos multimedia existentes
- Reutilizar los mismos medios en muchas presentaciones

El flujo Add Media también puede importar fuentes externas (incluidos formatos como PDF/PPTX, según la disponibilidad de herramientas y la configuración de plugins).

Para detalles de configuración de la importación de PDF, consulta [doc/dev/README-PDF.md](dev/README-PDF.md).

---

<a id="gui-plugins"></a>

## Plugins en la GUI

Los puntos de integración de plugins en la GUI incluyen:

- Páginas de plugin en la barra lateral/menú
- Acciones de inserción del builder
- Herramientas basadas en diálogo (búsqueda/importación/efectos)
- Configuración y valores de plugins en la configuración de la app

Puedes abrir la carpeta de plugins desde el menú Plugins e instalar paquetes de plugin adicionales (donde sea compatible).

---

<a id="gui-handout-pdf"></a>

## Flujos de handout y PDF

El modo handout ofrece una salida de presentación apta para impresión con controles opcionales:

- Mostrar/ocultar notas
- Mostrar/ocultar imágenes
- Mostrar/ocultar atribuciones
- Comportamiento de los enlaces en los números de diapositiva

---

Flujo típico de PDF:

1. Abre la vista handout.
2. Establece los interruptores de visualización deseados.
3. Usa imprimir/guardar como PDF.

---

<a id="gui-export"></a>

## Flujos de exportación

Rutas comunes de exportación desde la GUI:

- Exportación a PDF
- Exportación de imágenes de diapositivas
- Flujos de paquete offline/exportación

La disponibilidad depende del estado de la presentación, el soporte de plugins y el entorno/herramientas locales.

---

<a id="gui-settings-network"></a>

## Configuración y red

La configuración incluye:

- Preferencias de presentación y medios
- Valores de configuración de plugins
- Opciones de localización/idioma
- Modo de red y ajustes de presentación remota
- Opciones de emparejamiento/descubrimiento de peer presenter

En modo de red se habilita comportamiento adicional (descubrimiento, control remoto, enrutamiento de comandos peer).

Para una referencia de configuración campo por campo, consulta [doc/SETTINGS.md](SETTINGS.md).

---

<a id="api-reference"></a>

## Referencia de la API

REVELation Snapshot Builder incluye un servidor de API opcional para llamar a muchas acciones comunes
desde otros programas (incluidos agentes de IA, software de automatización, StreamDeck, etc.). Debes
habilitar el servidor de API en la pestaña "Networking" de la configuración. Todo acceso al servidor
de API debe hacerse desde localhost y requiere la "Server Access Key" que se genera
y se muestra en esa misma pestaña Network. (Esta es la clave de API).

La referencia completa de la API está aquí: [API_REFERENCE.md](API_REFERENCE.md)


---

<a id="gui-debug-recovery"></a>

## Herramientas de depuración y recuperación

Acciones de mantenimiento integradas útiles:

- Abrir el log de depuración
- Limpiar/restablecer el log de depuración
- Regenerar la presentación de documentación
- Regenerar las miniaturas de temas
- Restablecer toda la configuración y plugins

Para detalles de restablecimiento/desinstalación/rutas de log, consulta [doc/TROUBLESHOOTING.md](TROUBLESHOOTING.md).

---

<a id="gui-gotchas"></a>

## Problemas comunes

- **Problemas de pantalla en Wayland**: en algunas configuraciones Linux, iniciar con el backend X11 es más estable.
- **Comportamiento faltante de un plugin**: verifica que el plugin esté instalado/habilitado y que su configuración esté completa.
- **Medios no resueltos**: confirma que los archivos existan en `_media` y que los alias/rutas coincidan con markdown/front matter.
- **Diferencias de exportación**: las salidas handout/impresión/offline pueden diferir del comportamiento de reveal en vivo según las restricciones de plugin/runtime.
- **Impacto inesperado del restablecimiento**: el restablecimiento elimina los overrides/configuración local; haz primero una copia de seguridad de los datos locales críticos.

Guía de solución de problemas: [doc/TROUBLESHOOTING.md](TROUBLESHOOTING.md).

---

<a id="gui-workflow"></a>

## Flujo recomendado

1. Crea/abre una presentación desde la lista.
2. Importa primero los medios en `_media`.
3. Construye las diapositivas y metadatos en el builder.
4. Previsualiza en modo presentación.
5. Valida la salida handout/PDF.
6. Exporta/comparte según necesites.
