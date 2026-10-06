# Plugin Adventist Hymns

## Tabla de contenidos
* [Resumen](#adventisthymns-overview)
* [Qué agrega](#adventisthymns-what-it-adds)
* [Cómo funciona](#adventisthymns-how-it-works)

---

<a id="adventisthymns-overview"></a>
## Resumen

El plugin Adventist Hymns convierte himnos en markdown listo para diapositivas. Carga un índice de himnos (en caché durante 24 h) y letras de dominio público desde `pastordaniel.net/bigmedia/adventisthymns`, y extrae otros himnos de AdventistHymns.com.

---

<a id="adventisthymns-what-it-adds"></a>
## Qué agrega

- Un diálogo de búsqueda de himnos en la app
- Análisis automático de diapositivas de himnos desde HTML fuente
- Generación de diapositiva de título + diapositivas de estrofa/estribillo
- Opción de agregado directo al markdown activo de la presentación

---

<a id="adventisthymns-how-it-works"></a>
## Cómo funciona

El plugin abre su UI de búsqueda, obtiene páginas de himnos, analiza secciones de diapositivas y convierte el contenido en markdown separado para diapositivas Reveal.
