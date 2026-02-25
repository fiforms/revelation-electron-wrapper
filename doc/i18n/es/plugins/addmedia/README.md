# Plugin Add Media

## Tabla de contenidos
* [Resumen](#addmedia-overview)
* [Qué agrega](#addmedia-what-it-adds)
* [Cómo funciona](#addmedia-how-it-works)
* [Configuración](#addmedia-configuration)

<a id="addmedia-overview"></a>
## Resumen

El plugin Add Media proporciona herramientas de importación para agregar contenido externo a presentaciones.

<a id="addmedia-what-it-adds"></a>
## Qué agrega

- Importar archivos multimedia a una presentación o a la biblioteca `_media`
- Agregar diapositivas de PowerPoint (`.pptx`) como imágenes
- Agregar páginas PDF como imágenes/diapositivas (mediante herramientas Poppler)
- Insertar markdown generado y alias de medios en el front matter

<a id="addmedia-how-it-works"></a>
## Cómo funciona

El plugin abre diálogos modales desde el builder, permite al usuario elegir archivos, luego copia o convierte recursos y agrega markdown al archivo de presentación de destino.

También lee notas de diapositiva desde archivos PowerPoint y puede incluir esas notas en el markdown generado.

<a id="addmedia-configuration"></a>
## Configuración

Ajustes opcionales del plugin:

- `pdftoppmPath`: ruta a Poppler `pdftoppm`
- `pdfinfoPath`: ruta a Poppler `pdfinfo`

Si no se establecen, el plugin intenta usar los nombres de comando desde `PATH`.
