# Plugin Bible Text

## Tabla de contenidos
* [Resumen](#bibletext-overview)
* [Qué agrega](#bibletext-what-it-adds)
* [Cómo funciona](#bibletext-how-it-works)
* [Diapositiva de versículo bíblico en vivo](#bibletext-live-verse)
* [Carga de Biblias XML locales](#bibletext-local-xml)
* [Configuración de clave API ESV](#bibletext-esv-api-key)
* [Configuración](#bibletext-configuration)

---

<a id="bibletext-overview"></a>
## Resumen

El plugin Bible Text busca e inserta pasajes bíblicos como diapositivas markdown con formato.
Por sí solo no requiere ni habilita ninguna función de colaboración con espectadores.

---

<a id="bibletext-what-it-adds"></a>
## Qué agrega

- Diálogo de búsqueda de pasajes en el builder
- Selección de traducción (local y en línea)
- Formato de pasajes con texto de versículos y referencias
- Líneas de atribución para escritura insertada
- Una barra lateral **lector de la Biblia** para explorar/buscar traducciones locales por capítulo

---

<a id="bibletext-how-it-works"></a>
## Cómo funciona

El plugin puede leer datos bíblicos locales (traducciones `*.local`) y también consultar APIs en línea. Después de obtener los versículos, da formato al markdown y lo agrega al archivo de presentación seleccionado.

---

<a id="bibletext-live-verse"></a>
## Diapositiva de versículo bíblico en vivo

Mostrar un versículo en vivo en la pantalla durante un servicio (la diapositiva dinámica `:bibleverse:`,
los botones "presentar" de la barra lateral del lector y la entrega por Socket.IO) es un **plugin
independiente y opcional: [Live Bible Text](../../../bibletext-live/i18n/es/README.md)**. Se separó de este plugin
porque es una función de colaboración con espectadores: cualquiera que tenga el enlace de la presentación puede cambiar
lo que muestra cada diapositiva de versículo en vivo. Habilítalo en Settings si quieres esa función; las
funciones de búsqueda/inserción de esta página funcionan sin él.

La barra lateral del lector de la Biblia aquí sigue mostrando botones "presentar" por versículo, pero están deshabilitados
(con una nota) hasta que se habilite el plugin Live Bible Text.

---

<a id="bibletext-local-xml"></a>
## Carga de Biblias XML locales

Para agregar archivos XML de biblias locales:

1. En la app, abre el menú **Plugins**.
2. Haz clic en **Open Plugins Folder...**
3. Abre la carpeta del plugin `bibletext`.
4. Copia tus archivos `.xml` de biblia local (también se leen `.xml.gz` y `.json`) en la carpeta de almacenamiento de biblias de ese plugin.
5. Reinicia la app para que se detecten las nuevas traducciones locales.

Una vez cargadas, las traducciones locales aparecen en la lista de traducciones con un id `.local`.

---

<a id="bibletext-esv-api-key"></a>
## Configuración de clave API ESV

Para habilitar acceso directo en línea a ESV:

1. Ve a [esv.org](https://www.esv.org/) y crea una cuenta o inicia sesión.
2. Visita el área de API de ESV y genera una clave API.
3. Abre **Settings** de la app REVELation.
4. Ve a la configuración del plugin Bible Text.
5. Pega la clave en `esvApiKey`.
6. Guarda la configuración.

Después de esto, ESV estará disponible como opción de traducción en línea en el diálogo Bible Text.

---

<a id="bibletext-configuration"></a>
## Configuración

Ajustes clave:

- `defaultTranslation` (predeterminado `KJV.local`): id de traducción predeterminada
- `bibleAPI` (predeterminado `https://bible-api.com`): URL base de la API en línea (`none` desactiva las llamadas en línea)
- `esvApiKey` (predeterminado vacío): clave opcional para acceso a la API de ESV. Se almacena como secreto y no se expone al navegador.

El plugin también agrega un botón **Bible Text** (`read.html`, el lector de la Biblia) a los botones de plugins.

### API HTTP

Cuando el servidor de API local está habilitado (Settings > Networking), el plugin registra rutas de solo lectura bajo
`/api/bibletext/`: `passage`, `translations`, `books`, `chapter` y `search`. Consulta
[API_REFERENCE.md](../../../../doc/i18n/es/API_REFERENCE.md) para ver los parámetros.
