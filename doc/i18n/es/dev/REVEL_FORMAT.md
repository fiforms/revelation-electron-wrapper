# El formato de archivo `.revel`

**Estado:** especificación del formato tal como lo escribe REVELation Snapshot Presenter. La
versión de un archivo es el `appVersion` de su `manifest.json`; consulta la [sección 9](#9-versionado-y-compatibilidad).

Un archivo `.revel` empaqueta una presentación de REVELation, sus variantes de idioma y,
opcionalmente, sus medios en un solo archivo para compartir, archivar y transferir entre aplicaciones.
Este documento especifica el contenedor y sus metadatos para que otras aplicaciones puedan leerlo y escribirlo.

---

Deliberadamente **no** especifica el lenguaje de presentación en sí. Un archivo `.revel` contiene
Markdown con front matter YAML; la sintaxis y el significado de ese contenido los define la
especificación de Markdown de REVELation:

- [revelation/doc/AUTHORING_REFERENCE.md](../revelation/doc/AUTHORING_REFERENCE.md): sintaxis extendida de Markdown, macros, alias de medios
- [revelation/doc/METADATA_REFERENCE.md](../revelation/doc/METADATA_REFERENCE.md): esquema del front matter YAML
- [revelation/doc/REFERENCE.md](../revelation/doc/REFERENCE.md): índice de la documentación del framework

Cómo exporta, importa, abre, registra y protege la propia aplicación REVELation los archivos `.revel`
se describe por separado en [REVEL_IMPLEMENTATION.md](REVEL_IMPLEMENTATION.md). Nada de lo que
contiene ese documento se exige a otras implementaciones.

Las palabras clave MUST, MUST NOT, SHOULD, SHOULD NOT y MAY (en esta traducción: DEBE, NO DEBE,
DEBERÍA, NO DEBERÍA y PUEDE) se usan como en
[RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

---

## 1. Identificación

| | |
|---|---|
| Extensión de archivo | `.revel` |
| Tipo de medio | `application/vnd.revelation.presentation+zip` |
| UTI de macOS | `com.revelation.snapshot.presentation`, conforme a `public.zip-archive` |
| Sintaxis estructurada | ZIP (el sufijo `+zip`, [RFC 6839](https://www.rfc-editor.org/rfc/rfc6839)) |

El tipo de medio no está registrado en IANA. El formato no tiene un número mágico propio: un archivo
`.revel` comienza con la firma ZIP y se identifica por su extensión o tipo de medio.

Un archivo creado antes de que existiera el nombre `.revel` es un `.zip` común con la misma estructura.
Los lectores DEBERÍAN aceptar esos archivos.

---

## 2. Contenedor

- El archivo DEBE ser un archivo ZIP según lo define el APPNOTE de PKWARE. Las entradas DEBERÍAN
  almacenarse con deflate o store.
- No se admiten entradas cifradas ni archivos de varios volúmenes.
- Los nombres de entrada DEBEN ser rutas relativas que usen `/` como separador, y DEBERÍAN estar en UTF-8. NO DEBEN
  ser absolutos, contener una letra de unidad ni contener un segmento `..`.
- La raíz del archivo es la carpeta de la presentación. **No** hay un directorio envolvente.

---

## 3. Estructura

```
example.revel
├── manifest.json              # index and integrity data (section 6); SHOULD be present
├── presentation.md            # one or more Markdown files (section 4); at least one is REQUIRED
├── presentation.es.md         # optional variants
├── presentation.thumb.jpg     # optional thumbnails (section 5)
├── custom.css                 # optional files referenced by the Markdown
└── _resources/
    └── _media/                # optional embedded media (section 7)
        ├── photo.jpg
        ├── photo.jpg.json
        └── photo.jpg.thumbnail.jpg
```

---

### 3.1 Restricciones de contenido

Un archivo `.revel` es un archivo de datos. Abrir uno NUNCA debe ejecutar código, por lo que no debe contener
contenido que un sistema de escritorio ejecutaría con los permisos del usuario.

**Prohibido.** Un archivo `.revel` NUNCA DEBE contener, y un escritor NUNCA DEBE añadir, nada de lo
siguiente, en ninguna ruta:

| Categoría | Extensiones (sin distinguir mayúsculas; la lista no es exhaustiva) |
|---|---|
| Archivos que pueden ejecutar código | `.html` `.htm` `.xhtml` `.js` `.mjs` `.cjs` `.sh` `.bat` `.cmd` `.ps1` `.vbs` `.wsf` `.exe` `.com` `.scr` `.msi` `.dll` `.so` `.dylib` `.jar` `.app` `.lnk` `.desktop` `.py` |
| Otros scripts, accesos directos, instaladores y contenido activo | `.hta` `.jse` `.vbe` `.wsh` `.reg` `.scf` `.url` `.pif` `.msc` `.swf` `.xsl` `.xslt` `.svgz` (el SVG comprimido no se puede sanear) `.appimage` `.pkg` `.deb` `.rpm` `.apk` |
| Archivos de Office con macros habilitadas | `.docm` `.dotm` `.xlsm` `.xlam` `.pptm` `.potm` `.ppsm` `.sldm` |

---

Las categorías importan más que las listas: todo lo que un sistema de escritorio ejecutaría o interpretaría
como script está prohibido. Un archivo NO DEBE aceptarse por el simple hecho de cambiarle el nombre: una entrada cuyo contenido sea un
ejecutable o script (por ejemplo, que comience con `MZ`, `\x7fELF`, un encabezado Mach-O o `#!`) está
prohibida sea cual sea su nombre, a menos que sea un tipo de archivo basado en texto, como Markdown.

---

**Archivos comprimidos.** Un archivo comprimido, fichero comprimido o imagen de disco (por ejemplo `.zip` `.tar` `.gz` `.tgz`
`.xz` `.bz2` `.7z` `.rar` `.cab` `.iso` `.dmg` `.img`) que **contenga** cualquier contenido prohibido está
a su vez prohibido. Una implementación PUEDE elegir cómo cumplir esa regla:

- bloquear todos los archivos comprimidos, que es lo más simple y se RECOMIENDA para implementaciones que no escanean; o
- escanear los archivos comprimidos, incluidos los anidados, y bloquear los que contengan contenido prohibido.

Una implementación que bloquee archivos comprimidos DEBERÍA hacerlo por extensión de archivo. Los formatos de documento que
son en sí mismos contenedores ZIP (como `.docx`, `.xlsx`, `.pptx`, `.odt`, `.ods`, `.odp` y Keynote
`.key`) son documentos, no archivos comprimidos, para los efectos de esta regla.

---

**Otros archivos.** Un archivo `.revel` PUEDE contener otros tipos de archivo que el propio REVELation no usa,
por ejemplo `.pdf`, `.pptx`, `.docx` y `.key`. La carpeta de la presentación suele ser una carpeta de proyecto
que también contiene los archivos fuente y el material de referencia con los que se construyó una presentación,
y `.revel` puede transportarlos. El formato no interpreta estos archivos.

---

Esto es deliberadamente una zona gris. Una implementación PUEDE bloquear o descartar los tipos de archivo que no
reconozca, y un escritor NO DEBE asumir que otra implementación los conserva. Un lector que
conserve tales archivos NO DEBERÍA abrirlos automáticamente, y DEBERÍA conservar en ellos la marca de
origen de descarga de la plataforma (Mark-of-the-Web en Windows, el atributo de cuarentena en macOS) para
que las protecciones del sistema operativo sigan aplicándose cuando el usuario los abra. Consulta también la
nota sobre documentos en "Permitido condicionalmente".

---

**Permitido condicionalmente.**

- **`.svg`.** El lector renderiza el SVG, y este puede contener scripts. Un escritor o lector PUEDE escanear
  los archivos SVG y eliminar las partes inseguras (elementos script, atributos de manejadores de eventos, URL
  `javascript:`, `foreignObject`, referencias externas), y PUEDE descartar un archivo que no se pueda hacer seguro. Un
  lector que no escanee DEBERÍA mostrar el SVG solo en un contexto que no ejecute scripts, como
  un elemento de imagen.
- **Documentos (`.pdf`, archivos de Office y OpenDocument, y similares).** Pueden contener contenido
  activo: scripts, acciones de lanzamiento, enlaces remotos u objetos incrustados. El formato no los
  interpreta, y el visor que los abra después es responsable de la mayor parte del riesgo. Una
  implementación PUEDE escanearlos y PUEDE descartar o bloquear un archivo que contenga contenido activo.
  NO DEBERÍA reescribir un documento para eliminar dicho contenido, ya que eso modifica el documento. Un lector
  que abra estos archivos por sí mismo DEBERÍA hacerlo con los scripts deshabilitados. Conservar la marca de
  origen de descarga (véase "Otros archivos" arriba) es la principal protección para los documentos que el lector no abre.

---

**Permitido.**

- **Medios:** cualquier archivo de imagen, audio o video válido y compatible con la web que no suponga un riesgo de seguridad inherente,
  por ejemplo `.jpg` `.jpeg` `.png` `.gif` `.webp` `.avif` `.mp4` `.webm` `.mp3` `.ogg`
  `.opus` `.wav` `.m4a` `.aac`. Un archivo con nombre de medio cuyo contenido sea un archivo comprimido es un
  archivo comprimido disfrazado y queda bajo la regla de archivos comprimidos anterior.
- **Fuentes:** por ejemplo `.woff` `.woff2` `.ttf` `.otf`.
- **Hojas de estilo:** `.css`.
- Markdown, `manifest.json`, archivos auxiliares de medios y miniaturas según se definen en esta especificación.

---

**Cumplimiento.** Un escritor NO DEBE escribir una entrada prohibida. Un lector NO DEBE ejecutar, y NO DEBE
extraer, una entrada prohibida. DEBERÍA omitirla, informar al usuario y continuar con el resto del
archivo, y PUEDE rechazar el archivo completo. Los archivos antiguos (incluidas las exportaciones de sitios web "standalone"
sin conexión, que contienen HTML y scripts) quedan bajo esta regla: no son archivos `.revel`, y un
sitio web ejecutable DEBERÍA compartirse como un `.zip` común.

`_resources/` está reservado. Solo se define `_resources/_media/` (sección 7); un lector DEBERÍA ignorar
cualquier otra cosa que haya bajo él.

---

## 4. Archivos de presentación

- El archivo DEBE contener al menos un archivo Markdown (`*.md`) en la raíz del archivo.
- Cada archivo Markdown es una presentación o una variante de una (por ejemplo, una traducción), con front matter
  YAML seguido de Markdown de diapositivas. La sintaxis la define la especificación de Markdown de REVELation
  enlazada arriba.
- Los nombres de archivo no son significativos para el formato.
- El formato no designa un archivo principal. Un lector que deba elegir uno DEBERÍA preferir
  `presentation.md` y, en su defecto, el primer archivo `.md` en orden lexicográfico.
- El front matter PUEDE ocultar un archivo como alterno (consulta la referencia de metadatos); los lectores DEBERÍAN respetarlo
  al listar presentaciones.

---

## 5. Miniaturas

Un archivo Markdown PUEDE tener una miniatura, nombrada por su campo de front matter `thumbnail`. Cuando el campo
está ausente, el nombre de la miniatura es `<basename>.thumb.jpg`, donde `<basename>` es el nombre del archivo Markdown
sin `.md`, en el mismo directorio. Las miniaturas son opcionales; los lectores DEBEN manejar su
ausencia.

---

## 6. `manifest.json`

Un objeto JSON UTF-8 en la raíz del archivo. Los escritores DEBERÍAN incluirlo. Un lector NO DEBE rechazar un
archivo porque el manifiesto esté ausente o no se pueda analizar, aunque PUEDE emitir una advertencia.

### 6.1 Campos

| Campo | Tipo | Significado |
|---|---|---|
| `presentationId` | string | RECOMENDADO. UUID en minúsculas (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`) que identifica la presentación entre copias. Se crea una vez y lo conserva todo escritor que reescriba el archivo. Los lectores lo usan para reconocer que dos copias son la misma presentación. |
| `files` | array | RECOMENDADO. Índice de integridad, véase 6.2. |
| `markdownFiles` | array de string | Los archivos Markdown del archivo, como rutas relativas. Informativo. |
| `presentations` | array de object | Resumen opcional por archivo: `mdFile`, `title` y `htmlFile`. `htmlFile` existe por compatibilidad con las exportaciones standalone y no tiene significado en un `.revel`; los lectores DEBERÍAN ignorarlo. |
| `appVersion` | string | RECOMENDADO. La versión del archivo, escrita como la versión de lanzamiento de REVELation (por ejemplo `1.0.13`) cuyas reglas sigue el archivo. Se usa para determinar la compatibilidad; véase la sección 9. |
| `exportedAt` | string | Hora ISO 8601 en que se creó el archivo. Informativo. |
| `savedAt` | string | Hora ISO 8601 del último guardado, escrita en lugar de `exportedAt` por algunos escritores. Informativo. |

---

Los lectores DEBEN ignorar los campos que no reconozcan.

### 6.2 `files`

Cada elemento describe una entrada del archivo:

| Campo | Tipo | Significado |
|---|---|---|
| `filename` | string | Ruta relativa a la raíz del archivo, usando `/`. |
| `size` | number | Tamaño sin comprimir en bytes. |
| `modified` | string | Hora de modificación ISO 8601. Informativo. |
| `sha1` | string | SHA-1 hexadecimal en minúsculas del contenido sin comprimir. |

---

Reglas:

- La lista DEBERÍA cubrir todos los archivos del archivo comprimido salvo el estado exclusivamente local. Una ruta con un
  segmento que empiece con punto (`.thumbs/…`, `.hidden`) es estado exclusivamente local: los escritores NO DEBEN listarla y
  los lectores DEBEN ignorarla.
- Bajo `_resources/`, solo se lista `_resources/_media/`.
- `manifest.json` se lista a sí mismo con `filename`, `size` y `modified` pero **sin** `sha1`, porque
  no puede contener su propio hash.
- Las entradas DEBERÍAN ordenarse por `filename`.
- Se permite un archivo presente en el archivo comprimido pero ausente de `files`.

---

### 6.3 Verificación

Un lector que verifique la integridad DEBERÍA, para cada entrada listada distinta de `manifest.json` que tenga
`size` o `sha1`, comprobar que el archivo existe y que su tamaño y SHA-1 coinciden. DEBERÍA informar
de las discrepancias al usuario y PUEDE dejar que el usuario continúe. Una entrada sin `size` ni `sha1` no
se comprueba.

---

### 6.4 Ejemplo

```json
{
  "appVersion": "1.0.13",
  "exportedAt": "2026-10-03T21:30:00.000Z",
  "markdownFiles": ["presentation.md", "presentation.es.md"],
  "presentations": [
    { "mdFile": "presentation.md", "title": "My Talk", "htmlFile": "index.html" }
  ],
  "presentationId": "6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f",
  "files": [
    { "filename": "manifest.json", "size": 1234, "modified": "2026-10-03T21:30:00.000Z" },
    { "filename": "presentation.md", "size": 2048, "modified": "2026-10-03T21:29:00.000Z", "sha1": "…40 hex digits…" }
  ]
}
```

---

## 7. Medios incrustados

Los medios PUEDEN viajar dentro del archivo bajo `_resources/_media/`. La forma en que el Markdown hace referencia a los medios (el
mapa `media` en el front matter, los alias y los campos de URL) se define en la especificación de Markdown de REVELation.
Esta sección cubre solo los archivos dentro del archivo comprimido.

Para cada elemento incrustado, el archivo contiene:

| Entrada | Propósito |
|---|---|
| `_resources/_media/<name>` | El archivo de medios. |
| `_resources/_media/<name>.json` | Archivo auxiliar de metadatos: un objeto JSON cuyo `filename` es `<name>`, más campos opcionales como `large_variant`. |
| `_resources/_media/<name>.thumbnail.jpg` | Miniatura opcional. |
| `_resources/_media/<large name>` | Variante grande opcional, nombrada por `large_variant.filename` en el archivo auxiliar. |

---

Un archivo sin medios incrustados es válido. En su lugar, los medios pueden referenciarse mediante los campos de URL del front
matter (`url_direct`, `url_library`, `url_origin`), que un lector PUEDE usar para obtener medios que no
estén incrustados.

---

## 8. Lectura segura

Un archivo `.revel` puede provenir de una fuente no confiable. Un lector:

- DEBE rechazar u omitir las entradas cuyos nombres sean absolutos o contengan `..`, de modo que la extracción
  nunca pueda escribir fuera del destino.
- NO DEBE extraer las entradas prohibidas por la sección 3.1, y NO DEBERÍA abrir automáticamente los archivos extraídos.
- DEBERÍA limitar el tamaño total sin comprimir, el número de entradas y la relación de compresión antes de extraer.
- DEBE tratar el Markdown, el front matter y todos los archivos incrustados como entrada no confiable, y NO DEBE
  ejecutar ningún contenido del archivo.
- NO DEBERÍA obtener recursos de red nombrados en el archivo sin el consentimiento del usuario.

---

## 9. Versionado y compatibilidad

- **La versión de un archivo `.revel` es el atributo `appVersion` de su `manifest.json`.** Es la
  versión de lanzamiento de REVELation cuyas reglas de formato sigue el archivo. No hay un número de
  versión de formato separado.
- Un escritor distinto de REVELation DEBE escribir la versión de REVELation cuya especificación
  implementa, no la versión de su propio producto.
- Un lector determina la compatibilidad comparando `appVersion` con la versión de REVELation que
  implementa. DEBERÍA advertir al usuario cuando el archivo sea más reciente de lo que el lector entiende, y PUEDE
  continuar con el mejor esfuerzo. DEBERÍA aceptar versiones anteriores.
- Si `appVersion` está ausente (archivos hechos a mano, o archivos anteriores al sellado de versión), el lector
  NO DEBE rechazar el archivo; DEBERÍA tratarlo como heredado (legacy).
- Se espera que los cambios sean aditivos: nuevos campos opcionales del manifiesto y nuevas entradas opcionales. Por eso
  los lectores DEBEN ignorar los campos y entradas que no reconozcan.

---

## 10. Archivo mínimo

El archivo válido más pequeño es un ZIP cuya raíz contiene un archivo Markdown:

```
minimal.revel
└── presentation.md
```

Se anima a los escritores a incluir también `manifest.json` con un `presentationId` y una lista
`files` completa.

---

## 11. Servir por HTTP

Sirve los archivos `.revel` con el tipo de medio de la sección 1 para que los navegadores los descarguen:

```
# nginx (mime.types)
application/vnd.revelation.presentation+zip  revel;

# Apache
AddType application/vnd.revelation.presentation+zip .revel
```

Se recomienda `Content-Disposition: attachment`. Un servidor que no conozca la extensión y
envíe `application/octet-stream` aun así entrega un archivo utilizable; `application/zip` es una alternativa
aceptable.
