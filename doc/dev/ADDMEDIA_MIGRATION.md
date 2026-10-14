# Migration plan: promote the Add Media plugin into core

Status: **planned, not started** (written 2026-10-14). Tracked from [TODO.md](../../TODO.md).

## Why

The rule for this project is that core must not depend on specific plugins by name, apart from the short
`defaultPlugins` list in `lib/configManager.js`, and must never look for functions inside a plugin.
A plugin should reach core through hooks.

A search for violations of that rule found the places listed below. The `divideslides`, `credit_ccli` and
`popplerpdf` ones are fixed (generic hooks, a downloadable-plugin catalog). `addmedia` is the last one, and a
hook layer is the wrong fix for it:

* Core does not use it optionally. It **is** the media-import feature: the builder's media menu, drag-and-drop,
  the PDF/PowerPoint import page and "process missing media" all drive it.
* It would need a hook per capability (single file, audio, bulk images, drop, PDF, PPTX, library picker,
  missing-media scan) and still ship exactly one provider.
* It is already tied into core. The plugin `require`s `lib/mediaLibrary.js`, `lib/libreofficeResolver.js`,
  `lib/pathSafety.js` and `lib/frontMatter` by path; two core pages call it by name; `popplerpdf` writes into
  `pluginConfigs.addmedia`.

**Decision: move it into core, keeping behaviour identical**, in stages that can each be committed and reverted.

## Current coupling (what the audit found)

| Where | What |
|---|---|
| [http_admin/import-presentation.js](../../http_admin/import-presentation.js) (`callAddMedia`) | `pluginTrigger('addmedia', 'bulk-import-pdf' \| 'bulk-import-pdf-file', …)` and an "Add Media plugin is not loaded" error |
| [http_admin/builder/media.js](../../http_admin/builder/media.js) | `pluginTrigger('addmedia', 'add-selected-audio' \| 'addmedia', …)`; return key `addmedia:builder:<slug>:<md>:<ts>` |
| `plugins/popplerpdf/plugin.js` | writes `pluginConfigs.addmedia.pdftoppmPath` / `pdfinfoPath` and the live `AppContext.plugins.addmedia.config` |
| `plugins/virtualbiblesnapshots/api-server.js` | mirrors the format of `GET /api/addmedia/item` (comment-level, but a shared contract) |
| `lib/configManager.js` | `defaultPlugins` lists `addmedia` |
| tests | `pluginCorrectness.test.js`, `pluginCorrectnessFixes.test.js`, `mainProcessSmallFixes.test.js` (docs-presentation entries for `plugins/addmedia/README.md`) |
| `localStorage` keys | `addmedia:selected:<slug>:<md>` (picker pages), `addmedia.bulkPdfAdvanced` |

## What exists in the plugin today

`plugins/addmedia/` (about 2,650 lines):

* `plugin.js` (1,157 lines, main process): `register()`, `configTemplate` (`pdftoppmPath`, `pdfinfoPath`) and an
  `api{}` of 18 handlers reached through `plugin-trigger`: `get-next-folder-name`, `check-folder-exists`,
  `addmedia`, `add-selected-file`, `add-selected-audio`, `open-library-dialog`, `open-bulk-image-dialog`,
  `open-bulk-pdf-dialog`, `insert-selected-media`, `process-missing-media`, `bulk-add-images`,
  `bulk-add-images-from-paths`, `bulk-add-images-from-drop`, `bulk-add-audio-from-drop`, `bulk-pdf-select`,
  `bulk-pptx-select`, `bulk-import-pdf`, `bulk-import-pdf-file`.
* `dialogHandler.js` (opens the add-media window), `popplerResolver.js` (finds `pdftoppm`/`pdfinfo`).
* `api-server.js`: HTTP routes `GET /api/addmedia/search` and `GET /api/addmedia/item`, loaded by
  `apiServer._loadPluginRoutes()`.
* Pages: `add-media.html/.js`, `bulk-import.html/.js`, `bulk-pdf.html/.js`, `media-picker.html/.js`,
  `create-edit.css`.
* `client.js` (520 lines, browser): the `window.RevelationPlugins.addmedia` entry, with builder drag-and-drop
  (image/video/audio), bulk-image menu items and the PDF dialog launchers.
* `i18n/es/README.md`, `README.md`, `plugin-manifest.json`.

## Target layout

| Today | After |
|---|---|
| `plugin.js` handlers | `lib/mediaImport.js` (single file, audio, bulk images, drop, library insert, missing-media scan) and `lib/pdfImport.js` (PDF/PPTX, Poppler, speaker notes), registered from a small `lib/mediaImportIpc.js` (or the existing registration pattern) as `ipcMain.handle('media-import:<name>')` |
| `popplerResolver.js` | `lib/popplerResolver.js` |
| `dialogHandler.js` + the three `open-*-dialog` handlers | `lib/mediaImportWindows.js` |
| pages (`*.html/.js`, css) | `http_admin/media-import/…` |
| `client.js` | `http_admin/builder/media-drop.js` (plain builder module, not a `RevelationPlugins` entry) |
| `api-server.js` | `lib/mediaApiRoutes.js`, registered by `apiServer` core routes |
| `pluginTrigger('addmedia', name, data)` | `window.electronAPI.mediaImport.<name>(data)` (preload exposes it) |
| `pluginConfigs.addmedia.{pdftoppmPath,pdfinfoPath}` | core config `pdftoppmPath` / `pdfinfoPath` with Settings fields |

Keep `lib/pathSafety.js` confinement for every renderer-supplied `slug`/`mdFile`/filename, and escape anything
placed in `innerHTML` (CLAUDE.md working rules). Reuse the existing front-matter, escape and path helpers; do
not add new copies (see [REFACTOR_CANDIDATES.md](REFACTOR_CANDIDATES.md)).

## Stages

Each stage is one commit (two when the `revelation/` submodule is touched: submodule first, then the wrapper
with the pointer). Run `npm run tests` after each. The dialogs are Electron windows, so a human click-through
(checklist below) is needed; do not launch Electron from an agent session.

1. **Main-process engine.**
   * Split `plugin.js` into the `lib/` modules above without changing logic. Convert the `api{}` handlers into
     `ipcMain.handle('media-import:*')` channels. Handlers currently receive `(_event, data)`, so signatures can
     stay the same.
   * Add a `mediaImport` namespace to `preload.js` (and to any other preload whose windows call it).
   * Keep the plugin working during this stage if practical (thin delegating `api{}`), so stages 2 and 3 can be
     tested independently. Remove the delegation in stage 6.
   * Repoint `tests/pluginCorrectness.test.js` (`process-missing-media`) at the new module.

2. **UI pages.**
   * Move the four pages and `create-edit.css` to `http_admin/media-import/`. They are served today through
     `/plugins_<key>/addmedia/…`, so `lib/mediaImportWindows.js` must build URLs for the new location
     (`buildServerURL` from `lib/serverUrl.js`; do not add another URL builder).
   * They currently call `pluginTrigger('addmedia', …)`; switch to `electronAPI.mediaImport.*`.
   * Check whether the new paths are covered by the `http_admin` static serving and security headers/CSP the
     other admin pages get.
   * Decide on the `localStorage` keys: keep them (no migration needed) or rename and accept losing the saved
     "advanced" PDF toggle.

3. **Builder client.**
   * Move the drop handling and menu items from `client.js` into `http_admin/builder/media-drop.js`, wired up
     from the builder's existing event setup (`http_admin/builder/events.js`).
   * Anything it does through `RevelationBuilderHost` (for example `host.transact('addmedia:drop-media', …)`)
     keeps using the host API.
   * Update `builder/media.js` (audio pick, add-media launcher) and `import-presentation.js` to call
     `electronAPI.mediaImport.*`; drop the `window.electronAPI?.pluginTrigger` guards and the "plugin is not
     loaded" error text and its translation.
   * Rename the `addmedia:builder:` return key to something neutral.

4. **Poppler config.**
   * Move `pdftoppmPath` / `pdfinfoPath` to core config and Settings (a "PDF import" group). Remove them from the
     deleted plugin's `configTemplate`.
   * `popplerpdf` should stop writing to `pluginConfigs.addmedia` and instead provide the paths to core through
     a registry on `AppContext` (the same pattern as `pluginPeerCommandHandlers` and
     `presentationUrlParamProviders`), for example `AppContext.pdfToolPathProviders`. It already has its own
     `hasPayload()` hook for the first-run installer.
   * Migration question (below): carry over a user's custom paths once, or require re-entry.

5. **HTTP API.**
   * Move the two routes into core routes. Keep the `/api/addmedia/*` names as the stable, documented ones, or
     add `/api/media/*` and keep the old names as aliases for at least one release (decision below).
   * Check `plugins/virtualbiblesnapshots/api-server.js` still matches the response format; consider sharing the
     helper instead of mirroring it.
   * Update the API documentation and any external-client notes.

6. **Retire the plugin.**
   * Remove `addmedia` from `defaultPlugins`. On config load, drop `addmedia` from a saved `plugins` list and
     delete a leftover `pluginConfigs.addmedia` entry, so users who had it enabled do not see a "plugin not
     found" warning.
   * Delete `plugins/addmedia/`. Move its README into core docs with its Spanish translation; keep
     `tests/mainProcessSmallFixes.test.js` (docs-presentation entries) in sync, since it asserts
     `plugins/addmedia/README.md` and `i18n/es`.
   * Update AGENTS.md, ARCHITECTURE.md (§ where plugins are listed, and the "where do I change…?" table),
     PLUGINS.md and the settings docs. Remove the entry for this item from the TODO.
   * Final check: re-run the name search from the original audit (see "Verification") and confirm no core file
     names a non-default plugin, or any plugin function.

## Decisions to make before starting

1. **Losing the disable option.** The plugin is on by default, so promoting it means users can no longer turn it
   off. This is expected to be fine, but confirm.
2. **HTTP route names.** Keep `/api/addmedia/*`, or introduce `/api/media/*` with aliases (stage 5).
3. **Poppler paths.** Migrate a user's custom `pdftoppmPath`/`pdfinfoPath` once, or require re-entry. (The CCLI
   number migration was handled by requiring re-entry.)
4. **`localStorage` keys** for the picker and the PDF "advanced" toggle (stage 2).
5. **Module naming.** `lib/mediaImport*.js` vs. grouping under `lib/media/`; follow whatever `lib/mediaLibrary.js`
   neighbours suggest at the time.

## Risks

* **Size.** About 2,650 lines move. Most of it is relocation, not rewriting, but it touches Settings, preload,
  the builder, the API and the docs, so keep stages small.
* **Untested UI.** The import dialogs cannot be exercised by `npm run tests`. Rely on the unit tests that exist
  plus the manual checklist.
* **Offline export and other consumers.** `plugins/addmedia` has no `exposeToBrowser` flag and no `offline.js`,
  so it is not part of offline exports. Confirm nothing in the export or hosted-presentation path loads its
  `client.js` before deleting it.
* **Second-order references.** Docs, translations ("The Add Media plugin is not loaded…"), and the first-run
  text mention the plugin by name; search for them in stage 6.

## Manual verification checklist

Do these in the real app after stages 2, 3 and 6.

* Builder: Add Media dialog (single image, video, audio) inserts the right markdown and front-matter alias.
* Builder: drag-and-drop of an image, a video and an audio file; drop of several images at once.
* Builder: bulk image import from a folder; check the numbered `image_import_NN` folder.
* Builder: media-library picker (insert from `_media`).
* Builder: "process missing media" on a presentation with unresolved links.
* Import page: PDF import and PowerPoint import (needs Poppler and LibreOffice). Check the speaker notes and the
  `pdf_import_NN` folder.
* Settings: PDF tool paths show, save and are used; with `popplerpdf` installed they fill in automatically.
* HTTP API: `GET /api/addmedia/search?query=…` and `/item?filename=…` still return the same shapes.
* A profile that had `addmedia` enabled starts without warnings.

## Verification (the audit search)

Re-run the original check for core files naming plugins. From the repo root, build the plugin-name list from
`ls plugins` and grep core (`main.js`, `preload*.js`, `lib/`, `http_admin/`, `scripts/`, and in `revelation/`
the `js/`, `server/`, HTML and vite files) for those names, excluding comments and generic words (`test`,
`resources`, `math`, `highlight`). Also search for `pluginTrigger(`, `pluginConfigs.`, `RevelationPlugins.<name>`
and `require(…plugins…)`. The only allowed hits are the `defaultPlugins` list, the generic hook loops, and the
`lowerthirds` screen variant, if you decide that stays a core display mode.

Related finished work (for context): `onBuilderSmartPasteSplit` (divideslides), `getPresentationUrlParams` /
`getMacroMenuItems` / `AppContext.presentationUrlParamProviders` (credit_ccli) and
`lib/downloadablePlugins.json` (popplerpdf). These are documented in
[BUILDER_EXTENSIONS.md](BUILDER_EXTENSIONS.md) and [ARCHITECTURE.md](ARCHITECTURE.md).
