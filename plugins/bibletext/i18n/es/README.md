# Plugin Bible Text

## Tabla de contenidos
* [Resumen](#bibletext-overview)
* [Qué agrega](#bibletext-what-it-adds)
* [Cómo funciona](#bibletext-how-it-works)
* [Diapositiva de versículo bíblico en vivo](#bibletext-live-verse)
* [Descarga de más Biblias](#bibletext-downloads)
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
- Un botón **Derechos de autor** en el lector que muestra la información de derechos de autor y de origen de la traducción abierta

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

<a id="bibletext-downloads"></a>
## Descarga de más Biblias

Una versión de lanzamiento incluye solo la Versión Rey Jacobo (King James). Las demás traducciones se descargan cuando las pides:

- **Configuración inicial:** el paso *Traducciones Bíblicas* muestra los grupos de idiomas de la colección como casillas con un botón **Descargar las Biblias Seleccionadas**, además de un botón **Descargar la Biblia NET**.
- **En cualquier momento:** el botón **Descargas de Biblias**, arriba a la derecha del lector de Texto Bíblico, abre las mismas dos descargas.
- **Desarrolladores:** `npm run fetch-blobs` descarga toda la colección en la carpeta `bibles/` de este plugin.

**Colección de Biblias** descarga las traducciones del manifiesto de Biblias de pastordaniel.net, por grupo de idioma: *Inglés*, *Español*, *Idiomas Antiguos* (hebreo y griego) y *Otros Idiomas*. Cada grupo indica cuántas Biblias y cuántos MB contiene, y se marcan primero los grupos que coinciden con el idioma de la interfaz (inglés, y además español en una interfaz en español). Los grupos ya descargados aparecen marcados, así que puedes volver más tarde por otro. Cada archivo se verifica con su SHA-256 antes de conservarlo, así que una descarga dañada o alterada se rechaza.

Los grupos vienen del manifiesto, no de la app: `bibles/make-manifest.js` asigna un grupo a cada archivo (según el `<language>` del archivo, o un `groups.json` opcional), de modo que un grupo nuevo como `portuguese` aparece para los usuarios sin publicar una nueva versión de la app.

**Biblia NET** se descarga directamente de eBible.org (USFM) y se convierte a nuestro formato XML en tu computadora (`NET.xml`; solo versículos, sin las notas de los traductores). La NET es © Biblical Studies Press, L.L.C. Es gratuita para el estudio personal y el ministerio sin fines de lucro, las citas deben terminar con "(NET)" y no debe incluirse junto con nada que se venda; consulta [netbible.com/copyright](https://netbible.com/copyright/). REVELation nunca redistribuye el texto de la NET: va del sitio del editor a tu disco.

Las descargas se guardan en la carpeta `bibles` de la carpeta de datos de usuario de la app (junto a tu configuración), no en la carpeta del plugin, por lo que sobreviven a las actualizaciones y no requieren permiso de escritura en la instalación. El plugin lee ambas carpetas y detecta una descarga nueva de inmediato; no hace falta reiniciar.

**Instalar Módulo de Biblia XML** (en la misma página) agrega un archivo de Biblia que ya tienes. Abre un explorador de archivos para un módulo XML Zefania (`.xml` o `.xml.gz`), comprueba que realmente es una Biblia con texto, lo copia a la misma carpeta `bibles` de los datos de usuario y reconstruye la lista. Se rechaza un archivo cuyo identificador de traducción ya está instalado (el cargador ignoraría uno de los dos), e instalar de nuevo un archivo con el mismo nombre lo reemplaza.

La lista se reconstruye después de cada descarga, incluida la configuración inicial y una descarga que solo tuvo éxito en parte, por lo que una Biblia nueva aparece sin reiniciar la app.

La **ESV** no se descarga: se consulta en línea con tu propia clave API (ver más abajo).

---

<a id="bibletext-local-xml"></a>
## Carga de Biblias XML locales

Para agregar archivos XML de biblias locales:

1. En la app, abre el menú **Plugins**.
2. Haz clic en **Open Plugins Folder...**
3. Abre la carpeta del plugin `bibletext`.
4. Copia tus archivos `.xml` de biblia local (también se leen `.xml.gz` y `.json`) en la carpeta de almacenamiento de biblias de ese plugin.
5. Reinicia la app para que se detecten las nuevas traducciones locales.

También se leen los archivos de la carpeta `bibles` de la carpeta de datos de usuario (donde van las descargas, ver arriba).

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
