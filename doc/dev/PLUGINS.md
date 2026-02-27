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
