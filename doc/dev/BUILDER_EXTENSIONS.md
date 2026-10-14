# Extending the Builder (plugin authors)

This guide is for plugin authors who want to add UI to the presentation builder (`http_admin/builder.html`). The
source of truth is the header comment of `http_admin/builder/extensions-host.js`; this page explains how to use it.

Builder code runs in the renderer. A plugin reaches it through its `clientHookJS` file, which registers an object at
`window.RevelationPlugins[name]` (see [PLUGINS.md](PLUGINS.md)). `/js/pluginloader.js` loads it, and the builder
calls the hooks below. Check `context.page === 'builder'` in `init(context)` if the same file also loads on other pages.

---

## Hooks on `window.RevelationPlugins[name]`

| Hook | Purpose |
|------|---------|
| `getBuilderExtensions({ host, slug, mdFile, dir })` | Returns an array of contributions (modes, panels, overlays, toolbar buttons, navigator renderer). Awaited once at builder start, in plugin `priority` order. |
| `getBuilderTemplates()` | Entries for the **Content** menu (`{ label, onSelect }`). |
| `getContentCreators()` | Older form of the same menu; still used by `bibletext`, `hymnary`, `adventisthymns` and `addmedia`. |
| `getSlideTools()` | Entries for the **Slide Tools** menu (and the Rich Builder right-click menu). |
| `getAnimationTools()` | Entries (`{ label, onSelect(ctx) }`) for the Rich Builder's **Animation** toolbar menu; `appearance` uses it for "Appearance Animation…". |
| `onRichFragmentEdit(payload)` | Called when a fragment (`++` / `==`) is clicked in the Rich Builder. `payload` is `{ marker, symbol, setMarker(newMarker), remove() }`; return `true` (or a promise of `true`) if handled, otherwise the built-in marker editor opens. `appearance` uses it for its animation dialog. |
| `onBuilderSmartPaste(payload)` | Transforms clipboard content on paste. |
| `onBuilderSmartPasteSplit(markdown)` | Splits the pasted (already transformed) text into slides; return the divided markdown string, or `null` if the user cancels. The first plugin by priority that implements it replaces the built-in ~60-word chunking. `divideslides` uses it. |

Prefer `getBuilderExtensions` for anything new. An unrecognised entry is ignored, and an exception in one plugin is
logged without affecting the others.

---

## Contributions

Each entry of the array has a `kind` and an `id` (unique string). `mount` functions may return a dispose function, or
an object with `dispose()`.

| `kind` | Fields | What you get |
|--------|--------|--------------|
| `mode` | `id`, `label`, `mount({ host, root, slug, mdFile, dir })`, optional `icon`, `tooltip`, `exclusive` (default true), `location`: `'preview-header'` (default), `'left-header'` or `'view-tabs'` | A button that toggles a workspace you render into `root`. `view-tabs` puts it beside the Visual / Markdown / Split tabs. |
| `panel` | `id`, `mount({ host, root, ... })` | A section in the left-hand panel column. |
| `preview-overlay` | `id`, `mount({ host, root, ... })` | A layer over the preview. |
| `toolbar-action` | `id`, `label`, `onClick({ host, ... })`, optional `icon` | A toolbar button. |
| `slide-navigator-renderer` | `renderTile` | Replaces how slide tiles are drawn in the navigator (one renderer wins). |

---

Example:

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

`window.RevelationBuilderHost` (`version` `1.0`, `apiVersion` `2`) is the only supported way to touch builder state.
Do not import builder modules or use the `__revelationBuilderHostInternal*` hooks.

**Reading**

- `getDocument()` returns a deep copy: `{ slug, mdFile, dir, frontmatter, noteSeparator, stacks }`.
- `getMetadata()` returns the parsed front matter.
- `getSelection()` returns `{ h, v }`.
- `getUiState()` returns `{ columnMarkdownMode, previewReady, dirty }`.

---

**Changing the document.** Use `transact(label, fn(tx))`; it is the undo-safe path. It marks the document dirty and
refreshes the preview, and undo history records the result. Inside `fn`, `tx` has `setSelection`, `moveSlide`,
`moveColumn`, `insertSlides`, `splitSlide`, `replaceColumn`, `replaceStacks` and `mergeMediaEntries`. Never edit the
`stacks` object you got from `getDocument()`; it is a copy.

**Registering** (each returns an unregister function): `registerMode`, `registerPanel`, `registerPreviewOverlay`,
`registerToolbarAction`, `registerPreviewButton`, `registerKeyboardShortcut({ key, ctrl, shift, alt, onTrigger })`,
`registerSlideNavigatorRenderer`, `registerSaveGuard(fn)`. A save guard receives `{ slug, mdFile }` and may return
(or resolve to) `false` to cancel the save.

---

**UI helpers:** `openDialog({ title, message, render })` returns a promise for the dialog result, and `notify(message,
level)` shows a toast (`'info'`, `'warn'`, `'error'`). `setActiveMode(id)` and `getActiveMode()` control modes.

**Events:** `host.on(name, fn)` returns an unsubscribe function. Names: `selection:changed`, `document:changed`,
`mode:changed`, `preview:ready`, `preview:slidechanged`, `preview:dblclick`, `preview-button:changed`, `save:before`,
`save:after`, `history:flush`.

## Real examples

- `plugins/bibletext/client.js`: `getBuilderExtensions` plus a `Ctrl+T` shortcut.
- `plugins/richbuilder/builder.js`: a full rich-text editing mode.
- `plugins/divideslides/client.js`: a `getBuilderTemplates` entry that lazy-loads its dialog.
