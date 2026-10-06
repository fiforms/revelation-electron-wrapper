# REVELation Snapshot Presenter

---

`revelation-electron-wrapper` es la aplicación de escritorio Electron multiplataforma para [REVELation Snapshot Presenter](https://github.com/fiforms/revelation).

Envuelve el framework principal de REVELation con una experiencia de app local: gestión de presentaciones, edición de metadatos y markdown, flujos de medios, controles de red/emparejamiento y herramientas de exportación.

---

## 📦 Descargar e instalar

**Recomendado para la mayoría de usuarios**  
Descarga la versión más reciente desde la [página de Releases](https://github.com/fiforms/revelation-electron-wrapper/releases) para Windows, Linux y OSX.

Solo ejecuta el instalador y listo.

Notas de solución de problemas (incluye orientación de arranque Wayland/X11):

* [doc/TROUBLESHOOTING.md](doc/TROUBLESHOOTING.md)

---

## 👨‍💻 Configuración para desarrolladores (o instalación manual)

Si eres desarrollador o prefieres compilar desde código fuente:

* [doc/dev/INSTALLING.md](doc/dev/INSTALLING.md)

---

## 💡 Alcance del proyecto

Este repositorio es responsable del wrapper de escritorio y la UX de la app. Hace lo siguiente:

* Inicia un servidor local de Vite para servir presentaciones basadas en Reveal.js
* Inicia un servidor Reveal.js Remote para control remoto y múltiples pantallas
* Abre una ventana completa de Electron apuntando al servidor local
* Proporciona flujos GUI para edición, importación de medios y exportación
* Empaqueta recursos del wrapper y del framework para uso empaquetado/sin conexión

La sintaxis principal de autoría markdown, el procesamiento de macros y los internos del framework viven en el submódulo `revelation/`.

---

## 🧩 Acerca del framework REVELation

El submódulo incluido `revelation/` es un framework modular para construir y presentar diapositivas Reveal.js basadas en Markdown.

---

Para usuarios que instalan `revelation-electron`, este es el motor detrás de la experiencia de la aplicación:

* Autoría markdown extendida (front matter, macros, utilidades de diapositivas, atribuciones)
* Soporte para diapositivas ricas en medios (fondos, alias y referencias reutilizables de medios)
* Integración del runtime de Reveal.js con flujos remotos y de handout
* Presentaciones basadas en archivos, fáciles de versionar y compartir

Si quieres la visión general completa del framework y un flujo de trabajo directo centrado en el framework, consulta:
* [revelation/README.md](revelation/README.md)

---

## 📚 Documentación

Documentación del wrapper (este repositorio):

* [doc/GUI_REFERENCE.md](doc/GUI_REFERENCE.md) - flujos de GUI y comportamiento del wrapper orientado al usuario
* [doc/SETTINGS.md](doc/SETTINGS.md) - referencia campo por campo de la pantalla de configuración
* [doc/TROUBLESHOOTING.md](doc/TROUBLESHOOTING.md) - notas de solución de problemas en ejecución (incluye Wayland/X11)
* [doc/dev/INSTALLING.md](doc/dev/INSTALLING.md) - instalación manual/para desarrolladores desde código fuente
* [doc/MACOS_INSTALL.md](doc/MACOS_INSTALL.md) - instalación en macOS
* [doc/API_REFERENCE.md](doc/API_REFERENCE.md) - API de control local (puerto 8900)
* [doc/BUILDER_REFERENCE.md](doc/BUILDER_REFERENCE.md) - referencia de usuario del constructor de presentaciones

---

* [doc/dev/PLUGINS.md](doc/dev/PLUGINS.md) - hooks de plugins usados por el pipeline de builder/exportación
* [doc/dev/PEERING.md](doc/dev/PEERING.md) - comportamiento de descubrimiento y emparejamiento
* [doc/dev/README-PDF.md](doc/dev/README-PDF.md) - configuración de importación de PDF (Poppler) para Add Media
* [doc/dev/BUILDING.md](doc/dev/BUILDING.md) - instrucciones de empaquetado y construcción de instaladores
* [doc/dev/BUILDER.md](doc/dev/BUILDER.md) - internos del módulo builder
* [doc/dev/BUILDER_EXTENSIONS.md](doc/dev/BUILDER_EXTENSIONS.md) - guía para autores de plugins sobre cómo extender el builder
* [doc/dev/PUBLIC_RELAY.md](doc/dev/PUBLIC_RELAY.md) - servidor de relé público para emparejamiento remoto
* [doc/dev/REVEL_FORMAT.md](doc/dev/REVEL_FORMAT.md) - formato de archivo `.revel`
* [doc/dev/REVEL_IMPLEMENTATION.md](doc/dev/REVEL_IMPLEMENTATION.md) - cómo se implementa la importación/exportación de `.revel`

---

Documentación del framework (submódulo):

* [revelation/README.md](revelation/README.md) - visión general del framework, inicio rápido y resumen de funciones
* [revelation/doc/REFERENCE.md](revelation/doc/REFERENCE.md) - índice principal de la documentación del framework
* [revelation/doc/AUTHORING_REFERENCE.md](revelation/doc/AUTHORING_REFERENCE.md) - extensiones de sintaxis para autoría markdown
* [revelation/doc/METADATA_REFERENCE.md](revelation/doc/METADATA_REFERENCE.md) - front matter YAML, macros, alias de medios
* [revelation/doc/ARCHITECTURE.md](revelation/doc/ARCHITECTURE.md) - arquitectura del framework y modelo de extensión

---

La sintaxis y los comportamientos específicos de plugins se documentan en archivos README locales de cada plugin (por ejemplo, [plugins/revealchart/README.md](plugins/revealchart/README.md)).

---

## 🛠 Construir un instalador

Consulta [doc/dev/BUILDING.md](doc/dev/BUILDING.md) para más detalles.

---

## 🔗 Proyectos relacionados

* 📽️ [REVELation Framework](https://github.com/fiforms/revelation) — Sistema modular de Reveal.js con temas controlados por YAML, macros e integración de medios.

---

## 📜 Licencia

Este software en sí está licenciado bajo una licencia permisiva estilo MIT. Sin embargo, la versión distribuida del proyecto incluye software licenciado
bajo otras licencias más restrictivas, como GNU General Public License (GPL) y GNU LGPL, lo que impone algunas restricciones
sobre cómo puedes redistribuirlo. En particular, debe incluir algún aviso como este con un enlace a la licencia y debes poner
a disposición el código fuente.

Consulta [LICENSE.md](LICENSE.md) para más detalles.
