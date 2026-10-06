# Plugin Test

## Tabla de contenidos
* [Resumen](#test-overview)
* [Qué agrega](#test-what-it-adds)
* [Cómo funciona](#test-how-it-works)

<a id="test-overview"></a>
## Resumen

El plugin Test es un plugin simple de ejemplo/depuración usado para validar hooks de plugins.

---

<a id="test-what-it-adds"></a>
## Qué agrega

- Un elemento de menú "Example Test Plugin" en Plugins
- Un disparador de API de ejemplo `example-echo`
- Ejemplos de la API de extensión del builder cuando se abre en Presentation Builder:
  - Acción de barra de herramientas (`registerToolbarAction`)
  - Panel del builder (`registerPanel`)
  - Superposición de vista previa (`registerPreviewOverlay`)
  - Botón de alternar modo (`registerMode`)
  - Demostraciones de transacciones mediante `host.transact(...)`
  - Suscripciones a eventos (`selection:changed`, `preview:slidechanged`, `save:after`)

<a id="test-how-it-works"></a>
## Cómo funciona

Se registra al inicio, agrega una entrada de menú y registra acciones cuando se usa el elemento de menú o el disparador de API.
En la página del builder expone `getBuilderExtensions(...)` cargando `builder.js` de forma diferida con `import()` dinámico.
Así el código exclusivo del builder queda fuera del análisis normal del presentador/sesión.
