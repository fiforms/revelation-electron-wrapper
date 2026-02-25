# Plugin Bible Text

## Tabla de contenidos
* [Resumen](#bibletext-overview)
* [Qué agrega](#bibletext-what-it-adds)
* [Cómo funciona](#bibletext-how-it-works)
* [Carga de Biblias XML locales](#bibletext-local-xml)
* [Configuración de clave API ESV](#bibletext-esv-api-key)
* [Configuración](#bibletext-configuration)

---

<a id="bibletext-overview"></a>
## Resumen

El plugin Bible Text busca e inserta pasajes bíblicos como diapositivas markdown con formato.

---

<a id="bibletext-what-it-adds"></a>
## Qué agrega

- Diálogo de búsqueda de pasajes en el builder
- Selección de traducción (local y en línea)
- Formato de pasajes con texto de versículos y referencias
- Líneas de atribución para escritura insertada

---

<a id="bibletext-how-it-works"></a>
## Cómo funciona

El plugin puede leer datos bíblicos locales (traducciones `*.local`) y también consultar APIs en línea. Después de obtener los versículos, da formato al markdown y lo agrega al archivo de presentación seleccionado.

---

<a id="bibletext-local-xml"></a>
## Carga de Biblias XML locales

Para agregar archivos XML de biblias locales:

1. En la app, abra el menú **Plugins**.
2. Haga clic en **Open Plugins Folder...**
3. Abra la carpeta del plugin `bibletext`.
4. Copie sus archivos `.xml` de biblia local en la carpeta de almacenamiento de biblias de ese plugin.
5. Reinicie la app para que se detecten las nuevas traducciones locales.

Una vez cargadas, las traducciones locales aparecen en la lista de traducciones con un id `.local`.

---

<a id="bibletext-esv-api-key"></a>
## Configuración de clave API ESV

Para habilitar acceso directo en línea a ESV:

1. Vaya a [esv.org](https://www.esv.org/) y cree/inicie sesión en su cuenta.
2. Visite el área de API de ESV y genere una clave API.
3. Abra **Settings** de la app REVELation.
4. Vaya a la configuración del plugin Bible Text.
5. Pegue la clave en `esvApiKey`.
6. Guarde la configuración.

Después de esto, ESV estará disponible como opción de traducción en línea en el diálogo Bible Text.

---

<a id="bibletext-configuration"></a>
## Configuración

Ajustes clave:

- `defaultTranslation`: id de traducción predeterminada
- `bibleAPI`: URL base de API en línea (`none` desactiva llamadas en línea)
- `esvApiKey`: clave opcional para acceso a API ESV
