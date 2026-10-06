# `.revel` en REVELation Snapshot Presenter: notas de implementación

Cómo esta aplicación exporta, importa, abre, registra y protege los archivos `.revel`. El formato
en sí (contenedor, estructura, manifiesto, medios) se especifica en [REVEL_FORMAT.md](REVEL_FORMAT.md),
que está escrito para compartirse con otros implementadores. Este documento es específico de esta
base de código y nada de lo que contiene se exige a otras implementaciones.

---

Para el flujo de trabajo orientado al usuario, consulta [GUI_REFERENCE.md](../GUI_REFERENCE.md#gui-opening-revel-files).

| Aspecto | Código |
|---|---|
| Exportación | [lib/exportPresentation.js](../../../../lib/exportPresentation.js) |
| Manifiesto | [lib/presentationManifest.js](../../../../lib/presentationManifest.js) |
| Extracción / importación | [lib/importPresentation.js](../../../../lib/importPresentation.js) (`runZipImport`) |
| Apertura de solo lectura | [lib/openedPresentation.js](../../../../lib/openedPresentation.js) |
| Lightbox | `revelation/js/presentationlist.js` (`renderOpenedPresentationLightbox`) |
| Modo de solo lectura del builder | [http_admin/builder/readonly.js](../../../../http_admin/builder/readonly.js) |
| Registro en el sistema operativo | sección `build` de [package.json](../../../../package.json) |

---

## Exportación

El formato **REVELation (.revel)** de la ventana de exportación (el IPC `export-presentation` en
`lib/exportPresentation.js`) escribe un ZIP con la extensión `.revel`. Una exportación standalone
(**Create Standalone Presentation**) no es un `.revel`: genera un sitio web ejecutable (HTML más
CSS y JavaScript de `_resources/`) y guarda un `.zip` común (el diálogo de guardado usa por defecto
`<slug>.zip`). La aplicación no abre esos archivos como presentaciones. Esto mantiene los archivos `.revel` libres de los
archivos generados que el formato prohíbe (consulta REVEL_FORMAT.md sección 3): el HTML y los archivos de ejecución
bajo `_resources/` solo se generan cuando se marca **Create Standalone Presentation**, por lo que una exportación
`.revel` contiene como máximo `_resources/_media/`.

---

Qué se escribe:

- La carpeta de la presentación se comprime en la raíz del archivo con deflate nivel 9, usando
  `archiver`.
- `manifest.json` se reconstruye con `forceRecompute` inmediatamente antes de comprimir, de modo que los tamaños y los hashes
  estén actualizados. Contiene `appVersion`, `exportedAt`, `markdownFiles`, `presentations`,
  `presentationId` y `files`. Los guardados ordinarios escriben el mismo manifiesto con `savedAt` en lugar de
  `exportedAt` y sin `presentations`.
- `presentationId` se crea una vez (`crypto.randomUUID()`) y lo conserva cada reescritura del
  manifiesto, por lo que también viaja a través de la sincronización en la nube y la importación por URL.
- **Include media** copia cada archivo de medios referenciado por el mapa `media` del front matter, con su
  archivo auxiliar `.json`, `.thumbnail.jpg` y variante grande, desde la biblioteca compartida `_media/` hacia
  `_resources/_media/`. Sin esta opción, el archivo no tiene `_resources/`.

---

Qué se deja fuera:

- Las rutas ocultas (que empiezan con punto) como `.thumbs` (la caché de miniaturas del builder) y
  `.sync-conflicts` (copias de seguridad locales de la sincronización con WordPress), y `__builder_temp.md` (el archivo de
  vista previa del builder).
- Todo lo que el formato prohíbe; consulta "Restricciones de contenido y versionado" más abajo.
- `_resources/` se genera para la exportación y se elimina después, junto con cualquier HTML temporal.

---

### Restricciones de contenido y versionado

[REVEL_FORMAT.md sección 3.1](REVEL_FORMAT.md#31-restricciones-de-contenido) prohíbe scripts,
ejecutables, archivos de Office con macros habilitadas y archivos comprimidos que los contengan, y define la política de SVG.
El cumplimiento está en [lib/revelFormat.js](../../../../lib/revelFormat.js), que no tiene
dependencia de Electron. Las listas viven en `PROHIBITED_EXTENSIONS` y `MEDIA_EXTENSIONS`; cámbialas allí.

---

Cómo aplica esta aplicación las zonas grises de la especificación:

- **Archivos comprimidos:** se bloquean por extensión de archivo (`.zip`, `.tar`, `.gz`, `.7z`, `.rar`, `.iso`, `.dmg`, …).
  Bloqueamos todos los archivos comprimidos en lugar de escanearlos. Los formatos de *documento* basados en ZIP (`.docx`, `.pptx`,
  `.xlsx`, `.odp`, `.key`) no son archivos comprimidos y se conservan.
- **Otros archivos:** los tipos no reconocidos se conservan, incluidos `.pdf`, `.pptx`, `.docx`, `.key` y
  otros archivos de proyecto, de modo que una carpeta de presentación pueda llevar su material fuente. Los archivos de
  Office con macros habilitadas (`.docm`, `.xlsm`, `.pptm`, y las variantes de plantilla y complemento) se bloquean.
  Los archivos binarios heredados de Office (`.doc`, `.xls`, `.ppt`) pueden contener macros pero no se bloquean.
- **Documentos:** los archivos PDF, Office, OpenDocument y Keynote pasan sin cambios y no se escanean
  en busca de contenido activo. La aplicación nunca los abre por sí misma, y llevan la marca de origen de descarga
  (véase más abajo). Escanear PDF de forma fiable requiere un analizador de PDF, ya que la mayoría de los PDF comprimen sus objetos
  y una simple búsqueda de `/JavaScript` o `/Launch` pasa por alto muchos; eso no está implementado.
- **Comprobaciones de contenido:** el contenido ejecutable o de script (`MZ`, ELF, Mach-O, `#!`) se rechaza bajo cualquier
  nombre que no sea de texto. El contenido de archivo comprimido se rechaza solo bajo un nombre de medio o fuente (`.png`, `.jpg`,
  `.mp4`, `.woff2`, …), donde solo puede tratarse de un archivo comprimido disfrazado.

---

**Al exportar** (`planRevelContents`, `writeRevelArchive`):

- Antes del diálogo de guardado, se escanea la carpeta. Si algo se va a omitir, un diálogo dice: "This
  presentation contains some prohibited file types, which are omitted from the exported file.
  Export as a standalone presentation to include these." Lista los archivos y ofrece **Continue
  Export** o **Cancel**.
- El archivo se construye entrada por entrada a partir del plan, no recorriendo la carpeta con comodines. Los archivos prohibidos
  (por extensión, o por las comprobaciones de contenido anteriores) se dejan fuera, los archivos SVG se sanean, y cualquier SVG que no se pueda hacer seguro se omite.
- Las rutas ocultas (que empiezan con punto) y `__builder_temp.md` nunca se incluyen. Esto es más estricto que
  antes: solo se excluían `.thumbs` y `.sync-conflicts`.
- `manifest.json` se construye para describir exactamente lo que se archivó: los archivos omitidos no se listan,
  y un SVG saneado se lista con el tamaño y el SHA-1 de los bytes saneados (opciones `exclude` y
  `overrides` en `lib/presentationManifest.js`).
- El resultado de la exportación incluye `omitted` y `cleaned`, y la ventana de exportación añade "(N prohibited
  files omitted)" a su línea de estado.
- Una exportación standalone es un sitio web `.zip` común y no se filtra, razón por la cual la advertencia
  la sugiere.

---

**Al extraer** (`extractRevelArchive`), usado por la importación, la apertura y el menú Open Presentation:

- Las entradas se omiten, no se extraen, cuando el nombre no es seguro (absoluto, letra de unidad, `..`), la
  extensión está prohibida o fallan las comprobaciones de contenido anteriores. Los tipos analizados como texto (`.md`, `.json`,
  `.css`, `.txt`, `.yaml`, `.svg`) no se comprueban por firma, ya que un archivo Markdown puede
  comenzar legítimamente con "MZ".
- Las rutas ocultas se ignoran silenciosamente. El SVG se sanea (elementos script y `foreignObject`, manejadores
  de eventos, URL `javascript:`, `href` que no sean fragmentos, `url()` y `@import` de CSS externos,
  declaraciones DOCTYPE y de entidades); un SVG que no se pueda analizar, o que supere los 10 MB, se omite.
- Límites: 20.000 entradas y 8 GiB sin comprimir en total. Los tamaños declarados se comprueban de antemano y
  los bytes realmente escritos se cuentan durante la transmisión.
- Los archivos omitidos y saneados se excluyen de la validación del manifiesto para que no generen falsos
  errores de "missing" o "hash mismatch". El resultado de la importación incluye `skipped` y `cleaned`, y el
  mensaje de la ventana de importación indica cuántos archivos se omitieron.
- La importación por URL aplica las mismas reglas de nombre, firma y SVG a cada archivo descargado. Los archivos se **transmiten directamente al disco** (nada se mantiene en memoria, por lo que funcionan medios de varios GB), se calcula su hash a medida que llegan y se comparan con el `size`/`sha1` del manifiesto. Un archivo puede ser de hasta 8 GiB y la presentación completa de hasta los mismos 8 GiB totales que un `.revel`; un SVG debe caber en el límite de 10 MB del sanitizador o se omite. Las descargas expiran cuando no llegan datos durante 30 s (no por tiempo total), siguen como máximo 5 redirecciones y rechazan una degradación de https a http. Consulta `lib/httpUtil.js`.
- Un archivo abierto desde el sistema operativo muestra un aviso en el lightbox cuando se omitieron archivos.

---

**Marcas de origen de descarga** ([lib/originMark.js](../../../../lib/originMark.js)). Los navegadores y clientes de correo
marcan los archivos descargados para que el sistema operativo pueda aplicar Vista protegida, bloqueo de macros y Gatekeeper.
Las herramientas de archivos comprimidos copian la marca del archivo en lo que extraen; la extracción de Node no lo hace, así que tras la
extracción lo hace la aplicación:

- Solo se marcan los archivos que REVELation no consume por sí mismo (`needsOriginMark`): todo excepto
  los tipos analizados como texto (`.md`, `.json`, `.css`, `.txt`, `.yaml`, `.svg`) y los medios web y fuentes. En
  la práctica, son documentos, PDF y otros archivos de proyecto.
- **Windows:** si el `.revel` tiene un flujo de datos alterno `Zone.Identifier`, sus bytes se escriben
  como el mismo flujo en cada uno de esos archivos. Un archivo sin flujo (no fue descargado) deja los
  archivos extraídos sin marcar, exactamente como lo haría el Explorador. Los sistemas de archivos sin flujos (FAT, exFAT,
  algunos recursos compartidos de red) se omiten silenciosamente.
- **macOS:** el atributo `com.apple.quarantine` se lee con `/usr/bin/xattr -p` y se aplica con
  `xattr -w`, 50 archivos por llamada.
- **Importación por URL:** los archivos que la propia aplicación descarga reciben una marca nueva: `ZoneId=3` con `HostUrl` en
  Windows, y un valor de cuarentena `0081;<time>;REVELation;` construido a mano en macOS.
- **Linux:** no existe un equivalente, así que no se marca nada.
- El marcado es de mejor esfuerzo. Un fallo se registra en el log y nunca hace fallar la importación.
- Las marcas son estado local. No se escriben en los archivos `.revel` exportados; el sistema operativo aplica su propia
  marca cuando se descarga el archivo.

---

**Comprobación de versión.** Tras la extracción, el `appVersion` de `manifest.json` se compara con la versión de la
aplicación en ejecución (`compareVersions`, numérica con puntos). Un archivo más reciente produce un resultado `newerVersion` y
un aviso en el lightbox ("made by a newer version of REVELation … may not display correctly"). La
importación continúa de todos modos. Un `appVersion` ausente o anterior no produce ningún aviso.

---

## Importación y extracción

`runZipImport` en `lib/importPresentation.js` lo usan **Import Presentation**, **Open
Presentation** y la apertura mediante asociación de archivos:

1. **Validar la ruta:** el archivo existe y termina en `.revel` o `.zip`.
2. **Extraer** con `extractRevelArchive` (véase arriba): reglas de contenido, saneamiento de SVG y límites de tamaño.
3. **Validar contra `manifest.json`** (tamaño y SHA-1 por entrada). Los fallos muestran un diálogo; el usuario
   puede continuar, o cancelar, lo que elimina la carpeta extraída. Un manifiesto ausente o que no se pueda analizar
   omite la validación.
4. **Mover los medios incrustados** de `_resources/_media/` a la biblioteca compartida `_media/`, sin
   sobrescribir nunca un archivo existente de la biblioteca.
5. **Ofrecer descargar los medios faltantes** referenciados en el front matter mediante `url_direct`, `url_library`
   o `url_origin`. Primero se le pregunta al usuario.
6. **Limpiar:** eliminar los archivos `.html` de nivel superior y `_resources/`, y actualizar las fechas de modificación de
   los markdown para que los observadores de archivos se refresquen.

---

Como el paso 4 se fusiona con la biblioteca compartida, abrir un archivo añade sus medios a la biblioteca incluso
si la presentación nunca se importa.

---

## Apertura de un archivo

Un archivo `.revel` llega desde el sistema operativo (doble clic, Abrir con, soltar sobre el icono del dock) o desde
**Presentation > Open Presentation**. Ambos terminan en `openFile()` en `lib/openedPresentation.js`.

Cómo llega la ruta a la aplicación:

| Plataforma | Mecanismo |
|---|---|
| Windows, Linux | Argumento de línea de comandos. Un segundo lanzamiento se reenvía a la instancia en ejecución mediante el evento `second-instance` (la aplicación mantiene un bloqueo de instancia única). |
| macOS | El evento `open-file`, que puede llegar antes de que la aplicación esté lista y mientras se está ejecutando. |

---

Detalles que importan cuando la aplicación ya está en ejecución o se lanza desde un administrador de archivos:

- **Instancia única.** Un segundo lanzamiento (hacer doble clic en otro `.revel` mientras la aplicación está abierta)
  termina de inmediato y su línea de comandos se reenvía a la instancia en ejecución, que abre el archivo
  y trae su ventana al frente (restaurar, mostrar, enfocar).
- **URL `file://` en Linux.** La entrada `.desktop` que escribe electron-builder termina en `%U`, por lo que un administrador
  de archivos puede pasar una URL `file://` codificada con porcentajes en lugar de una ruta. `findRevelFileInArgv` decodifica
  ambas.
- **Rutas relativas** (al lanzar desde una terminal) se resuelven contra el directorio de trabajo de la segunda instancia,
  que Electron proporciona con el evento `second-instance`.
- **Inicio.** Hasta que se haya mostrado la ventana principal, los archivos se ponen en cola para que la ventana no aparezca
  antes de la pantalla de bienvenida (splash). Una vez mostrada (`markReady`), las solicitudes se abren de inmediato.
- **Un archivo a la vez.** Si hay varios archivos en la línea de comandos, solo se abre el primero. Los archivos que
  llegan como solicitudes separadas antes de que termine el inicio (eventos `open-file` de macOS) comparten una única ranura de cola,
  de modo que solo se abre el último de ellos.
- **Abrir un segundo archivo** reemplaza al primero sin preguntar. Se cierran todas las ventanas que muestran el archivo anterior
  (builder, presentación, notas del orador, folleto), se elimina su carpeta, y el lightbox
  cambia al nuevo archivo. Las ventanas se identifican por URL (`/_current_open/` en la ruta, o
  `slug=_current_open`) en `closeWindowsShowingOpened`; la ventana principal y las ventanas ocultas de captura
  fuera de pantalla se dejan intactas, y las ventanas de presentación se destruyen para que omitan su
  fundido a negro. El mismo cierre ocurre en **Close without importing** y en **Import to
  Library**, antes de eliminar o mover la carpeta (un identificador de archivo abierto bloquearía el cambio de nombre en
  Windows). Las aperturas se ejecutan una a la vez, de modo que dos solicitudes que lleguen juntas no puedan mezclar sus archivos
  extraídos. Si el nuevo archivo falla o el usuario cancela su diálogo de validación, el lightbox también
  se cierra, ya que la copia anterior ya no existe.

---

La ruta se pone en cola y se maneja una vez que existe la ventana principal; luego:

1. El archivo se extrae en el slug fijo **`_current_open`** dentro del directorio de presentaciones,
   reemplazando cualquier copia abierta anterior.
2. El proceso principal lee el front matter para obtener título, descripción y miniatura, y busca una
   presentación existente de la biblioteca con el mismo `presentationId`.
3. La lista de presentaciones muestra un lightbox sobre la lista (véase más abajo).

---

### El slug transitorio

`_current_open` no pasa por `slugify()` (que eliminaría su guion bajo inicial), por lo que un
slug elegido por el usuario nunca puede ser igual a él, y `runZipImport` lo rechaza como destino para una
importación ordinaria. Se excluye en todos los lugares donde se enumeran presentaciones:

| Lugar | Cómo |
|---|---|
| Índice de presentaciones | `createPresentationIndex().generate()` en `revelation/server/presentation-index.js` omite el directorio |
| Listado y sincronización de WordPress | ya omite las carpetas con prefijo `_` |
| Análisis de uso de medios | lo cuenta como usuario de sus medios (protector: sus medios no se ofrecen para eliminación) |

---

Es un directorio normal bajo la carpeta de presentaciones, por lo que la ventana de presentación, la vista de folleto
y el builder lo cargan por slug exactamente como cualquier otra presentación. Se descartó un directorio con punto
porque el servidor de archivos estáticos se niega a servir rutas con punto.

Ciclo de vida: lo reemplaza la siguiente apertura, lo elimina **Close without importing**, y se elimina al
iniciar la aplicación (`cleanupOnStartup`). No se elimina al salir.

---

### Cumplimiento de solo lectura

- **Proceso principal.** `assertWritableSlug()` rechaza el slug transitorio en los manejadores IPC de guardado de markdown,
  variante, guardado de metadatos y medios faltantes. El archivo temporal de vista previa del builder
  (`__builder_temp.md`) aún puede escribirse, ya que la vista previa del builder lo necesita.
- **Builder.** `http_admin/builder/readonly.js` deshabilita Guardar, muestra un banner con un botón **Import**
  y arma una protección sobre el indicador de cambios: cualquier edición muestra un recordatorio y se deshace (con una
  recarga como alternativa). La ventana del builder para este slug se cierra sin ningún aviso de
  cambios sin guardar.
- **No se aplica.** Los manejadores de plugins (por ejemplo add-media) aún pueden escribir en el slug si se invocan
  directamente. La interfaz no los expone para la copia abierta. Los plugins no pueden importar la protección desde
  `lib/`, así que una solución completa necesita una comprobación del lado del servidor.

---

### Import to Library

`importOpened()` renombra `_current_open` a un slug único a partir del nombre del archivo (`my-talk`, luego
`my-talk-2`, …) y limpia el lightbox. Una ventana de builder de solo lectura se cierra y el builder se
reabre sobre el nuevo slug. Si otra presentación de la biblioteca tiene el mismo `presentationId`, el
lightbox muestra primero una advertencia; Import de todos modos crea una copia separada.

Después de la importación, la presentación es una entrada ordinaria de la biblioteca. Las ediciones se guardan solo en la
biblioteca local; el archivo `.revel` original nunca se modifica. El usuario debe exportar de nuevo para actualizarlo,
y la interfaz lo indica.

---

## Análisis de seguridad

Un `.revel` abierto con doble clic es entrada no confiable que llega con menos intención deliberada que
el asistente de importación, por lo que es más importante que la ruta de extracción compartida esté reforzada.

| Aspecto | Estado |
|---|---|
| Path traversal en los nombres de entrada | Las entradas con nombres absolutos, con letra de unidad o con `..` se omiten, y el destino resuelto debe permanecer dentro de la carpeta de destino. |
| Scripts, ejecutables, archivos de Office con macros habilitadas, archivos comprimidos | Se omiten por nombre, además de las comprobaciones de contenido anteriores. |
| Archivos de proyecto permitidos (`.pdf`, `.pptx`, `.docx`, `.key`) | Se extraen tal cual, nunca se escanean ni los abre la aplicación. Llevan la marca de origen de descarga del archivo (véase "Marcas de origen de descarga"), por lo que la Vista protegida de Office y Gatekeeper siguen aplicándose cuando el usuario los abre. "Show Presentation Files" abre la carpeta en el administrador de archivos, donde un doble clic lanza el archivo. |
| SVG | Se sanea al exportar, importar, importar por URL y descargar medios faltantes; el SVG que no se pueda analizar se descarta. El tipo lo decide la extensión final, por lo que `x.svg.` y `x.svg ` (que Windows almacena como `x.svg`) también se sanean. |
| Medios descargados | Las descargas de medios faltantes y de variantes grandes se transmiten a un archivo temporal con nombre impredecible (creado de forma exclusiva), tienen límite de tamaño y de tiempo como la importación por URL, y se comprueban con `revelFormat.vetFileOnDisk` (tipo prohibido, contenido ejecutable/archivo comprimido bajo un nombre de medio, SVG saneado en el lugar) antes de entrar a `_media`. |
| Bombas zip (tamaño, número de entradas) | Limitado a 20.000 entradas y 8 GiB sin comprimir (primero se comprueban los tamaños declarados, luego los bytes escritos). No hay comprobación de relación de compresión por entrada. |
| Inyección de contenido mediante Markdown | La misma sanitización, Content Security Policy y pasada sobre el DOM en vivo que cualquier presentación. Consulta [revelation/doc/SECURITY.md](../revelation/doc/SECURITY.md). |
| Ejecución de código | Nada del archivo se ejecuta al abrir. Los otros archivos se extraen pero no se interpretan, salvo una hoja de estilo a la que una presentación haga referencia. |
| Acceso a la red | La descarga de medios faltantes obtiene URL del front matter del archivo. Se ejecuta solo después de que el usuario confirma. |
| Contaminación de la biblioteca | Los medios incrustados se fusionan con la biblioteca compartida al abrir (paso 4 de la importación), sin sobrescribir nunca. |
| Nombres de archivo de medios no confiables | `filename` / `large_variant.filename` en el front matter y en los archivos auxiliares no son de confianza. La importación, la exportación y la biblioteca de medios aceptan solo un nombre base simple que no sea de un tipo prohibido (`lib/pathSafety.js`); las demás entradas se omiten con una advertencia. Las descargas de medios faltantes nunca sobrescriben un archivo existente de la biblioteca. Los bytes descargados aún no se verifican por contenido (consulta KNOWN_ISSUES). |
| Widgets y plugins | Si una presentación no confiable puede usar widgets de superposición y otra sintaxis de plugins lo decide el modelo de seguridad normal de las presentaciones, no esta función. |
| Estado local en el archivo | Las rutas que empiezan con punto en un archivo comprimido se omiten silenciosamente al extraer (`extractRevelArchive` e importación por URL) y nunca forman parte del manifiesto. No se consideran de confianza como estado de sincronización; los peers de sincronización viven en el almacenamiento de la aplicación, no en la carpeta de la presentación. |

---

## Registro en el sistema operativo

Los instaladores registran la extensión. La aplicación no escribe asociaciones de archivos en tiempo de ejecución.

| Plataforma | Mecanismo | Al desinstalar |
|---|---|---|
| Windows (NSIS) | Claves del registro generadas a partir de `fileAssociations` | Se eliminan |
| Linux deb, rpm | Entrada `MimeType=` de `.desktop` y un XML de shared-mime-info | Se eliminan mediante los hooks del paquete |
| Linux AppImage | Ninguno. No hay paso de instalación y no es un destino configurado. | n/a |
| macOS | `CFBundleDocumentTypes` más una entrada `UTExportedTypeDeclarations` de `mac.extendInfo` | Mover la aplicación a la papelera lo elimina con el tiempo |

---

Configuración, toda en la sección `build` de `package.json`:

- `fileAssociations`: extensión `revel`, tipo de medio `application/vnd.revelation.presentation+zip`,
  nombre y descripción "REVELation Presentation", rol `Viewer`, icono `file-icon`.
- `mac.extendInfo`: declara `com.revelation.snapshot.presentation`, conforme a
  `public.zip-archive`, etiquetado con la extensión y el tipo de medio.

Los iconos están en `build-resources/`: `file-icon.ico` (Windows), `file-icon.icns` (macOS) y
`file-icon.png` (maestro de 1024 px). electron-builder recurre al icono de la aplicación si falta un archivo de
plataforma. electron-builder no puede establecer un icono de archivo en Linux; consulta "Icono de archivo en Linux"
más abajo.

---

### Icono de archivo en Linux

El archivo shared-mime-info que instala electron-builder tiene codificado el icono genérico `x-office-document`,
y los entornos de escritorio prueban ese nombre primero, por lo que los archivos `.revel` mostrarían un icono genérico
de documento. Esto se comprobó con `gio info -a standard::icon`, que listó
`x-office-document` antes que el icono nombrado según el tipo MIME. El paquete no puede cambiarlo,
así que [lib/linuxFileIcon.js](../../../../lib/linuxFileIcon.js) instala una anulación por usuario al iniciar:

- El icono de archivo de REVELation (`file-icon.png`, incluido en `resources/` mediante `extraResources`) se
  redimensiona con `nativeImage` a 16, 24, 32, 48, 64, 128, 256 y 512 px y se escribe en
  `$XDG_DATA_HOME/icons/hicolor/<size>x<size>/mimetypes/application-vnd.revelation.presentation+zip.png`
  (por defecto `~/.local/share`).
- Una definición MIME a nivel de usuario, `$XDG_DATA_HOME/mime/packages/revelation-snapshot-presenter-revel.xml`,
  declara el mismo tipo con `<icon name="application-vnd.revelation.presentation+zip"/>`. La base de datos MIME
  del usuario tiene precedencia sobre la del sistema, por lo que el icono nombrado se lista primero
  (también verificado con `gio`).
- La anulación declara el tipo como subclase de `application/zip`, de modo que el administrador de archivos comprimidos
  esté disponible en "Abrir con" y sea la alternativa cuando no hay ninguna aplicación registrada para el tipo.
  Cuando la aplicación está registrada, es la predeterminada y aparece primero.
- Se ejecutan `update-mime-database` y `gtk-update-icon-cache` sobre el resultado. Si falta alguna de las dos herramientas,
  se registra una nota en el log y el resto sigue funcionando; el icono aparece cuando se actualicen las cachés.

---

Cuándo se ejecuta: cinco segundos después del inicio, solo en Linux, en compilaciones empaquetadas (o con
`REVELATION_FORCE_FILE_ICON=1` para desarrollo). Se omite dentro de Flatpak y Snap. Una marca de control
(`linux-file-icon.json` en la carpeta de datos de la aplicación: versión de la aplicación más tamaño y hora del icono) hace que los inicios posteriores
sean una operación casi nula, y los archivos se reescriben si cambia la versión o desaparecen. Esto
también cubre las compilaciones AppImage, que no tienen instalador.

---

Solución de problemas (desarrolladores): si al hacer doble clic en un `.revel` se abre el administrador de archivos comprimidos, revisa
`gio mime application/vnd.revelation.presentation+zip`. Si la aplicación no aparece en "Registered
applications", busca un `~/.local/share/applications/revelation-electron.desktop` a nivel de usuario, por
ejemplo un lanzador creado para ejecutar desde el código fuente. Un archivo `.desktop` en el directorio del usuario
**tiene prioridad sobre el del sistema con el mismo nombre de archivo**, por lo que la línea `MimeType=` de la aplicación empaquetada nunca se
lee y el tipo recurre a su padre (`application/zip`). Renombra el lanzador (por ejemplo a
`revelation-dev.desktop`). Verificado en una réplica de una máquina afectada: al quitar el archivo que causaba la sombra,
la aplicación pasa a ser la predeterminada, y con él presente lo es el administrador de archivos comprimidos.

---

Límites:

- **No se elimina al desinstalar.** Una aplicación no puede ejecutar código cuando se desinstala, por lo que los archivos
  por usuario permanecen. Son pequeños e inofensivos: el icono y el archivo MIME solo se aplican a los archivos `.revel`.
  Para eliminarlos, borra los dos archivos anteriores y ejecuta `update-mime-database ~/.local/share/mime`.
- **Los administradores de archivos pueden necesitar un reinicio o un momento** para detectar el nuevo icono.
- Probado con `gio` contra un directorio de datos temporal; no se ha comprobado el resultado visual en un administrador
  de archivos real (Nautilus, Dolphin).

---

Notas por plataforma:

- Windows no permite que un instalador tome silenciosamente el control de un manejador predeterminado. Si ningún otro programa
  reclama `.revel`, se usa la aplicación; de lo contrario, el usuario elige una vez desde **Abrir con**.
- macOS registra la asociación cuando la aplicación se lanza por primera vez o se coloca en /Applications.
- Una compilación sin firmar aún registra la asociación pero provoca avisos de Gatekeeper. El flujo de trabajo
  `build-macos.yml` no tiene paso de firma ni notarización y no necesita cambios para la
  asociación.

Para verificar una compilación empaquetada: instálala, haz doble clic en un archivo `.revel` y confirma que se abre en el
lightbox; desinstala y confirma que la asociación desaparece. Los detalles del empaquetado están en
[BUILDING.md](BUILDING.md#file-association-for-revel-files).

---

## Cambiar el formato

Antes de cambiar lo que escribe el exportador o el manifiesto, actualiza [REVEL_FORMAT.md](REVEL_FORMAT.md),
mantén los cambios aditivos y comprueba que las rutas de lectura anteriores (validación, movimiento de medios, listado)
sigan ignorando los campos desconocidos.
