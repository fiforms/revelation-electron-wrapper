# Wrapper Plugin Development

---

## Table of Contents
* [Overview](#dev-plugins-overview)
* [Builder Menu Hooks](#dev-plugins-builder-hooks)
* [Offline Export Hooks](#dev-plugins-offline-hooks)
* [Plugin-Specific References](#dev-plugins-specific)

---

<a id="dev-plugins-overview"></a>

## Overview

This file documents plugin hooks used by the Electron wrapper builder/export pipeline.

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

<a id="dev-plugins-specific"></a>

## Plugin-Specific References

Plugin-specific markdown syntaxes are documented in plugin folders:
- [plugins/revealchart/README.md](../../plugins/revealchart/README.md)
