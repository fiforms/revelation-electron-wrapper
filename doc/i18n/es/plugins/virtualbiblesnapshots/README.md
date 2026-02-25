# Plugin Virtual Bible Snapshots

## Tabla de contenidos
* [Resumen](#virtualbiblesnapshots-overview)
* [Qué agrega](#virtualbiblesnapshots-what-it-adds)
* [Cómo funciona](#virtualbiblesnapshots-how-it-works)
* [Configuración](#virtualbiblesnapshots-configuration)

---

<a id="virtualbiblesnapshots-overview"></a>
## Resumen

Este plugin se integra con el 
[Proyecto Virtual Bible Snapshot](https://snapshots.vrbm.org/), permitiendo al usuario buscar e importar recursos directamente a presentaciones o a la biblioteca compartida de medios.

La [colección Virtual Bible Snapshots](https://snapshots.vrbm.org/)
incluye más de 10,000 recursos visuales enfocados en la Biblia para enseñanza y predicación, incluyendo:

- Fondos en movimiento
- Imágenes generadas con IA
- Fotografías de Tierra Santa
- Otros recursos multimedia para clases bíblicas, sermones y diapositivas

---

<a id="virtualbiblesnapshots-what-it-adds"></a>
## Qué agrega

- Diálogo de búsqueda para medios VRBM
- Descarga en la presentación actual o en `_media`
- Generación de metadatos sidecar (atribución, licencia, banderas de IA, URLs de origen)
- Manejo opcional de variantes de alta tasa de bits
- Soporte del flujo del builder para inserción directa mientras se editan diapositivas

---

Opciones de importación:

- Importar directamente en `_media` (biblioteca compartida) para reutilización
- Importar directamente en la presentación actual para flujos rápidos de construcción de diapositivas

---

<a id="virtualbiblesnapshots-how-it-works"></a>
## Cómo funciona

El plugin consulta endpoints remotos de catálogo, permite seleccionar recursos, descarga archivos, guarda metadatos e inserta referencias markdown/medios en la presentación objetivo.

---

<a id="virtualbiblesnapshots-configuration"></a>
## Configuración

Ajustes clave:

- `apiBase`: URL base de API de Virtual Bible Snapshot
- `libraries`: rutas remotas de biblioteca separadas por comas
- `downloadIntoMedia`: guardar en `_media` y usar alias
