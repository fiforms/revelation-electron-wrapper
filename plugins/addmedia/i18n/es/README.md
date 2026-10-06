# Plugin Add Media

## Tabla de contenidos
* [Resumen](#addmedia-overview)
* [Qué agrega](#addmedia-what-it-adds)
* [Cómo funciona](#addmedia-how-it-works)
* [Programas externos](#addmedia-dependencies)
* [API HTTP](#addmedia-api)
* [Configuración](#addmedia-configuration)

<a id="addmedia-overview"></a>
## Resumen

El plugin Add Media proporciona herramientas de importación para agregar contenido externo a presentaciones.

---

<a id="addmedia-what-it-adds"></a>
## Qué agrega

- Importar archivos multimedia a una presentación o a la biblioteca `_media`
- Importar archivos de audio (`mp3`, `ogg`, `webm`, `wav`, `m4a`, `aac`, `opus`) e insertar diapositivas `:audio:play:` / `:audio:playloop:`
- Importación por arrastrar y soltar de imágenes, video y audio en el builder, además de importación masiva de imágenes desde una carpeta o al soltarlas
- Elegir elementos de la biblioteca de medios compartida
- Agregar diapositivas de PowerPoint (`.pptx`) como imágenes (convertidas mediante LibreOffice)
- Agregar páginas PDF como imágenes/diapositivas (mediante herramientas Poppler)
- Insertar markdown generado y alias de medios en el front matter

---

<a id="addmedia-how-it-works"></a>
## Cómo funciona

El plugin abre diálogos modales desde el builder, permite al usuario elegir archivos, luego copia o convierte recursos y agrega markdown al archivo de presentación de destino.

También lee notas de diapositiva desde archivos PowerPoint y puede incluir esas notas en el markdown generado.

Tipos de imagen que se pueden soltar: `jpg`, `jpeg`, `png`, `webp`, `gif`, `bmp`. Tipos de video que se pueden soltar: `mp4`, `webm`, `mov`, `m4v`, `ogv`, `mkv`.
Las importaciones masivas van a carpetas numeradas `image_import_NN` y `pdf_import_NN` dentro de la presentación.

---

<a id="addmedia-dependencies"></a>
## Programas externos

- **Poppler** (`pdftoppm`, `pdfinfo`) para las páginas PDF. Consulta [README-PDF.md](../../../../doc/i18n/es/dev/README-PDF.md).
- **LibreOffice** para convertir archivos PowerPoint a PDF antes de renderizar las páginas. `lib/libreofficeResolver.js` lo localiza; instálalo si la importación de PowerPoint informa que falta.

<a id="addmedia-api"></a>
## API HTTP

Cuando el servidor de API local está habilitado, el plugin agrega rutas bajo `/api/addmedia/`:

- `GET /api/addmedia/search?query=...` lista los elementos de la biblioteca de medios que coinciden (título, fragmento de descripción, palabras clave).
- `GET /api/addmedia/item?filename=...` devuelve un fragmento YAML para pegar bajo `media:` en el front matter.

---

<a id="addmedia-configuration"></a>
## Configuración

Ajustes opcionales del plugin:

- `pdftoppmPath`: ruta a Poppler `pdftoppm`
- `pdfinfoPath`: ruta a Poppler `pdfinfo`

Si no se establecen, el plugin intenta usar los nombres de comando desde `PATH`.
