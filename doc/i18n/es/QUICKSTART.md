# Bienvenido a REVELation Snapshot Presenter

REVELation Snapshot Presenter te ayuda a crear y presentar diapositivas hermosas y ricas en medios sin necesidad de conocimientos de desarrollo web.

Combina una app de escritorio amigable, autoría basada en markdown y un motor de presentaciones Reveal.js flexible.

---

## Un tipo diferente de herramienta de presentación

La mayoría del software de presentaciones trata las diapositivas como un **lienzo visual**: colocas cuadros, eliges fuentes y arrastras elementos.

REVELation trata tu presentación como un **documento estructurado** que además se ejecuta en vivo.

---

- Escribe en Markdown simple: versionable y compartible como texto
- Tu presentación es una URL en vivo, un handout *y* una página web
- Las variantes de idioma vinculadas permiten que una misma presentación llegue a audiencias multilingües
- Los fondos en movimiento persisten entre diapositivas sin volver a aplicarlos en cada una
- Un sistema de plugins extiende la autoría, los medios y el contenido, sin bifurcar la app

---

## Cómo nos comparamos

|  | **REVELation** | PowerPoint | Keynote | Proclaim | ProPresenter | FreeShow |
|--|:-:|:-:|:-:|:-:|:-:|:-:|
| Diseño centrado en contenido/documento | ✓ | ~ | ✗ | ✗ | ✗ | ✗ |
| Vista de handout estructurada (con notas) | ✓ | ~ | ~ | ✗ | ✗ | ✗ |
| Formato abierto de texto plano (Markdown) | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Código abierto y gratuito | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ |
| Fondos en movimiento entre diapositivas | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ |
| Publicación web (como página o documento) | ✓ | ~ | ~ | ✗ | ✗ | ✗ |
| Integración con CMS / WordPress | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Soporte de variantes multilingües | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Contenido de Biblia e himnos (plugin) | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ |
| Sistema de plugins extensible | ✓ | ~ | ✗ | ✗ | ✗ | ✗ |

*~ = soporte parcial o limitado*

---

## Enlaces rápidos

* [Página principal del proyecto](https://snapshots.vrbm.org/revelation-snapshot-presenter/)
  * Tutoriales en video y más
* [Proyecto en GitHub](https://github.com/fiforms/revelation-electron-wrapper)
* [Guía de usuario de la GUI](doc/GUI_REFERENCE.md)

---

## Tabla de contenidos

* Básico
  * [Primeros pasos (Guía de usuario de la GUI)](doc/GUI_REFERENCE.md)
  * [Autoría de diapositivas en Markdown](revelation/doc/AUTHORING_REFERENCE.md)
  * [Metadatos y macros de presentaciones](revelation/doc/METADATA_REFERENCE.md)
  * [Solución de problemas](doc/TROUBLESHOOTING.md)
  * [Documentación del framework REVELation](revelation/doc/REFERENCE.md)
  * [README del proyecto](README.md)

---

## Plugins populares

* [Reveal Chart](plugins/revealchart/README.md) - Agrega bloques de gráficos y tablas desde datos, incluidas diapositivas basadas en CSV.
* [Bible Text](plugins/bibletext/README.md) - Inserta pasajes bíblicos con soporte de traducción (local y en línea).
* [Live Bible Text](plugins/bibletext-live/README.md) - Complemento opcional de Bible Text: envía un versículo a una diapositiva en vivo durante un servicio.
* [Hymnary](plugins/hymnary/README.md) - Busca en Hymnary.org e importa letras de himnos como markdown listo para diapositivas.
* [Adventist Hymns](plugins/adventisthymns/README.md) - Extrae himnos de AdventistHymns.com directamente en presentaciones.

---

* [Virtual Bible Snapshots](plugins/virtualbiblesnapshots/README.md) - Explora e importa recursos visuales bíblicos (fondos en movimiento, arte con IA, fotos).
* [MediaFX](plugins/mediafx/README.md) - Aplica efectos de video, presets y flujos de redimensionado para medios de presentación.
* [Reveal Charts](plugins/revealchart/README.md) - Agrega tablas y gráficos dinámicos a tus presentaciones.
* [Highlight](plugins/highlight/README.md) - Mejora la legibilidad de diapositivas de código con temas de resaltado de sintaxis.

---

**[Lista completa de plugins y referencia](doc/PLUGIN_INDEX.md)**


---

## Tabla de contenidos

* Documentación para desarrolladores
  * [Instalación desde NPM](doc/dev/INSTALLING.md)
  * [Guía de compilación y empaquetado](doc/dev/BUILDING.md)
  * [Arquitectura del framework](revelation/doc/ARCHITECTURE.md)
  * [Descripción general del desarrollo de plugins](doc/dev/PLUGINS.md)
  * [Protocolo de emparejamiento Maestro / Seguidor](doc/dev/PEERING.md)

---

## Lo que puedes hacer

* Crear presentaciones con markdown y macros reutilizables
* Agregar imágenes, video y audio rápidamente
* Gestionar presentaciones y medios desde una GUI de escritorio
* Exportar para handouts, compartición sin conexión y presentaciones en vivo
* Extender el comportamiento con plugins

---

## Flujo de trabajo típico

1. Instala y abre REVELation Snapshot Presenter.
2. Crea una presentación desde la aplicación.
3. Agrega medios a tu biblioteca.
4. Escribe diapositivas en markdown.
5. Presenta en vivo o exporta para compartir.

---

## Siguiente paso

Abre la [Guía del proyecto](README.md) para ver la configuración completa y la estructura de documentación.
