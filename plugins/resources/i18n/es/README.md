# Plugin Resources

## Tabla de contenidos
* [Resumen](#resources-overview)
* [Qué agrega](#resources-what-it-adds)

<a id="resources-overview"></a>
## Resumen

El plugin Resources agrega una página de ayuda estática a la barra lateral de plugins: una pestaña Acerca de REVELation, además de las pestañas Images & Media y Text & Editors, que enumeran herramientas y sitios externos. No administra ni adjunta archivos a las presentaciones. Las variantes localizadas (`index.<lang>.html`, actualmente `es` y `fr`) se eligen automáticamente según el idioma de la app o `?lang=`.

<a id="resources-what-it-adds"></a>
## Qué agrega

- Un botón de plugin "Resources" que abre `index.html` (las pestañas las gestiona `resources.js`)
- Sin hook de cliente, canales IPC ni configuración; los enlaces externos se abren mediante `electronAPI.openExternalURL`

Este plugin es intencionalmente liviano y está enfocado principalmente en enrutamiento de UI.
