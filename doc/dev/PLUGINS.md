# Wrapper Plugin Development

---

## Table of Contents
* [Overview](#dev-plugins-overview)
* [Packaging and Manifest](#dev-plugins-packaging)
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

Shared contribution fields:
- `id` (required): unique string key for your contribution in this plugin
- `label` (required for `mode` and `toolbar-action`)
- `icon` (optional)
- `mount` / `onClick` callbacks depending on contribution kind

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
