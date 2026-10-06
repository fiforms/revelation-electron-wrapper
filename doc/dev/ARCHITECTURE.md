# Wrapper Architecture

How the **revelation-electron-wrapper** app is put together, and where to look when you need to
change something. Written from a full read of the codebase on 2026-10-05.

The framework internals (markdown compiler, Reveal.js runtime, Vite middleware, security tiers) are
documented in the submodule: [revelation/doc/ARCHITECTURE.md](../../revelation/doc/ARCHITECTURE.md) and
[revelation/doc/SECURITY.md](../../revelation/doc/SECURITY.md). This file covers the Electron side and how
the two halves meet.

**Related docs:** [AGENTS.md](../../AGENTS.md) (entry point) · [PLUGINS.md](PLUGINS.md) ·
[PEERING.md](PEERING.md) · [REVEL_IMPLEMENTATION.md](REVEL_IMPLEMENTATION.md) · [BUILDER.md](BUILDER.md) ·
[BUILDING.md](BUILDING.md) · [KNOWN_ISSUES.md](KNOWN_ISSUES.md) · [REFACTOR_CANDIDATES.md](REFACTOR_CANDIDATES.md)

---

## 1. The big picture

```
┌──────────────────────────── Electron main process (main.js + lib/*) ────────────────────────────┐
│  AppContext (one shared object)                                                                   │
│  config · plugins · windows · translations · mDNS peers · callbacks (menu actions)                │
│                                                                                                   │
│  lib/serverManager ──spawns──▶  Vite utilityProcess  (revelation/vite.config.js + vite.plugins.js)│
│  lib/apiServer     ──listens──▶ 127.0.0.1:8900  (control API; second HTTP server)                 │
│  lib/mdnsManager, peerCommandClient  ◀── LAN peers (Bonjour + Socket.IO)                          │
│  lib/*Window.js    ──creates──▶ BrowserWindows ────┐                                              │
└────────────────────────────────────────────────────┼──────────────────────────────────────────────┘
                                                     │ preload*.js (contextBridge, `electronAPI`)
                                                     ▼
┌─────────────── Renderer windows: web pages served by the Vite server on :8000 ────────────────────┐
│  /admin/*          http_admin/   (builder, settings, create, export, import, about …)            │
│  /presentations.html, /media-library.html   revelation/  (library + media library, sidebar.js     │
│                    injected when `window.electronAPI` exists)                                     │
│  /presentations_<key>/<slug>/   revelation/presentation.html → Reveal.js deck (+ plugin clients)  │
└───────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Three ideas explain most of the design:

1. **The UI is web pages, not Electron-bundled HTML.** Nearly every window loads a URL from the local
   Vite server. Only the splash, first-run language window and profile dialog use `loadFile`. A new
   admin screen is therefore an HTML/JS file in `http_admin/` plus a window opener in `lib/`.
2. **Renderer ↔ main goes through `electronAPI` only.** `preload.js` exposes ~130 methods; each is an
   `ipcRenderer.invoke/send` to a handler registered in `lib/`. No Node APIs reach pages.
3. **Everything optional is a plugin.** Plugins have a main-process half (`plugin.js`) and a browser
   half (`client.js`, loaded into presentation and admin pages). See [PLUGINS.md](PLUGINS.md).

---

## 2. Repository map

| Path | What lives there |
|------|------------------|
| `main.js` | Entry point (~330 lines of wiring): startup/shutdown, `reload-servers` / `relaunch-app` IPC. Delegates to `lib/startupGuards.js`, `appResources.js`, `appContext.js`, `mainWindow.js`, `firstRunWizard.js` |
| `preload*.js` | Five bridges — see §5 |
| `lib/` (59 files) | Main-process modules — see §4 |
| `http_admin/` | Admin pages served at `/admin/` — see §6 |
| `plugins/` | 34 bundled plugins + generated `plugins.json` — see [PLUGINS.md](PLUGINS.md) and §8 |
| `revelation/` | **Git submodule** — the framework (Vite server, compiler, Reveal.js runtime, themes, peer server) |
| `WordPress/` | PHP plugin source (`revelation-presentations/`) + gitignored build output |
| `scripts/` | Install, build, packaging and asset-fetch scripts — see [BUILDING.md](BUILDING.md) |
| `gnome-extension/`, `kwin-script/` | Wayland window-placement helpers (§9) |
| `doc/` | User and developer docs (`doc/i18n/es/` Spanish) |
| `assets/`, `build-resources/` | Icons, splash, default backgrounds; electron-builder resources |
| `bin/` | Bundled binaries (effectgenerator; ffmpeg on mac/win) — gitignored downloads |
| `dist/` | Installer output (gitignored) |

Root docs: `README.md` (users), `QUICKSTART.md`, `CHANGELOG.md`, `ROADMAP.md` (planned), `TODO.md`
(deliberately-deferred work and security findings), `AGENTS.md` / `CLAUDE.md` (agent onboarding).

---

## 3. Process model and servers

| What | Where | Port | Notes |
|------|-------|------|-------|
| **Vite server** | `utilityProcess` started by `lib/serverManager.js`; code in `revelation/vite.config.js` + `vite.plugins.js` | `viteServerPort` (default **8000**) | Serves admin pages, presentations, plugin files, thumbnails, `index.json`, `/peer/*`; hosts the Socket.IO servers below. Bound to `localhost` or the LAN per `mode` (`localhost` \| `network`). |
| **Control API** | `lib/apiServer.js` (in the main process) | `apiServerPort` (default **8900**) | `127.0.0.1` only; **on by default** (`apiServerEnabled`). Routes from `presentationControlRoutes.js` and each plugin's `api-server.js`. Responses are YAML unless `?format=json`. See [API_REFERENCE.md](../API_REFERENCE.md). |
| **Reveal Remote** broker | Socket.IO server, path `/socket.io`, in the Vite process | (shares Vite) | Not a separate process. Enabled only in network mode. |
| **Peer commands** | Socket.IO server, path `/peer-commands` (`revelation/server/peer-server.js`) | (shares Vite) | RSA-authenticated master → follower channel. |
| **Presenter plugins** | Socket.IO server, path `/presenter-plugins-socket` | (shares Vite) | Rooms for collaboration plugins. |

> The "three namespaces" in older docs are really three separate Socket.IO servers on three `path`s
> (all use the default `/` namespace). The public relay (`REVELATION_PUBLIC_SERVER=1`) mounts only the
> first and third — see [PUBLIC_RELAY.md](PUBLIC_RELAY.md).

`serverManager` also writes `revelation/reveal-remote.js` at startup (it configures
`window.revealRemoteServer`, `presenterPluginsPublicServer`, `presenterLiveRoomId`) and passes the
presentations dir, access key, plugin dir, admin dir and ffmpeg path to the Vite process via
`*_OVERRIDE` environment variables. Main → Vite messaging uses `serverManager.requestVite()` over
`parentPort`; there is no HTTP between them.

---

## 4. Main process (`main.js` + `lib/`)

### 4.1 Startup sequence

1. **Before `ready`** (`main.js`, helpers in `lib/startupGuards.js`, `lib/appResources.js`, `lib/appContext.js`):
   silence `console` unless `--enable-debug`; install an `uncaughtException` guard;
   `ensureWritableResources()` mirrors `resources/{revelation,plugins}` into `<userData>/resources`
   when the install dir is read-only (re-synced when the bundled revelation version changes);
   `loadConfig()`; build `AppContext`; load `http_admin/locales/translations.json`;
   `X.register(ipcMain, AppContext)` for 18 modules; take the single-instance lock and wire `open-file`
   (`.revel`).
2. **`app.whenReady()`:** splash → resolve ffmpeg → first-run language prompt (may relaunch) → regenerate
   the docs presentation if the app version changed → `serverManager.startServers` → IP watcher →
   `mdnsManager.refresh` → `peerCommandClient.start` → `apiServer.start` →
   `openedPresentation.cleanupOnStartup` → create the main window → hand off from splash → apply menu,
   zoom, URL-publish, always-open screens → update check.
3. **Shutdown:** `before-quit` stops mDNS, peer client, API server, IP watcher, Vite.
   The main window's `close` is vetoed while other windows are open.

`AppContext.reloadServers()` (IPC `reload-servers`, also called by Settings resets) restarts Vite,
rebuilds the menu and plugin index, refreshes mDNS and recreates the main window.

> Known issue: the single-instance lock is taken *after* config load and log truncation
> (KNOWN_ISSUES C1).

### 4.2 `AppContext`

The one shared object passed to every module's `register(ipcMain, AppContext)`:
`win`, `hostURL` (always `'localhost'`), `hostLANURL`, `config`, `plugins{}`, `translations{}`,
`mdnsPeers[]`, `pairedPeerCache`, `profileList[]`, `callbacks{}` (the `menu:*` action registry),
`pluginPeerCommandHandlers`, `preload` / `presentationPreload` / `handoutPreload` paths, `currentMode`,
plus methods `log`, `error`, `translate`, `saveConfig`, `callback`, `applyZoomFactorToAllWindows`,
`reloadServers`. Modules add fields at runtime (`allPluginFolders`, `presenterLiveRoomId`, …) — grep for
`AppContext\.` before assuming a field exists.

### 4.3 Module map (`lib/`)

**Windows and UI shell**

| File | Role |
|------|------|
| `mainWindow.js` | Main window (library/Settings), application menu translation, always-open screen scheduling |
| `firstRunWizard.js`, `popplerInstaller.js`, `popplerRelease.js` | First-run language/setup window + `first-run:*` IPC; PopplerPDF plugin download/install; **per-release Poppler URLs + SHA-256 hashes (edit `popplerRelease.js` when ZIPs are republished)** |
| `presentationWindow.js` | Fullscreen presentation viewer, speaker-notes window, additional screens, URL-publish file, always-open modes, hotkeys, Wayland placement |
| `presentationBuilderWindow.js` | Builder window + markdown/variant file IPC (`save-presentation-markdown`, …) |
| `createPresentation.js` | New Presentation / Edit Metadata windows and file creation |
| `exportWindow.js` | Export window; offscreen slide capture; images / raster PDF / PPTX |
| `handoutWindow.js`, `pdfExport.js` | Handout window; vector PDF via hidden window + `printToPDF` |
| `settingsWindow.js`, `peerPairingWindow.js`, `aboutWindow.js`, `profileWindow.js`, `splashWindow.js` | Settings navigation + resets; Settings → Peer Pairing; About; profile dialog/switching; splash |
| `mainMenu.js` | Builds the menu template; clicks call `AppContext.callback('menu:*')` |
| `loadWatchdog.js` | Polls page readiness and reloads up to twice |
| `otherEventHandlers.js` | ~45 miscellaneous IPC handlers + debug/doc menu callbacks (dumping ground — candidates for splitting) |

**Config and runtime**

| File | Role |
|------|------|
| `appContext.js`, `startupGuards.js`, `appResources.js` | `AppContext` factory + zoom helpers; debug silencing, crash guard, HTTPS cert trust; writable `<userData>/resources` mirror |
| `configManager.js` | Load/save/migrate config; profiles; generates the access key, mDNS ids and **two** RSA keypairs (WordPress vs peer pairing — deliberately separate) |
| `serverManager.js` | Vite lifecycle, port selection, LAN IP watcher, media tokens, `requestVite`, `writeRevealRemoteJSFile` |
| `serverUrl.js` | `buildServerURL(host, port, https)` (used ~25×) |
| `certManager.js`, `ffmpegResolver.js`, `libreofficeResolver.js`, `linuxFileIcon.js`, `updateChecker.js` | Self-signed cert; binary discovery; `.revel` icon/MIME on Linux; GitHub release check |
| `gnomeWindowHelper.js`, `kwinWindowHelper.js`, `windowTitleToken.js` | Wayland placement (§9) |
| `docsPresentationBuilder.js`, `themeThumbnailer.js`, `testPresentationInstaller.js` | Generates the in-app "readme" docs presentation; dev tools for theme thumbnails and a markdown fixture |

**Content: import, export, media**

| File | Role |
|------|------|
| `importPresentation.js` | Import `.revel`/`.zip` or hosted URL; recover missing media |
| `exportPresentation.js` | `.revel` export and standalone offline `.zip` website (works *inside* the presentation folder and cleans up in `finally`) |
| `httpUtil.js` | Bounded streaming downloads: `downloadToFile` (to disk, hashed, 8 GiB cap, idle timeout, redirect limit, exclusive create) and `fetchBuffer` (small bodies); used by URL import and `downloadToTemp` |
| `pathSafety.js` | Basename / containment checks for untrusted names (`assertSafeBasename`, `isSafeMediaFilename`, `resolveInside`); used by media import, export and the media library |
| `revelFormat.js` | `.revel` rules: prohibited extensions, SVG sanitizer, size limits, `planRevelContents`, read/write archive. No Electron dependency |
| `openedPresentation.js`, `originMark.js` | Read-only open of a `.revel` into the transient `_current_open` slug; Mark-of-the-Web / quarantine propagation |
| `mediaLibrary.js`, `mediaUsageScanner.js` | The `<presentationsDir>/_media` library: hash-store, sidecars, thumbnails, large variants, AV1→H.264 transcode queue; usage scan |
| `presentationManifest.js` | `manifest.json` builder (presentationId, per-file sha1) |
| `presentationSyncPeers.js`, `presentationSyncPlan.js` | Per-machine sync peer store; pure 3-way plan `computeSyncPlan` (used by `wordpress_publish`) |

**Peering and API**

| File | Role |
|------|------|
| `peerAuth.js` | Re-exports `revelation/server/peer-protocol.js` (RSA keygen, fingerprints, domain-separated signatures, protocol v2) through `revelationModules.js`; the master uses the same file |
| `revelationModules.js` | Loads a pure module from the submodule's `server/` folder (checkout, or `resources/revelation` when packaged; never the userData mirror) |
| `peerHttp.js`, `peerPairing.js`, `peerFollowers.js`, `peerCommandClient.js`, `mdnsManager.js` | Follower HTTP client; pairing; master-side follower store; follower Socket.IO client + master fan-out; Bonjour browse/publish |
| `apiServer.js`, `presentationControlRoutes.js` | Control API server; core `/api/presentation/*` routes |
| `pluginDirector.js` | Plugin load/register, ZIP install, `plugins.json`, plugin IPC |
| `pluginConfigView.js` | Which plugin config reaches browsers: removes `secret: true` fields and `privateConfigKeys` from `plugins.json` and the browser-facing plugin list |
| `pluginBootstrap.js` | Empty module, no importer (dead) |

### 4.4 IPC

There are ~94 channels. The authoritative lists are the preload files (renderer side) and
`ipcMain.handle/on` calls (main side). Quick way to enumerate both:

```bash
grep -rhoE "ipcMain\.(handle|on|once)\('[^']+'" main.js lib | sort -u
grep -hoE "ipcRenderer\.(invoke|send|on)\('[^']+'" preload*.js | sort -u
```

Ownership by file: `otherEventHandlers.js` (config, peers, displays, clipboard, macros, GNOME helper,
misc), `mediaLibrary.js` (`hash-and-store-media`, `get-used-media`, `delete-media-item`, large-variant
ops), `importPresentation.js` (`import-*`, `open-import-presentation`), `exportWindow.js`
(`export-presentation-images/-pdf-raster/-pptx`, `show-export-window`), `exportPresentation.js`
(`export-presentation`), `pdfExport.js`, `presentationWindow.js` (`open/close/toggle-presentation`),
`presentationBuilderWindow.js` (builder file ops), `createPresentation.js` (`create-presentation`,
metadata), `openedPresentation.js` (`opened-presentation:*`), `profileWindow.js`, `pluginDirector.js`
(`plugin-trigger`, `presentation-plugin-trigger`, manifests, export formats), `firstRunWizard.js` / `popplerInstaller.js` (`first-run:*`), `main.js` (
`reload-servers`, `relaunch-app`). **Plugins do not register IPC handlers directly** — they go through
`plugin-trigger` / `presentation-plugin-trigger` (`api{}` / `presentationApi{}`). Main → renderer pushes:
`show-toast`, `lan-ip-changed`, `mdns-peers-updated`, `peer-pairings-updated`, `opened-presentation:changed`,
`presentation-fade-to-black-request`, `export-progress`, `export-status`, `plugin-progress`.

When adding a channel: handler in `lib/`, method in the right preload, and consider whether the
renderer-supplied path/slug needs a containment check (use `lib/pathSafety.js`).

---

## 5. Windows and preload scripts

| Window | Created in | Preload (global) | Page |
|--------|------------|------------------|------|
| Main (library or Settings) | `mainWindow.js createMainWindow` | `preload.js` (`electronAPI`) | `/presentations.html`, `/admin/settings.html` |
| About · New/Edit metadata · Export · Builder | `aboutWindow` · `createPresentation` · `exportWindow` · `presentationBuilderWindow` | `preload.js` | `/admin/about.html`, `create.html`, `edit-metadata.html`, `export.html`, `builder.html` |
| Presentation, speaker notes, handout-launched decks | `presentationWindow.js`, `handoutWindow.js` | `preload_presentation.js` (`electronAPI` subset) | `/presentations_<key>/<slug>/index.html` or `/pip.html` |
| Additional screens | `presentationWindow.js` | none | peer-pushed URL or solid-colour `data:` URL |
| Handout | `handoutWindow.js` | `preload_handout.js` (link routing only) | `/presentations_<key>/<slug>/handout` |
| First-run | `firstRunWizard.js` | `preload_first_run.js` (`firstRunAPI`) | `http_admin/first-run-language.html` (`loadFile`) |
| Save-as-profile dialog | `profileWindow.js` | `preload_profile_dialog.js` (`profileDialogAPI`) | `http_admin/profile-dialog.html` (`loadFile`) |
| Splash | `splashWindow.js` | none | `assets/splash/splash.html` |
| Offscreen capture / PDF render | `exportWindow.js`, `pdfExport.js` | none | deck `index.html` / temp html |

Settings, peer pairing, the media library and the presentation list are **navigation inside the main
window**, not extra windows.

> **`electronAPI` exists on the top frame only.** The preload's `contextBridge` exposes it to the page the
> window loaded, not to iframes inside it. So in picture-in-picture (`pip.html` frames the deck) and in the
> builder preview (the admin window frames the deck) code running in the deck has no `window.electronAPI`.
> Same-origin iframes can reach it as `window.parent.electronAPI`; `plugins/widgets/client.js` (`findBridge`)
> does this, and `revelation/js/pip.js` relays the few messages the deck sends (`pip-toggle`,
> `pip-close-presentation`, `pip-send-to-peers`, `pip-close-on-peers`). Anything else that calls
> `window.electronAPI` directly from presentation code does not work in PiP (see KNOWN_ISSUES).

---

## 6. Renderer: `http_admin/`

Pages (all served at `/admin/` by the Vite server): `builder.html` (+ `builder.js`, `builder/*.js`),
`create.html` / `edit-metadata.html` (one script, `create.js`, driven by `presentation-schema.json` — a
custom field schema, *not* JSON Schema), `settings.html` (+ `settings.js`, `sidebar.js`), `export.html`,
`import-presentation.html`, `add-media.html`, `about.html`, `profile-dialog.html`,
`first-run-language.html`. `index.html` is empty. `sidebar.js` is also injected into `/presentations.html`
and `/media-library.html` by `revelation/js/sidebarloader.js` when `window.electronAPI` exists.

**Translations:** pages push `/admin/locales/translations.json` onto `window.translationsources`;
`/js/translate.js` drains it. `tr()` is global; the builder adds `trFormat(key, vars)`.

### The builder (`http_admin/builder/`, ES modules)

Entry `builder.js` → `builder/events.js` (`initBuilderEvents()`); `context.js` is the leaf everything
imports and owns the single mutable `state` (`frontmatter`, `stacks[h][v] = {top, body, notes}`, `selected`,
`dirty`, preview bookkeeping).

| Concern | Modules |
|---------|---------|
| Model ↔ markdown | `markdown.js` (split/join, `parseSlide`/`buildSlide`, front matter), `document.js` (`getFullMarkdown`), `presentation.js` (load/save/reparse) |
| Editing | `slides.js` (stack mutations, list, multi-select, column mode), `editor-actions.js`, `notes-editor.js` + `notes-markdown.js` + `color-spans.js`, `properties.js`, `smart-paste.js`, `variants.js`, `timings.js`, `tint.js`, `content.js`, `media.js`, `menus.js`, `layout.js`, `labels.js`, `readonly.js` |
| Preview | `preview.js`: writes `__builder_temp.md`, iframe URL, token-guarded postMessage bridge, peer push (see [BUILDER.md](BUILDER.md)) |
| History | `history.js`: snapshot undo/redo, owns Ctrl+Z/Y in the capture phase |
| Extensibility | `extensions-host.js`: `window.RevelationBuilderHost` (API version 2) |

Flow: **edit** → `state.stacks` → `markDirty()` → debounced `updatePreview` writes the full markdown to
the temp file over IPC → Vite HMR reloads the preview iframe → iframe events keep the selection in sync.
**Save** → `getFullMarkdown()` → IPC `savePresentationMarkdown`.

**Plugin extension points** (client-side, `window.RevelationPlugins[name]`): `getBuilderExtensions`
(modes/panels/overlays/toolbar/shortcuts/navigator renderers), `getBuilderTemplates`, `getContentCreators`
(legacy but still used by `bibletext`, `hymnary`, `adventisthymns`, `addmedia`), `getSlideTools`,
`onBuilderSmartPaste`. The host API and event list are documented in the header of
`http_admin/builder/extensions-host.js`; there is no separate plugin-author doc yet
(KNOWN_ISSUES §Documentation debt).

---

## 7. Data and file locations

| What | Where |
|------|-------|
| Config | `<userData>/config.json` (the "Default" profile); other profiles in `<userData>/profiles/*.config.json`. `<userData>` is `~/.config/revelation-electron` on Linux, `%APPDATA%\revelation-electron` on Windows, `~/Library/Application Support/revelation-electron` on macOS |
| Log | `<userData>/debug.log` (written only with `--enable-debug`) |
| Writable resource mirror | `<userData>/resources/{revelation,plugins}` (used when the install dir is read-only) |
| Presentations | `config.presentationsDir` (default `~/Documents/…`); each presentation is a folder: `presentation.md` (+ variants), `manifest.json`, `.thumbs/`, … |
| Shared media | `<presentationsDir>/_media/` — hashed files, JSON sidecars, `*.thumbnail.jpg`, `index.json` |
| Transient opened `.revel` | `<presentationsDir>/_current_open/` (deleted on dismiss / next startup) |
| Builder preview | `<presentation>/__builder_temp.md` (never exported or synced) |
| Sync state | `<userData>/sync-peers.json` (per machine; keyed by real path) and `<presentation>/.sync-conflicts/` for losing versions |
| Peer store | `peer-followers.json` (master side), `config.pairedMasters` (follower side) |
| Generated, gitignored | `plugins/plugins.json`, `revelation/reveal-remote.js`, `revelation/css/*.css` (from SCSS), `WordPress/build/`, `dist/` |

Config keys worth knowing: `mode` (`localhost` \| `network`), `viteServerPort`, `apiServerEnabled` /
`apiServerPort`, `plugins[]` (enabled), `pluginConfigs`, `presentationsDir`, `revelationDir`, `language`,
`ffmpegPath`, `httpsEnabled`, `mdnsPublish` / `mdnsBrowse`, `mdnsPairingPin`, `additionalScreens`,
`globalHotkeys`, `zoomFactor`, `key` (the access key — appears in every shared presentation URL).

---

## 8. Plugins (summary)

`lib/pluginDirector.js` `require`s `plugins/<name>/plugin.js` for each name in `config.plugins`
(first-run set: the hard-coded `defaultPlugins` array in `configManager.js`), orders by `priority`, and calls
`register(AppContext)`. A plugin can contribute: sidebar buttons, menu items, windows, `api{}` (IPC),
`presentationApi{}`, an `api-server.js` (HTTP routes), a `clientHookJS` (browser side), `offline.js`
(export hooks), export formats, peer-command handlers and a `configTemplate` rendered in Settings.
Full contract: [PLUGINS.md](PLUGINS.md).

> **Trust model: plugins are fully trusted.** A plugin runs in the main process with the same access as the app
> itself (config, keys, files, IPC, child processes), and its client code runs in windows that have the full
> preload API. There is no sandbox between a plugin and the rest of the software, which is why users are warned
> not to install untrusted plugins. Don't add filtering between windows or plugins to protect secrets from each
> other (e.g. trimming `get-app-config`); it would not be a real barrier. The only config filtering that matters is
> what leaves the machine: `pluginConfigView.js` keeps credentials out of the network-served `plugins.json`.

| Group | Plugins |
|-------|---------|
| Content sources | `addmedia`, `bibletext`, `bibletext-live`, `bibleworld`, `flickr`, `hymnary`, `adventisthymns`, `virtualbiblesnapshots`, `immich`, `mediashare`, `ontime`, `resources` |
| Slide syntax and rendering | `appearance`, `highlight`, `math`, `revealchart`, `lowerthirds`, `widgets` (+ `overlaywidgets` submodule), `credit_ccli`, `divideslides`, `infopanel`, `mediafx` |
| Builder extensions | `richbuilder`, `slidesorter`, `mdvalidate`, `compactor` |
| Collaboration (flag `collaboration: true`) | `captions`, `bibletext-live`, `markerboard`, `slidecontrol`, `videostream` |
| Publishing and export | `wordpress_publish`, `freeshow`, `popplerpdf` (bundled Poppler for PDF import) |
| Dev | `test` (example plugin; stripped from installers) |

`wordpress_publish` is the largest plugin (~1600 lines): RSA pairing, signed publish requests, and
two-way sync built on `lib/presentationManifest.js`, `presentationSyncPlan.js` and `presentationSyncPeers.js`
(deletions and per-file conflict choice are not implemented yet).

---

## 9. Cross-cutting subsystems

**Peering (master/follower).** A follower pairs with a master using a PIN and RSA keys; thereafter the
follower holds a Socket.IO connection to the master's `/peer-commands` and executes `open-presentation`,
`close-presentation`, `navigate-slide`, or plugin-registered commands. Discovery is Bonjour (`mdnsManager`).
Master-side HTTP endpoints and the socket server are in `revelation/server/peer-server.js`; the Electron main
process only sends commands (`requestVite`) and reads/forgets followers. Details and protocol v2:
[PEERING.md](PEERING.md).

**`.revel` files.** Export: `revelFormat.planRevelContents` → optional media copy →
`presentationManifest` → `writeRevelArchive`. Import/open: `extractRevelArchive` (skips unsafe/hidden/prohibited
names, sanitizes SVG, enforces limits) → origin mark → manifest verification → media import. Opening a file
extracts to `_current_open` read-only until the user imports it. See [REVEL_FORMAT.md](REVEL_FORMAT.md) (spec)
and [REVEL_IMPLEMENTATION.md](REVEL_IMPLEMENTATION.md).

**Two-way sync.** `presentationManifest` lists local files with sha1 → the plugin fetches the remote manifest
→ `computeSyncPlan({local, remote, base, accepted})` → push / pull / conflicts / dropped; conflict losers are
saved under `<folder>/.sync-conflicts/<stamp>/`; the `base` snapshot is stored per machine in `sync-peers.json`.

**Wayland window placement.** Wayland forbids apps from positioning windows, so
`gnome-extension/revelation-window-helper@pastordaniel.net/` (a GNOME Shell extension exposing D-Bus
`org.revelation.WindowHelper`, accepting only titles matching `revelation-place:<32 hex>`) and
`kwin-script/place-window.js` (a template filled and loaded over `org.kde.kwin.Scripting`) move windows.
`lib/gnomeWindowHelper.js` / `kwinWindowHelper.js` drive them; `presentationWindow.js` picks one. KDE
Plasma 5.27 is untested.

**Internationalization.** Two catalogs: `http_admin/locales/translations.json` (wrapper UI) and
`revelation/js/translations.json` (framework UI, Spanish only). Each plugin owns
`locales/translations.json`, including its manifest strings. UI text is looked up at runtime by English
string; docs are translated in `doc/i18n/es/` (partly stale — see KNOWN_ISSUES).

**Packaging.** `npm run build` builds the framework, fetches/copies assets, bundles offline plugins and
builds the WordPress zip; `npm run dist-*` wraps that with `scripts/package.js`
(`prepackage.js` prunes → electron-builder → `package-stash.js` restores). Pruned items go to
`.package-stash/`; if a build is killed, `node scripts/package-stash.js` restores the tree. See
[BUILDING.md](BUILDING.md).

---

## 10. "Where do I change…?"

| I want to… | Start here |
|------------|------------|
| Add a menu item | `lib/mainMenu.js` (template) + register a `menu:*` callback in a `lib/` module (`AppContext.callbacks`) |
| Add an IPC call | handler in `lib/`, method in `preload.js` (and `preload_presentation.js` if presentation windows need it) |
| Add an admin screen | `http_admin/<name>.html` + `.js`; a window opener modelled on `aboutWindow.js`; IPC as needed |
| Add a Settings field | `http_admin/settings.html` + `settings.js`; default in `lib/configManager.js`; plugin settings via `configTemplate` |
| Change the export formats | `lib/exportPresentation.js` (`.revel`, offline zip), `exportWindow.js` (images/PPTX/raster PDF), `pdfExport.js`, or a plugin's `exportFormats` |
| Change what's allowed in a `.revel` | `lib/revelFormat.js` (and [REVEL_FORMAT.md](REVEL_FORMAT.md)) |
| Add a plugin | copy `plugins/test/`; read [PLUGINS.md](PLUGINS.md); add to `defaultPlugins` only if it should be on at first run |
| Add a builder tool/panel | a plugin's `getBuilderExtensions`; or new module under `http_admin/builder/` wired in `events.js` |
| Change slide markdown syntax | `revelation/js/compiler/` (see [revelation/doc/ARCHITECTURE.md](../../revelation/doc/ARCHITECTURE.md)) |
| Add a server route | `revelation/vite.plugins.js` (note the trust tier — [SECURITY.md](../../revelation/doc/SECURITY.md)) |
| Add a control-API route | `lib/presentationControlRoutes.js`, or a plugin `api-server.js` |
| Change peer pairing/auth | `revelation/server/peer-protocol.js` (signature constructions, shared by both sides) and `revelation/server/peer-server.js` (master endpoints) |
| Translate a string | `http_admin/locales/translations.json` (app chrome) or the plugin's `locales/translations.json` |
| Change a theme | `revelation/css/source/*.scss` (16 themes repeat one block — REFACTOR §14) |
| Change installers | `package.json` `build` section; `scripts/package.js`, `prepackage.js` |

---

## 11. Code and comment style

The target style for new and refactored main-process code (`main.js` and `lib/` are the model):

- **Small modules.** One responsibility per file. When a file grows past a few hundred lines or mixes
  concerns (window creation, IPC, downloading, startup wiring), split it. `main.js` is wiring only.
- **Header comment at the top of every file:** purpose, exports, callers, IPC channels/routes, and gotchas.
  Enforced for `lib/*.js` by `tests/static.test.js`.
- **Comment each section.** A short one-line comment says *what the block is for or why it is there*,
  not what the syntax does. No paragraphs; put longer rationale in the header.
- **Blank line above a comment that covers several following lines.** A comment on a single statement
  sits directly above it. The first comment inside a `{` block needs no blank line.
- **Wrap at 100–120 characters** (code and comments). Break long strings with `+`, and break long
  conditions, arguments and template literals across lines.
- **Per-release data lives in its own file** with an `EDIT PER RELEASE` banner and release steps in its
  header (see `lib/popplerRelease.js`), never inside logic.
- **Reuse before you write** (see REFACTOR_CANDIDATES.md), and **add a test** when fixing a bug in `lib/`.

---

## 12. Working in two repos

`revelation/` is a separate git repository that must also run standalone. Commit and push changes there
first, then update the submodule pointer in the wrapper. `git status` showing `M revelation` means the
checked-out submodule commit differs from the one the wrapper records. Cross-repo contracts to keep in
step by hand: `CSS_VERSION_SNAPSHOTS` in
`lib/exportPresentation.js` ↔ `revelation/js/compiler/compiler-utils.js`; `deriveThumbnailName` in several
files; the theme-CSS exclusion list in `otherEventHandlers.js` and `themeThumbnailer.js`.
