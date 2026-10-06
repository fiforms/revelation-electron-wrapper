# Plugin Flickr

Explora [Flickr](https://www.flickr.com) dentro de una ventana de navegador integrada e
importa las fotos descargadas directamente a la biblioteca de medios compartida (`_media`), con
los metadatos completados automáticamente.

> **Las licencias varían.** A diferencia de una fuente solo CC0, las fotos de Flickr tienen muchas licencias
> distintas (Todos los derechos reservados, las diversas licencias Creative Commons, CC0,
> Dominio Público). El plugin extrae la licencia de cada foto (nunca asume una),
> para que puedas respetar los términos del fotógrafo antes de usar una imagen.

---

## Cómo funciona

1. Aparece un botón **📷 Flickr** en la barra lateral (bajo *Plugins*). Haz clic en él para
   abrir el navegador integrado en `https://www.flickr.com/explore`. El botón usa
   el hook de acción `pluginButtons` del núcleo, `{ title, action: 'open-explorer' }`,
   que llama directamente al método `open-explorer` de la api del plugin (sin navegación de página).
2. El navegador usa una partición de sesión persistente (`persist:flickr`), por lo que conservas
   tu sesión iniciada entre sesiones de uso. La autenticación mediante Flickr/SmugMug y las opciones de inicio de sesión de
   **Google / Apple / Facebook** se ejecuta dentro del navegador integrado
   (incluidas las ventanas emergentes). Cualquier otro enlace externo al sitio se abre en tu navegador del sistema.
3. Cuando descargas una foto, el archivo se captura automáticamente y se importa a
   la biblioteca de medios. Una notificación confirma la importación y muestra la licencia detectada.

---

## Extracción de metadatos

Para una foto descargada, el plugin registra:

| Campo         | Fuente                                                            |
|---------------|-------------------------------------------------------------------|
| Title         | JSON-LD `name` / `og:title` / título de la página                 |
| Attribution   | Fotógrafo: autor en JSON-LD, elemento con el nombre del propietario, o `/photos/<user>/` |
| License       | Enlace de Creative Commons en la página (asignado a, p. ej., `CC BY-SA 2.0`), `license` de JSON-LD, o "All Rights Reserved" |
| Description   | JSON-LD `description` / `og:description` / `meta[name=description]` |
| url_direct    | La URL de descarga de `staticflickr.com`                          |
| url_origin    | La URL de la página de la foto en Flickr                          |

---

La detección es heurística. Si el marcado de Flickr cambia, puedes fijar selectores
CSS exactos en **Configuración → Flickr**:

- `titleSelector`
- `descriptionSelector`
- `attributionSelector`
- `licenseSelector`

Déjalos en blanco para usar la detección automática.

## Habilitación

Habilita **Flickr** en **Configuración → Plugins** y luego reinicia la aplicación.
