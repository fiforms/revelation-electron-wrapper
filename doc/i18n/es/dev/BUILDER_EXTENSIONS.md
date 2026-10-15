# Extender el Builder (autores de plugins)

Esta guía es para autores de plugins que quieran agregar interfaz al constructor de presentaciones (`http_admin/builder.html`). La
fuente de verdad es el comentario de encabezado de `http_admin/builder/extensions-host.js`; esta página explica cómo usarlo.

El código del constructor se ejecuta en el renderer. Un plugin lo alcanza mediante su archivo `clientHookJS`, que registra un objeto en
`window.RevelationPlugins[name]` (consulta [PLUGINS.md](PLUGINS.md)). `/js/pluginloader.js` lo carga, y el constructor
llama a los hooks siguientes. Verifica `context.page === 'builder'` en `init(context)` si el mismo archivo también se carga en otras páginas.

---

## Hooks en `window.RevelationPlugins[name]`

| Hook | Propósito |
|------|---------|
| `getBuilderExtensions({ host, slug, mdFile, dir })` | Devuelve un arreglo de contribuciones (modos, paneles, superposiciones, botones de barra de herramientas, renderizador del navegador). Se espera una sola vez al iniciar el constructor, en el orden de `priority` del plugin. |
| `getBuilderTemplates()` | Entradas para el menú **Content** (`{ label, onSelect }`). |
| `getContentCreators()` | Forma anterior del mismo menú; todavía la usan `bibletext`, `hymnary`, `adventisthymns` y `addmedia`. |
| `getSlideTools()` | Entradas para el menú **Slide Tools** (y el menú de clic derecho del Rich Builder). |
| `getAnimationTools()` | Entradas (`{ label, onSelect(ctx) }`) para el menú **Animation** de la barra de herramientas del Rich Builder; `appearance` lo usa para "Appearance Animation…". |
| `onRichFragmentEdit(payload)` | Se llama cuando se hace clic en un fragmento (`++` / `==`) en el Rich Builder. `payload` es `{ marker, symbol, setMarker(newMarker), remove() }`; devuelve `true` (o una promesa de `true`) si lo manejaste; de lo contrario se abre el editor de marcador integrado. `appearance` lo usa para su diálogo de animación. |
| `onRichMacroEdit(payload)` | Se llama cuando se hace clic en una tarjeta de macro (una línea `:tag:` o un bloque YAML `:tag:`) en el Rich Builder, o al elegir **Edit…** en su menú contextual. `payload` es `{ tag, raw, body, setRaw(text, { label }), remove() }`: `tag` es el `:nombre:` inicial, `raw` el bloque completo y `body` todo lo que sigue a su primera línea (el texto YAML). Comprueba `payload.tag` y devuelve `false` para etiquetas que no sean tuyas. Devuelve `true` (o una promesa de `true`) si lo manejaste; de lo contrario se abre el editor de macro de texto plano. `setRaw` devuelve `false` salvo que el nuevo texto empiece con el mismo `:tag:`; `label` opcional reemplaza el texto de la tarjeta. `credit_ccli` lo usa para su diálogo de créditos. |
| `getBlockTools()` | Entradas (`{ label, onSelect(ctx) }`, mismo `ctx` que `getSlideTools`) listadas bajo el encabezado **Plugin Blocks** en el menú **Animation** del Rich Builder, para insertar un bloque `:tag:` propio del plugin (normalmente `ctx.appendToSlideEnd(block)` tras un diálogo). `credit_ccli` lo usa para «CCLI Credits…». |
| `getMacroMenuItems({ slug, mdFile })` | Entradas (`{ label, macro }`) para el menú de macros (Format) del builder, solo para el editor del cuerpo; el texto de la macro se inserta tal cual. `credit_ccli` lo usa para sus bloques "Credits: …". |
| `getPresentationUrlParams({ appConfig })` | Devuelve parámetros de consulta `{ nombre: valor }` que se añaden a las URL de presentación abiertas desde la vista previa del builder y la lista de presentaciones (nombres `[a-z][a-z0-9_]*`; los parámetros del núcleo están reservados). El equivalente en Electron es `AppContext.presentationUrlParamProviders.set(nombreDelPlugin, config => ({...}))` en el `register()` del plugin. El plugin vuelve a leer el parámetro desde `window.location`. `credit_ccli` reenvía `ccli`. |
| `onBuilderSmartPaste(payload)` | Transforma el contenido del portapapeles al pegar. |
| `onBuilderSmartPasteSplit(markdown)` | Divide el texto pegado (ya transformado) en diapositivas; devuelve el markdown dividido, o `null` si el usuario cancela. El primer plugin por prioridad que lo implemente reemplaza la división integrada de ~60 palabras. `divideslides` lo usa. |

Prefiere `getBuilderExtensions` para cualquier cosa nueva. Una entrada no reconocida se ignora, y una excepción en un plugin se
registra sin afectar a los demás.

---

## Contribuciones

Cada entrada del arreglo tiene un `kind` y un `id` (cadena única). Las funciones `mount` pueden devolver una función de limpieza (dispose), o
un objeto con `dispose()`.

| `kind` | Campos | Qué obtienes |
|--------|--------|--------------|
| `mode` | `id`, `label`, `mount({ host, root, slug, mdFile, dir })`, opcionales `icon`, `tooltip`, `exclusive` (por defecto true), `location`: `'preview-header'` (predeterminado), `'left-header'` o `'view-tabs'` | Un botón que alterna un espacio de trabajo en el que renderizas dentro de `root`. `view-tabs` lo coloca junto a las pestañas Visual / Markdown / Split. |
| `panel` | `id`, `mount({ host, root, ... })` | Una sección en la columna de paneles de la izquierda. |
| `preview-overlay` | `id`, `mount({ host, root, ... })` | Una capa sobre la vista previa. |
| `toolbar-action` | `id`, `label`, `onClick({ host, ... })`, opcional `icon` | Un botón de la barra de herramientas. |
| `slide-navigator-renderer` | `renderTile` | Reemplaza la forma en que se dibujan los mosaicos de diapositivas en el navegador (gana un solo renderizador). |

---

Ejemplo:

```js
window.RevelationPlugins.myplugin = {
  name: 'myplugin',
  getBuilderExtensions({ host }) {
    return [
      {
        kind: 'toolbar-action',
        id: 'myplugin-count',
        label: 'Count slides',
        onClick: ({ host }) => host.notify(`${host.getDocument().stacks.length} columns`)
      }
    ];
  }
};
```

---

## `RevelationBuilderHost`

`window.RevelationBuilderHost` (`version` `1.0`, `apiVersion` `2`) es la única forma admitida de tocar el estado del constructor.
No importes módulos del constructor ni uses los hooks `__revelationBuilderHostInternal*`.

**Lectura**

- `getDocument()` devuelve una copia profunda: `{ slug, mdFile, dir, frontmatter, noteSeparator, stacks }`.
- `getMetadata()` devuelve el front matter analizado.
- `getSelection()` devuelve `{ h, v }`.
- `getUiState()` devuelve `{ columnMarkdownMode, previewReady, dirty }`.

---

**Cambiar el documento.** Usa `transact(label, fn(tx))`; es la vía segura para deshacer. Marca el documento como modificado y
actualiza la vista previa, y el historial de deshacer registra el resultado. Dentro de `fn`, `tx` tiene `setSelection`, `moveSlide`,
`moveColumn`, `insertSlides`, `splitSlide`, `replaceColumn`, `replaceStacks` y `mergeMediaEntries`. Nunca edites el objeto
`stacks` que obtuviste de `getDocument()`; es una copia.

**Registro** (cada uno devuelve una función para cancelar el registro): `registerMode`, `registerPanel`, `registerPreviewOverlay`,
`registerToolbarAction`, `registerPreviewButton`, `registerKeyboardShortcut({ key, ctrl, shift, alt, onTrigger })`,
`registerSlideNavigatorRenderer`, `registerSaveGuard(fn)`. Un guardia de guardado recibe `{ slug, mdFile }` y puede devolver
(o resolver a) `false` para cancelar el guardado.

---

**Ayudantes de interfaz:** `openDialog({ title, message, render })` devuelve una promesa con el resultado del diálogo, y `notify(message,
level)` muestra un aviso emergente (`'info'`, `'warn'`, `'error'`). `setActiveMode(id)` y `getActiveMode()` controlan los modos.

**Eventos:** `host.on(name, fn)` devuelve una función para cancelar la suscripción. Nombres: `selection:changed`, `document:changed`,
`mode:changed`, `preview:ready`, `preview:slidechanged`, `preview:dblclick`, `preview-button:changed`, `save:before`,
`save:after`, `history:flush`.

## Ejemplos reales

- `plugins/bibletext/client.js`: `getBuilderExtensions` más un atajo `Ctrl+T`.
- `plugins/richbuilder/builder.js`: un modo completo de edición de texto enriquecido.
- `plugins/divideslides/client.js`: una entrada de `getBuilderTemplates` que carga su diálogo de forma diferida.
