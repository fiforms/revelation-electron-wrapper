# Wrapper Plugin Development

---

## Table of Contents
* [Overview](#dev-plugins-overview)
* [Packaging and Manifest](#dev-plugins-packaging)
* [Plugin Bootstrap](#dev-plugins-bootstrap)
* [Sidebar Buttons](#dev-plugins-sidebar-buttons)
* [Builder Menu Hooks](#dev-plugins-builder-hooks)
* [Offline Export Hooks](#dev-plugins-offline-hooks)
* [Plugin UI Localization](#dev-plugins-i18n)
* [Plugin-Specific References](#dev-plugins-specific)

---

<a id="dev-plugins-overview"></a>

## Overview

This file documents plugin hooks used by the Electron wrapper builder/export pipeline.

---

<a id="dev-plugins-packaging"></a>

## Packaging and Manifest

Plugin ZIP installs are strict. The ZIP filename is ignored for plugin identity.

Required ZIP layout:
- `plugin-manifest.json` at ZIP root
- `plugin.js` at ZIP root
- any other plugin assets/folders at ZIP root (for example `client.js`, `index.html`, `locales/`)

Required `plugin-manifest.json` fields:
- `id`: canonical plugin id used as install folder name and runtime plugin key (regex: `^[a-z0-9][a-z0-9_-]*$`)
- `plugin_version`: plugin version string
- `min_revelation_version`: minimum REVELation version string

Optional fields surfaced in the Settings UI:
- `title`, `description`, `author`, `webpage`
- `collaboration` (boolean) — **set this to `true` if your plugin lets viewers
  act on the shared slide space rather than only watch it.** Any plugin that
  accepts `presenter-plugin:event` messages from other participants and changes
  what is displayed belongs in this category. Settings shows a badge on the
  plugin, a panel describing what viewers can do, and a standing banner while
  any such plugin is enabled.
- `collaboration_detail` (string) — one short paragraph, in plain language,
  naming the specific abilities a viewer gains. Write it for the person
  deciding whether to enable the plugin, not for a developer. If your plugin
  shares only part of its functionality, say so explicitly (see `bibletext`,
  where only the live-verse feature is shared).

**Translating manifest strings.** `title`, `description` and
`collaboration_detail` are shown in Settings and are translated from **your
plugin's own** `locales/translations.json`, not the app-wide file — plugin text
stays in the plugin folder. Write the manifest in English and use that English
text as the lookup key, the same convention as the rest of the project:

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

A missing file, locale or key falls back to the English text in the manifest,
so translations are optional and can be added later. This is the same file your
client JS registers via `window.translationsources`; manifest strings are read
from it by the main process, so no registration is needed for these.

> **Why this matters.** Holding the room id *is* the permission on the
> presenter-plugins channel — there is no read-only participant and no way to
> eject one. Declaring `collaboration` is how a user finds that out before
> sharing a link rather than afterwards. See `revelation/SECURITY.md` §1.6 for
> the trust model these flags describe.

Installer behavior:
- installs to `plugins/<id>` (never derived from ZIP filename)
- rejects ZIPs without a valid root manifest
- rejects ZIPs without root `plugin.js`
- rejects install when `min_revelation_version` is lower than the current app version

Example manifest:

```json
{
  "id": "addmedia",
  "plugin_version": "0.2.8",
  "min_revelation_version": "1.0.1beta"
}
```

---

<a id="dev-plugins-bootstrap"></a>

## Plugin Bootstrap

Plugins may declare lightweight bootstrap metadata directly on `plugin.js`.

Supported bootstrap fields:
- `defaultEnabled: true` to include the plugin in `defaultConfig.plugins` for new installs

Example:

```js
module.exports = {
  defaultEnabled: true,
  priority: 100,
  configTemplate: [
    { name: 'enabled', type: 'boolean', default: true }
  ]
};
```

---

<a id="dev-plugins-sidebar-buttons"></a>

## Sidebar Buttons (`pluginButtons`)

A plugin may declare `pluginButtons` on its `plugin.js` export to add tabs to the
admin sidebar (under *Plugins*). Each entry must provide a `title` plus **one** of:

- `page`: a plugin HTML file (relative to the plugin `baseURL`). Clicking the
  button navigates the admin window to that page (with `?key=…` appended).
- `action`: the name of a plugin `api` method. Clicking the button calls
  `electronAPI.pluginTrigger(pluginName, action, {})` instead of navigating — use
  this when the button should run main-process logic (e.g. open a window) rather
  than load a page.

`action` is a string, not a function: `pluginButtons` are serialized to the
renderer over IPC, so a literal callback cannot live on the main-process plugin
object. Put the logic in an `api` method and reference it by name.

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

## Builder Menu Hooks

Browser-side plugin hooks:
- `getContentCreators(context)` (legacy)
- `getBuilderTemplates(context)` (recommended)
- `getBuilderExtensions(context)` (builder UI extension host)

Template items may provide:
- `label` or `title`
- `template` / `markdown` / `content`
- `slides` / `stacks`
- `onSelect(ctx)` or `build(ctx)`

---

Context fields include:
- `slug`, `mdFile`, `dir`, `origin`, `insertAt`
- `insertContent(payload)` helper

If a callback calls `insertContent(...)`, builder insertion is considered complete.

---

### Builder Extension Host (`getBuilderExtensions`)

`getBuilderExtensions(context)` lets plugins contribute optional UI and behavior to the builder.

Hook context fields:
- `host`: BuilderHost API object
- `slug`: presentation folder name
- `mdFile`: active markdown file
- `dir`: web path prefix for the presentation tree

Expected return value:
- `Array<Contribution>` (or `Promise<Array<Contribution>>`)
- Return `[]` for pages where your plugin has no builder contribution

Contribution kinds:
- `kind: "mode"`
- `kind: "panel"`
- `kind: "preview-overlay"`
- `kind: "toolbar-action"`
- `kind: "slide-navigator-renderer"`

Shared contribution fields:
- `id` (required): unique string key for your contribution in this plugin
- `label` (required for `mode` and `toolbar-action`)
- `icon` (optional)
- `mount` / `onClick` / `renderTile` callbacks depending on contribution kind

Mode contribution shape:
- `kind: "mode"`
- `id: string`
- `label: string`
- `icon?: string`
- `location?: "preview-header" | "left-header"` (default: `preview-header`)
- `exclusive?: boolean` (reserved for future mode grouping; currently one active mode globally)
- `mount(ctx): ModeInstance`

Mode mount context:
- `ctx.host`
- `ctx.id`
- `ctx.slug`
- `ctx.mdFile`
- `ctx.dir`

Mode instance hooks (all optional):
- `onActivate()`
- `onDeactivate()`
- `onSelectionChanged(payload)`
- `onDocumentChanged(payload)`
- `dispose()`

Panel contribution shape:
- `kind: "panel"`
- `id: string`
- `mount(ctx): (() => void) | { dispose(): void } | void`

Panel mount context:
- `ctx.host`
- `ctx.root` (empty container element owned by the host)
- `ctx.slug`
- `ctx.mdFile`
- `ctx.dir`

Preview overlay contribution shape:
- `kind: "preview-overlay"`
- `id: string`
- `mount(ctx): (() => void) | { dispose(): void } | void`

Preview overlay mount context:
- `ctx.host`
- `ctx.root` (overlay container attached to preview panel)
- `ctx.slug`
- `ctx.mdFile`
- `ctx.dir`

Toolbar action contribution shape:
- `kind: "toolbar-action"`
- `id: string`
- `label: string`
- `icon?: string`
- `onClick(ctx): void`

Toolbar action click context:
- `ctx.host`
- `ctx.slug`
- `ctx.mdFile`
- `ctx.dir`

Slide navigator renderer contribution shape:
- `kind: "slide-navigator-renderer"`
- `id: string`
- `renderTile(ctx): HTMLElement | null`

Slide navigator `renderTile` context:
- `ctx.slide` (`{ top, body, notes }`)
- `ctx.h`
- `ctx.v`
- `ctx.isActive`
- `ctx.hasTopMatter`

BuilderHost API:
- `version: string` (current host contract label)
- `apiVersion: number` (current integer API version)
- `getDocument(): BuilderDocumentSnapshot`
- `getSelection(): { h: number, v: number }`
- `getUiState(): { columnMarkdownMode: boolean, previewReady: boolean, dirty: boolean }`
- `on(eventName, handler): () => void` unsubscribe function
- `transact(label, fn): void`
- `registerMode(...)`
- `registerPanel(...)`
- `registerPreviewOverlay(...)`
- `registerToolbarAction(...)`
- `registerSlideNavigatorRenderer(renderer)`
- `getSlideNavigatorRenderer()`
- `openDialog(spec): Promise<any>`
- `notify(message, level?)`

Event names:
- `selection:changed`
- `document:changed`
- `preview:ready`
- `preview:slidechanged`
- `mode:changed`
- `save:before`
- `save:after`

Current event payloads:
- `selection:changed`: `{ h, v, source }`
- `document:changed`: `{ dirty, source }` (shape may vary by source)
- `preview:ready`: `{ isOverview }`
- `preview:slidechanged`: `{ indices: { h, v }, isOverview }`
- `mode:changed`: `{ activeModeId }`
- `save:before`: `{ slug, mdFile }`
- `save:after`: `{ slug, mdFile, success }`

`getDocument()` snapshot shape:
- `slug`, `mdFile`, `dir`
- `frontmatter` (raw YAML frontmatter text)
- `noteSeparator`
- `stacks` (`Array<Array<{ top, body, notes }>>`)

Transaction contract (`transact(label, fn)`):
- `fn(tx)` receives mutation helpers:
  - `setSelection({ h, v })`
  - `moveSlide({ h, v }, { h, v })`
  - `moveColumn(fromH, toH)`
  - `insertSlides({ h, v }, slides)`
  - `replaceColumn(h, slides)`
  - `replaceStacks(stacks)`
- Core applies post-transaction normalization, marks document dirty, updates selection, and schedules preview refresh.
- Empty slide/column results are sanitized by core.
- Invalid indices are clamped/ignored safely; no exception should be required for normal bounds checks.

Safety and ownership rules:
- Never mutate builder internals directly (`state`, DOM nodes outside your root, etc.).
- Treat `getDocument()` as read-only snapshot data.
- Always mutate content through `host.transact(...)`.
- Always unsubscribe listeners and teardown nodes in returned cleanup/dispose functions.
- Handle errors in plugin code; host isolates failures but does not guarantee retries.

Dynamic loading pattern (recommended):
- Keep builder-only code in `builder.js` (or equivalent).
- In `client.js`, lazy-load from `getBuilderExtensions(...)` only when `context.page === "builder"`.

Example:

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

## Offline Export Hooks

A plugin may include `offline.js` with optional hooks:
- `build(context)`
- `export(context)`

`export(context)` can return:
- `pluginListEntry`
- `headTags`
- `bodyTags`
- `copy` entries in `{ from, to }` format

---

Example:

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

## Plugin UI Localization

Plugin UI text should stay inside each plugin, not in the app-wide `translations.json`.

Convention:
- Add plugin locale files under `plugins/<pluginName>/locales/translations.json`
- In plugin pages (`*.html`), push that file onto `window.translationsources` before loading `/js/translate.js`
- Use `data-translate` for static DOM text and `tr('...')` for runtime JS strings
- For builder/runtime hooks (for example `client.js` labels), the plugin can push its own locale source from `ctx.baseURL` and call `loadTranslations()`

This keeps plugin translations self-contained and avoids central translation-file bloat.

---

<a id="dev-plugins-specific"></a>

## Plugin-Specific References

Plugin-specific markdown syntaxes are documented in plugin folders:
- [plugins/revealchart/README.md](../../plugins/revealchart/README.md)
