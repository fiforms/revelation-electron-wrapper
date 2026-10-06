# Desarrollo de plugins del wrapper

---

## Tabla de contenidos
* [Resumen](#dev-plugins-overview)
* [Empaquetado y manifiesto](#dev-plugins-packaging)
* [Arranque del plugin](#dev-plugins-bootstrap)
* [Botones de la barra lateral](#dev-plugins-sidebar-buttons)
* [Hooks de menú del Builder](#dev-plugins-builder-hooks)
* [Hooks de exportación sin conexión](#dev-plugins-offline-hooks)
* [Localización de la interfaz de plugins](#dev-plugins-i18n)
* [Referencias específicas de plugins](#dev-plugins-specific)

---

<a id="dev-plugins-overview"></a>

## Resumen

Este archivo documenta los hooks de plugins usados por el pipeline de constructor/exportación del wrapper de Electron.

---

<a id="dev-plugins-packaging"></a>

## Empaquetado y manifiesto

La instalación de plugins desde ZIP es estricta. El nombre del archivo ZIP se ignora para la identidad del plugin.

Estructura requerida del ZIP:
- `plugin-manifest.json` en la raíz del ZIP
- `plugin.js` en la raíz del ZIP
- cualquier otro recurso o carpeta del plugin en la raíz del ZIP (por ejemplo `client.js`, `index.html`, `locales/`)

---

Campos requeridos en `plugin-manifest.json`:
- `id`: id canónico del plugin, usado como nombre de la carpeta de instalación y como clave del plugin en tiempo de ejecución (regex: `^[a-z0-9][a-z0-9_-]*$`)
- `plugin_version`: cadena de versión del plugin. Es el único lugar donde se declara la versión — no agregues `version` a `plugin.js`; el cargador establece `plugin.version` a partir del manifiesto al iniciar.
- `min_revelation_version`: cadena de versión mínima de REVELation

---

Campos opcionales que se muestran en la interfaz de Configuración:
- `title`, `description`, `author`, `webpage`
- `collaboration` (booleano) — **establécelo en `true` si tu plugin permite que los
  espectadores actúen sobre el espacio de diapositivas compartido en lugar de solo
  observarlo.** Cualquier plugin que acepte mensajes `presenter-plugin:event` de otros
  participantes y cambie lo que se muestra pertenece a esta categoría. Configuración
  muestra una insignia en el plugin, un panel que describe lo que pueden hacer los
  espectadores y un aviso permanente mientras cualquiera de estos plugins esté habilitado.
- `collaboration_detail` (cadena) — un párrafo corto, en lenguaje sencillo, que nombre
  las capacidades específicas que obtiene un espectador. Escríbelo para la persona que
  decide si habilitar el plugin, no para un desarrollador. Si solo una parte del conjunto
  de funciones es colaborativa, es preferible separar esa parte en su propio plugin para
  que el resto pueda usarse sin optar por la colaboración (consulta
  `bibletext` / `bibletext-live`: la búsqueda e inserción de pasajes no tiene la marca de
  colaboración, y el envío de versículos en vivo está en el plugin independiente
  `bibletext-live`, que sí la tiene).

---

**Traducción de las cadenas del manifiesto.** `title`, `description` y
`collaboration_detail` se muestran en Configuración y se traducen desde el
`locales/translations.json` **propio de tu plugin**, no desde el archivo global de la app — el texto
del plugin permanece en la carpeta del plugin. Escribe el manifiesto en inglés y usa ese texto
en inglés como clave de búsqueda, la misma convención que en el resto del proyecto:

```json
// plugins/<id>/locales/translations.json
{
  "es": {
    "Slide Control": "Control de Diapositivas",
    "Allow any connected participant to control slides.": "Permitir que cualquier participante conectado controle las diapositivas.",
    "Any viewer holding the presentation link can drive the deck…": "Cualquier espectador que tenga el enlace…"
  }
}
```

---

Si falta el archivo, la configuración regional o la clave, se usa el texto en inglés del manifiesto,
por lo que las traducciones son opcionales y se pueden agregar más tarde. Es el mismo archivo que
el JS de tu cliente registra mediante `window.translationsources`; el proceso principal lee de él
las cadenas del manifiesto, por lo que no se necesita ningún registro para estas.

> **Por qué es importante.** Tener el id de la sala *es* el permiso en el canal de
> presenter-plugins — no existe un participante de solo lectura ni una forma de
> expulsar a alguien. Declarar `collaboration` es la manera en que un usuario se entera
> antes de compartir un enlace y no después. Consulta la excepción de colaboración en
> `revelation/doc/SECURITY.md` para
> el modelo de confianza que describen estas marcas.

---

Comportamiento del instalador:
- instala en `plugins/<id>` (nunca derivado del nombre del ZIP)
- rechaza ZIPs sin un manifiesto válido en la raíz
- rechaza ZIPs sin `plugin.js` en la raíz
- rechaza la instalación cuando `min_revelation_version` es **mayor** que la versión de la app en ejecución (`lib/pluginDirector.js`, `compareVersions(minRevelationVersion, currentAppVersion) > 0`)

Ejemplo de manifiesto:

```json
{
  "id": "addmedia",
  "plugin_version": "0.2.8",
  "min_revelation_version": "1.0.1beta"
}
```

---

<a id="dev-plugins-bootstrap"></a>

## Arranque del plugin y contrato del cargador

`lib/pluginDirector.js` es el cargador. Al iniciar, hace `require` de `plugins/<name>/plugin.js`
para cada nombre en `config.plugins`, establece `plugin.version` a partir de `plugin-manifest.json`,
ordena por `priority` (predeterminado 100, ascendente) y llama a `register(AppContext)`.

**Qué plugins se habilitan en el primer inicio** lo decide el arreglo `defaultPlugins`
codificado en `lib/configManager.js`. Un plugin instalado más tarde debe ser habilitado por el usuario.

> No existe el campo `defaultEnabled`: para que un plugin esté habilitado por defecto, agrega su id a `defaultPlugins`.

---

Campos de `plugin.js` que el cargador y el resto del wrapper sí leen:

| Campo | Consumido por | Propósito |
|-------|-------------|---------|
| `priority` | pluginDirector | Orden de registro y de carga en el cliente (menor primero) |
| `register(AppContext)` | pluginDirector | Configuración del proceso principal: elementos de menú, ventanas, listeners |
| `configTemplate[]` | Interfaz de Configuración, pluginDirector | Campos de configuración (`type`, `default`; los menús desplegables usan `ui: 'dropdown'` + `dropdownsrc`; `secret: true` para credenciales) |
| `privateConfigKeys` | pluginConfigView | Claves de configuración que son credenciales pero no tienen campo en `configTemplate` |
| `api{}` | IPC `plugin-trigger` | Métodos del proceso principal invocables desde los renderers de admin/constructor. Se llaman como `api[name](event, data)` — `this` es el objeto `api`, no el plugin |
| `presentationApi{}` | IPC `presentation-plugin-trigger` | Igual, pero invocables desde las ventanas de *presentación* (preload_presentation.js). Usado por `captions` y `widgets` |
| `api-server.js` (archivo aparte) | `lib/apiServer.js` | Registra rutas HTTP en la API de control local. Exporta `register(routes, callPlugin, AppContext)`. Consulta [API_REFERENCE.md](../API_REFERENCE.md) |
| `clientHookJS` | pluginloader (navegador) | Script de cliente cargado en las páginas de presentación/admin |
| `exposeToBrowser` | `writePluginsIndex` | Solo los plugins con esto **y** `clientHookJS` aparecen en el `plugins/plugins.json` generado (con los campos de configuración `secret` eliminados) |
| `pluginButtons[]` | barra lateral | Entradas de la barra lateral (ver más abajo) |
| `exportFormats[]` | ventana de exportación | Agrega formatos de exportación del plugin; se activan mediante `plugin-trigger` como `export_<id>` |
| `pluginPeerCommandHandlers` | peerCommandClient | Manejan comandos personalizados de par maestro→seguidor (consulta [PEERING.md](PEERING.md)) |

> **Seguridad: mantén las credenciales fuera de los navegadores.** `plugins.json` (servido en
> `/plugins_<key>/plugins.json`) y la lista de plugins entregada a las páginas del constructor llevan el
> `config` de cada plugin para que el código del cliente pueda leer su configuración. Marca cualquier credencial — una clave de API, contraseña,
> token, o un registro que contenga alguno — con **`secret: true`** en su campo de `configTemplate`. Los campos
> secretos se eliminan de esas vistas dirigidas al navegador; el proceso principal, que lee
> `plugin.config` directamente, aún los ve. Para una credencial sin campo en la plantilla, lista su clave
> en un arreglo `privateConfigKeys: [...]` del plugin. Todo lo demás permanece visible, porque el código
> del cliente lee su configuración de la config que recibe (incluso las claves que no tienen campo en Configuración). Una
> prueba (`tests/pluginSecrets.test.js`) falla si un campo de `configTemplate` con nombre de credencial
> (`key`, `token`, `secret`, `password`, `credential`, `auth`) no está marcado. Configuración es el único
> llamador que recibe la config sin filtrar (`get-plugin-list` con `includeSecrets: true`), porque
> edita y guarda de vuelta el objeto completo. Consulta `lib/pluginConfigView.js`.

---

Ejemplo:

```js
module.exports = {
  priority: 100,
  configTemplate: [
    { name: 'enabled', type: 'boolean', default: true }
  ]
};
```

`builderHooks` no es un concepto del cargador. La integración con el constructor ocurre en el cliente (consulta
"Hooks de menú del Builder" y "Host de extensiones del Builder" más abajo).

---

<a id="dev-plugins-sidebar-buttons"></a>

## Botones de la barra lateral (`pluginButtons`)

Un plugin puede declarar `pluginButtons` en el export de su `plugin.js` para agregar pestañas a la
barra lateral de administración (bajo *Plugins*). Cada entrada debe proporcionar un `title` más **uno** de:

- `page`: un archivo HTML del plugin (relativo al `baseURL` del plugin). Al hacer clic en el
  botón, la ventana de administración navega a esa página (con `?key=…` agregado).
- `action`: el nombre de un método `api` del plugin. Al hacer clic en el botón se llama a
  `electronAPI.pluginTrigger(pluginName, action, {})` en lugar de navegar — úsalo
  cuando el botón deba ejecutar lógica del proceso principal (p. ej., abrir una ventana) en lugar de
  cargar una página.

`action` es una cadena, no una función: `pluginButtons` se serializa hacia el
renderer mediante IPC, por lo que un callback literal no puede vivir en el objeto del plugin
del proceso principal. Coloca la lógica en un método de `api` y haz referencia a él por nombre.

---

```js
// plugin.js
module.exports = {
  pluginButtons: [
    { title: 'My Page',  page: 'index.html' },     // navigates to the page
    { title: 'Do Thing', action: 'do-thing' }      // calls api['do-thing']
  ],
  api: {
    'do-thing': async () => { /* … */ return { success: true }; }
  },
  register(AppContext) { /* … */ }
};
```

---

<a id="dev-plugins-builder-hooks"></a>

## Hooks de menú del Builder

Hooks de plugins del lado del navegador:
- `getContentCreators(context)` (heredado)
- `getBuilderTemplates(context)` (recomendado)
- `getBuilderExtensions(context)` (host de extensiones de la interfaz del constructor)
- `getSlideTools(context)` (menú Slide Markdown Tools y menú contextual del Rich Builder)

Los elementos de plantilla pueden proporcionar:
- `label` o `title`
- `template` / `markdown` / `content`
- `slides` / `stacks`
- `onSelect(ctx)` o `build(ctx)`

---

Los campos de contexto incluyen:
- `slug`, `mdFile`, `dir`, `origin`, `insertAt`
- helper `insertContent(payload)`

Si un callback llama a `insertContent(...)`, la inserción del constructor se considera completa.

---

### Herramientas de diapositiva (`getSlideTools`)

`getSlideTools(context)` agrega entradas al menú 🔧 **Slide Markdown Tools**, después de **Fragment (++)**. El Rich Builder muestra el mismo menú en su barra de herramientas y lista las mismas entradas cuando el usuario hace clic derecho sobre texto en el editor enriquecido.

Devuelve `Array<{ label, onSelect(ctx) }>` (de forma síncrona; `onSelect` puede ser asíncrono). Devuelve `[]` cuando no tengas nada que agregar.

Contexto de `onSelect`:
- `slug`, `mdFile`, `dir`
- `appendToCurrentLine(text)`: agrega `text` al final de la línea donde está el cursor, separado por un espacio (como Fragment (++))
- `getCurrentLine()`: texto de esa línea

No captures nada sobre el cursor por tu cuenta; el host lo conserva mientras un diálogo está abierto.

---

```js
getSlideTools() {
  return [{
    label: '✨ Animation…',
    onSelect: async (ctx) => {
      const mod = await import('./builder.js');
      return mod.openDialog(ctx); // calls ctx.appendToCurrentLine('==:drop')
    }
  }];
}
```

---

### Host de extensiones del Builder (`getBuilderExtensions`)

`getBuilderExtensions(context)` permite a los plugins aportar interfaz y comportamiento opcionales al constructor.

Campos del contexto del hook:
- `host`: objeto de la API BuilderHost
- `slug`: nombre de la carpeta de la presentación
- `mdFile`: archivo markdown activo
- `dir`: prefijo de ruta web para el árbol de la presentación

Valor de retorno esperado:
- `Array<Contribution>` (o `Promise<Array<Contribution>>`)
- Devuelve `[]` para las páginas donde tu plugin no tenga contribución al constructor

---

Tipos de contribución:
- `kind: "mode"`
- `kind: "panel"`
- `kind: "preview-overlay"`
- `kind: "toolbar-action"`
- `kind: "slide-navigator-renderer"`

Campos de contribución compartidos:
- `id` (requerido): clave de cadena única para tu contribución en este plugin
- `label` (requerido para `mode` y `toolbar-action`)
- `icon` (opcional)
- callbacks `mount` / `onClick` / `renderTile` según el tipo de contribución

---

Forma de la contribución de modo:
- `kind: "mode"`
- `id: string`
- `label: string`
- `icon?: string`
- `tooltip?: string` (por defecto `label`)
- `location?: "view-tabs" | "preview-header" | "left-header"` (predeterminado: `preview-header`)
- `exclusive?: boolean` (reservado para una futura agrupación de modos; actualmente hay un solo modo activo globalmente)
- `mount(ctx): ModeInstance`

---

Ubicaciones de los modos:
- `view-tabs` (API versión 2+): agrega una pestaña después de **Visual / Markdown / Split** en el encabezado del constructor. Mientras está activo, el modo reemplaza todo el espacio de trabajo debajo del encabezado; el host le entrega una raíz vacía (`ctx.root`) donde renderizar, visible solo mientras el modo está activo. Al elegir una vista integrada (o `host.setActiveMode('')`) se cierra y se restaura la vista anterior. Úsalo para herramientas que cubren todo el constructor, como el validador o el ordenador de diapositivas.
- `preview-header` / `left-header`: agrega un botón de alternancia al encabezado de la Vista previa en vivo o al encabezado del constructor. El modo no recibe una raíz propia.

Los botones de encabezado simples que no sean modos deben usar una contribución `toolbar-action`.

---

Contexto de montaje del modo:
- `ctx.host`
- `ctx.id`
- `ctx.root` (solo modos `view-tabs`: contenedor propiedad del host que llena el espacio de trabajo; de lo contrario `null`)
- `ctx.slug`
- `ctx.mdFile`
- `ctx.dir`

El montaje ocurre de forma diferida en la primera activación. Para los modos `view-tabs`, la raíz ya es visible cuando se ejecuta `onActivate()`, de modo que el modo puede medirla.

---

Hooks de la instancia del modo (todos opcionales):
- `onActivate()`
- `onDeactivate()`
- `onSelectionChanged(payload)`
- `onDocumentChanged(payload)`
- `dispose()`

Forma de la contribución de panel:
- `kind: "panel"`
- `id: string`
- `mount(ctx): (() => void) | { dispose(): void } | void`

---

Contexto de montaje del panel:
- `ctx.host`
- `ctx.root` (elemento contenedor vacío propiedad del host)
- `ctx.slug`
- `ctx.mdFile`
- `ctx.dir`

Forma de la contribución de superposición de vista previa:
- `kind: "preview-overlay"`
- `id: string`
- `mount(ctx): (() => void) | { dispose(): void } | void`

---

Contexto de montaje de la superposición de vista previa:
- `ctx.host`
- `ctx.root` (contenedor de superposición adjunto al panel de vista previa)
- `ctx.slug`
- `ctx.mdFile`
- `ctx.dir`

Forma de la contribución de acción de barra de herramientas:
- `kind: "toolbar-action"`
- `id: string`
- `label: string`
- `icon?: string`
- `onClick(ctx): void`

---

Contexto del clic de la acción de barra de herramientas:
- `ctx.host`
- `ctx.slug`
- `ctx.mdFile`
- `ctx.dir`

Forma de la contribución de renderizador del navegador de diapositivas:
- `kind: "slide-navigator-renderer"`
- `id: string`
- `renderTile(ctx): HTMLElement | null`

Contexto de `renderTile` del navegador de diapositivas:
- `ctx.slide` (`{ top, body, notes }`)
- `ctx.h`
- `ctx.v`
- `ctx.isActive`
- `ctx.hasTopMatter`

---

API de BuilderHost:
- `version: string` (etiqueta actual del contrato del host)
- `apiVersion: number` (versión entera actual de la API; `2` agregó los modos `view-tabs`)
- `getDocument(): BuilderDocumentSnapshot`
- `getSelection(): { h: number, v: number }`
- `getUiState(): { columnMarkdownMode: boolean, previewReady: boolean, dirty: boolean }`
- `on(eventName, handler): () => void` función para cancelar la suscripción
- `transact(label, fn): void`
- `registerMode(...)`
- `setActiveMode(modeId)` (`''` cierra el modo activo) / `getActiveModeId()` / `hasMode(modeId)`
- `registerPanel(...)`
- `registerPreviewOverlay(...)`
- `registerToolbarAction(...)`
- `registerSlideNavigatorRenderer(renderer)`
- `getSlideNavigatorRenderer()`
- `openDialog(spec): Promise<any>`
- `notify(message, level?)`

---

Nombres de eventos:
- `selection:changed`
- `document:changed`
- `preview:ready`
- `preview:slidechanged`
- `preview:dblclick`
- `history:flush`
- `mode:changed`
- `save:before`
- `save:after`

---

Cargas útiles actuales de los eventos:
- `selection:changed`: `{ h, v, source }`
- `document:changed`: `{ dirty, source }` (la forma puede variar según la fuente)
- `preview:ready`: `{ isOverview }`
- `preview:slidechanged`: `{ indices: { h, v }, isOverview }`
- `preview:dblclick`: `{ indices: { h, v } }` (doble clic dentro de la vista previa, no sobre sus controles, enlaces o medios)
- `history:flush`: `{}` — el historial de deshacer está a punto de tomar una instantánea del documento. Un editor que sincroniza con el documento con retraso debe sincronizar ahora, de forma síncrona, sus ediciones pendientes.
- `mode:changed`: `{ activeModeId, previousModeId, workspace, previousWorkspace }` (las marcas `workspace` son `true` cuando ese modo es un modo `view-tabs`)
- `save:before`: `{ slug, mdFile }`
- `save:after`: `{ slug, mdFile, success }`

---

Deshacer/rehacer:
- El constructor mantiene un único historial de deshacer con instantáneas del documento (`http_admin/builder/history.js`). Cualquier cambio que llegue al documento (una llamada a `transact(...)`, o ediciones sincronizadas en los textareas de las diapositivas) se registra; los plugins no agregan entradas por sí mismos.
- Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z usan este historial en los editores del constructor y fuera de los campos de texto. Los demás campos de texto conservan el deshacer nativo. Marca un editor de plugin que edite el documento con `data-builder-history="document"` para que sus atajos usen el historial del constructor, y sincroniza sus ediciones pendientes en `history:flush`.

Forma de la instantánea de `getDocument()`:
- `slug`, `mdFile`, `dir`
- `frontmatter` (texto YAML crudo del frontmatter)
- `noteSeparator`
- `stacks` (`Array<Array<{ top, body, notes }>>`)

---

Contrato de transacción (`transact(label, fn)`):
- `fn(tx)` recibe los ayudantes de mutación:
  - `setSelection({ h, v })`
  - `moveSlide({ h, v }, { h, v })`
  - `moveColumn(fromH, toH)`
  - `insertSlides({ h, v }, slides)`
  - `splitSlide({ h, v }, { before, after })` — la diapositiva conserva `before` como su cuerpo; se inserta debajo y se selecciona una nueva diapositiva con cuerpo `after` (aunque esté vacío)
  - `replaceColumn(h, slides)`
  - `replaceStacks(stacks)`
- El núcleo aplica la normalización posterior a la transacción, marca el documento como modificado, actualiza la selección y programa la actualización de la vista previa.
- El núcleo sanea los resultados de diapositiva/columna vacíos.
- Los índices inválidos se limitan o se ignoran de forma segura; no debería requerirse ninguna excepción para las comprobaciones normales de límites.

---

Reglas de seguridad y propiedad:
- Nunca mutes directamente los internos del constructor (`state`, nodos del DOM fuera de tu raíz, etc.).
- Trata `getDocument()` como datos de instantánea de solo lectura.
- Muta siempre el contenido mediante `host.transact(...)`.
- Cancela siempre la suscripción de los listeners y desmonta los nodos en las funciones de limpieza/dispose devueltas.
- Maneja los errores en el código del plugin; el host aísla los fallos pero no garantiza reintentos.

Patrón de carga dinámica (recomendado):
- Mantén el código exclusivo del constructor en `builder.js` (o equivalente).
- En `client.js`, carga de forma diferida desde `getBuilderExtensions(...)` solo cuando `context.page === "builder"`.

Ejemplo:

---

```js
// client.js
window.RevelationPlugins.example = {
  init(ctx) {
    this.context = ctx;
  },
  async getBuilderExtensions(ctx) {
    if ((this.context?.page || '').toLowerCase() !== 'builder') return [];
    const mod = await import('./builder.js');
    return mod.getBuilderExtensions(ctx);
  }
};
```

---

<a id="dev-plugins-offline-hooks"></a>

## Hooks de exportación sin conexión

Un plugin puede incluir `offline.js` con hooks opcionales:
- `build(context)` — se ejecuta en tiempo de compilación mediante `scripts/build-offline-plugins.js` (`npm run build`) y de nuevo mediante `lib/exportPresentation.js` justo antes de `export()`; úsalo para comprobaciones baratas de "el bundle/recurso existe" que lancen un error claro (no debe hacer trabajo pesado)
- `export(context)` — lo ejecuta `lib/exportPresentation.js` cuando se genera una exportación independiente/sin conexión

`export(context)` puede devolver:
- `pluginListEntry`
- `headTags`
- `bodyTags`
- entradas `copy` en formato `{ from, to }` (`from` relativo a la carpeta del plugin; `to` relativo a la carpeta `_resources/` de la exportación)

---

Ejemplo:

```js
module.exports = {
  async export(ctx) {
    return {
      pluginListEntry: {
        baseURL: './_resources/plugins/example',
        clientHookJS: 'client.js',
        priority: 100,
        config: {}
      },
      copy: [
        { from: 'client.js', to: 'plugins/example/client.js' },
        { from: 'dist', to: 'plugins/example/dist' }
      ]
    };
  }
};
```

---

<a id="dev-plugins-i18n"></a>

## Localización de la interfaz de plugins

El texto de la interfaz de un plugin debe permanecer dentro de cada plugin, no en el `translations.json` global de la app.

Convención:
- Agrega archivos de configuración regional del plugin en `plugins/<pluginName>/locales/translations.json`
- En las páginas del plugin (`*.html`), agrega ese archivo a `window.translationsources` antes de cargar `/js/translate.js`
- Usa `data-translate` para el texto estático del DOM y `tr('...')` para las cadenas de JS en tiempo de ejecución
- Para los hooks de constructor/tiempo de ejecución (por ejemplo, las etiquetas de `client.js`), el plugin puede agregar su propia fuente de configuración regional desde `ctx.baseURL` y llamar a `loadTranslations()`

Esto mantiene las traducciones de los plugins autocontenidas y evita inflar el archivo central de traducciones.

---

<a id="dev-plugins-specific"></a>

## Referencias específicas de plugins

Las sintaxis markdown específicas de los plugins se documentan en las carpetas de los plugins:
- [plugins/revealchart/README.md](../../plugins/revealchart/README.md)
- [plugins/widgets/README.md](../../plugins/widgets/README.md)
