# AGENTS.md — REVELation Snapshot Presenter

Developer and AI-agent onboarding reference for the **revelation-electron-wrapper** repository.
Last full audit: 2026-10-05.

**Start here, then go deeper:**
[doc/dev/ARCHITECTURE.md](doc/dev/ARCHITECTURE.md) (how it fits together, "where do I change…?") ·
[doc/dev/KNOWN_ISSUES.md](doc/dev/KNOWN_ISSUES.md) (open bugs) ·
[doc/dev/REFACTOR_CANDIDATES.md](doc/dev/REFACTOR_CANDIDATES.md) (duplicated code to consolidate) ·
[TODO.md](TODO.md) (deferred work, security findings)

---

## What This Project Is

**REVELation Snapshot Presenter** is a cross-platform Electron desktop application that wraps the REVELation framework to provide a user-friendly desktop experience for creating, managing, and presenting Reveal.js-based markdown presentations.

Target users: speakers, teachers, and content creators who want media-rich slide presentations without needing web-development skills.

---

## Repository Layout

```
revelation-electron-wrapper/
├── main.js                      # Electron main process entry: startup/shutdown wiring (~330 lines)
├── preload.js                   # IPC bridge for admin/main windows (`electronAPI`, ~130 methods)
├── preload_presentation.js      # IPC bridge for presentation windows (`electronAPI` subset)
├── preload_handout.js           # Handout windows (link routing only)
├── preload_first_run.js         # First-run language + setup screen (`firstRunAPI`)
├── preload_profile_dialog.js    # Save-as-profile dialog (`profileDialogAPI`)
├── package.json                 # Dependencies, electron-builder config, npm scripts
├── lib/                         # Main-process modules (59 files) — see doc/dev/ARCHITECTURE.md §4
├── http_admin/                  # Admin pages served at /admin/ (builder, settings, create, export, import…)
├── plugins/                     # Bundled plugins (34) + generated plugins.json
├── revelation/                  # Git submodule: REVELation framework (Vite server, compiler, Reveal.js, themes)
├── WordPress/                   # WordPress plugin source (PHP); build output is gitignored
├── scripts/                     # Install, build, packaging, asset-fetch scripts
├── gnome-extension/, kwin-script/  # Wayland window-placement helpers
├── doc/                         # Documentation (English + Spanish in doc/i18n/es)
├── assets/, build-resources/    # Icons, splash, default backgrounds; electron-builder resources
├── bin/                         # Bundled binaries (effectgenerator; ffmpeg on mac/win) — downloaded, gitignored
└── dist/                        # Installer output (gitignored)
```

> **Submodule:** `revelation/` is a separate git repository that must also run standalone. Always clone with `--recursive`. `git status` showing `M revelation` means the checked-out submodule commit differs from the one this repo records.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Electron 44.x (needs Node 22.12+ to build) |
| Presentation engine | Reveal.js 6.x (inside submodule) |
| Framework build / dev server | Vite (inside submodule) |
| Markdown / front matter | Marked + js-yaml (compiler in `revelation/js/compiler/`) |
| Real-time sync | Socket.IO (three servers on three paths) |
| HTTP serving | Vite middleware (`revelation/vite.plugins.js`); Node `http` for the control API |
| Media processing | fluent-ffmpeg; ffmpeg located by `lib/ffmpegResolver.js` (bundled on mac/win, system elsewhere) |
| Document handling | cheerio (SVG sanitizing), archiver + unzipper (+ jszip in `exportWindow.js`), pptxgenjs, csv-parse, xml2js, ical.js |
| Peer discovery | bonjour-service (mDNS) |
| Installer packaging | electron-builder 26.x |
| CSS | Sass (in submodule; 17 slideshow themes) |

---

## Key Entry Points

Full per-file map: [doc/dev/ARCHITECTURE.md](doc/dev/ARCHITECTURE.md) §4. The ones you will touch most:

| File | Role |
|------|------|
| `main.js` | Startup/shutdown wiring: builds `AppContext`, registers 18 `lib/` modules' IPC handlers |
| `lib/appContext.js`, `lib/mainWindow.js`, `lib/firstRunWizard.js` | `AppContext` + zoom helpers; main window, app menu, always-open screens; first-run setup window and its IPC |
| `lib/popplerRelease.js` | **Per-release data:** Poppler plugin download URLs + SHA-256 hashes (installer logic: `lib/popplerInstaller.js`) |
| `lib/configManager.js` | Config + profiles under `app.getPath('userData')`; migrations; key and RSA keypair generation; `defaultPlugins` |
| `lib/serverManager.js` | Starts/stops the Vite `utilityProcess`; ports, LAN-IP watcher, media tokens; writes `revelation/reveal-remote.js` |
| `lib/pluginDirector.js` | Plugin discovery/registration, ZIP install, `plugins.json`, `plugin-trigger` IPC |
| `lib/presentationWindow.js` | Fullscreen presentation viewer, notes window, additional screens, URL-publish file, Wayland placement |
| `lib/presentationBuilderWindow.js` | The builder window and its markdown/variant file IPC (the editor UI is `http_admin/builder/`) |
| `lib/exportPresentation.js` | `.revel` export and standalone offline `.zip` (PDF: `pdfExport.js`; handout: `handoutWindow.js`; images/PPTX/raster PDF: `exportWindow.js`; WordPress: the plugin) |
| `lib/importPresentation.js` | Import `.revel`/`.zip`/URL; media recovery |
| `lib/revelFormat.js` | `.revel` content rules (prohibited types, SVG sanitizing, limits); archive read/write. See [REVEL_FORMAT.md](doc/dev/REVEL_FORMAT.md) |
| `lib/openedPresentation.js`, `lib/originMark.js` | Read-only open into `_current_open`; Mark-of-the-Web propagation. See [REVEL_IMPLEMENTATION.md](doc/dev/REVEL_IMPLEMENTATION.md) |
| `lib/mediaLibrary.js` | The shared `_media` library, thumbnails, large variants, transcode queue |
| `lib/peerCommandClient.js`, `peerPairing.js`, `peerAuth.js`, `mdnsManager.js` | Follower side of master/follower sync, pairing, RSA protocol v2, Bonjour. The master's socket server is `revelation/server/peer-server.js` |
| `lib/apiServer.js` | The control API (second HTTP server, port 8900) |
| `lib/otherEventHandlers.js` | ~45 miscellaneous IPC handlers (config, peers, displays, clipboard, macros…) |
| `http_admin/builder.js`, `http_admin/builder/*` | The slide builder (ES modules; `context.js` holds the state) |

---

## Plugin Architecture

- Each plugin lives in `plugins/<name>/` with a `plugin-manifest.json`, a main-process `plugin.js`, and usually a browser-side `client.js`.
- The loader is `lib/pluginDirector.js`: it `require`s `plugin.js` for each name in `config.plugins`, sets `plugin.version` from the manifest, orders by `priority`, and calls `register(AppContext)`.
- **First-run enabled set** is the hard-coded `defaultPlugins` array in `lib/configManager.js`: `addmedia`, `bibletext`, `hymnary`, `virtualbiblesnapshots`, `resources`, `mediafx`, `compactor`, `richbuilder`, `slidesorter`, `mdvalidate`, `divideslides`. The `defaultEnabled` field that appears in some `plugin.js` files is **not read by anything**.
- Plugins can be ZIP-installed at runtime; the manifest's `min_revelation_version` must not exceed the running app version.
- Plugins reach the main process through `plugin-trigger` / `presentation-plugin-trigger` IPC (`api{}` / `presentationApi{}`), never by registering `ipcMain` handlers themselves.
- **A plugin's `config` is written to `plugins.json` and served to browsers** (for `exposeToBrowser` plugins). Mark every credential in `configTemplate` with `secret: true` (or list it in `privateConfigKeys`) so `lib/pluginConfigView.js` keeps it out; a test fails on an unmarked credential-looking field. The main process still sees the full config.
- Contract and authoring guide: **[doc/dev/PLUGINS.md](doc/dev/PLUGINS.md)**. Every plugin's `plugin.js` / `client.js` now opens with a header comment listing its hooks, IPC channels, config keys and external services; read that before the code.

---

## Server Architecture

Two HTTP servers run inside the app, plus Socket.IO servers hosted by the first:

1. **Vite server** (`viteServerPort`, default **8000**) — a `utilityProcess` started by `serverManager.js`. Serves admin pages, presentations, plugin files, thumbnails, `index.json`, `/peer/*`. Bound to `localhost` or the LAN per `mode` (`localhost` | `network`). Three Socket.IO servers share it, each on its own `path`: `/socket.io` (Reveal Remote broker, network mode only), `/peer-commands` (RSA-authenticated master→follower), `/presenter-plugins-socket` (collaboration plugins). Each is started by its own function in `vite.plugins.js` / `peer-server.js`; keep the paths distinct.
2. **Control API** (`apiServerPort`, default **8900**) — `lib/apiServer.js`, in the main process, `127.0.0.1` only, **enabled by default**. See [doc/API_REFERENCE.md](doc/API_REFERENCE.md).

There is **no separate Reveal Remote server process** — the broker is embedded in the Vite server. Don't re-introduce one.

The same Vite code can run standalone as a **public socket relay** with `REVELATION_PUBLIC_SERVER=1` (`npm run relay` in `revelation/`): only `/socket.io` and `/presenter-plugins-socket` plus the static remote UI — no presentations, plugins, thumbnails, admin or peer endpoints. See [doc/dev/PUBLIC_RELAY.md](doc/dev/PUBLIC_RELAY.md). Never expose the normal mode to the internet, proxied or otherwise.

---

## User Configuration

Config: `<userData>/config.json` (the "Default" profile); other profiles in `<userData>/profiles/*.config.json`.
Log: `<userData>/debug.log` (only written with `--enable-debug`).
`<userData>` is `~/.config/revelation-electron` on Linux, `%APPDATA%\revelation-electron` on Windows, `~/Library/Application Support/revelation-electron` on macOS.

Notable config keys:

| Key | Purpose |
|-----|---------|
| `mode` | `localhost` or `network` server binding |
| `viteServerPort` | Vite server port (default 8000) |
| `apiServerEnabled`, `apiServerPort` | Control API (default on, 8900) |
| `plugins[]` | Enabled plugin names |
| `pluginConfigs` | Per-plugin config objects |
| `presentationsDir` | Where presentations are stored |
| `revelationDir` | Path to the framework (the bundled copy, or the writable mirror in `<userData>/resources`) |
| `language` | UI locale (`en`, `es`, …) |
| `ffmpegPath` | Optional user override for the ffmpeg binary. The auto-detected path is kept in `AppContext.ffmpegPath` (runtime only); read it with `getActiveFfmpegPath()` |
| `httpsEnabled`, `mdnsPublish`, `mdnsBrowse` | HTTPS (experimental); peer discovery publish/browse |
| `key` | Access key — appears in every shared presentation URL; treat as a capability |

---

## Documentation Index

Docs live under `doc/` (wrapper) and `revelation/doc/` (framework). Spanish translations in `doc/i18n/es/` (partly stale).

### Wrapper (`doc/`)
| File | Contents |
|------|---------|
| [doc/dev/ARCHITECTURE.md](doc/dev/ARCHITECTURE.md) | **Wrapper architecture map**: processes, servers, `lib/` modules, windows/preloads, IPC, builder, data locations, "where do I change…?" |
| [doc/dev/KNOWN_ISSUES.md](doc/dev/KNOWN_ISSUES.md) | Outstanding bugs and risks (2026-10-05 audit), with severity and suggested fixes |
| [doc/dev/REFACTOR_CANDIDATES.md](doc/dev/REFACTOR_CANDIDATES.md) | Duplicated implementations to consolidate, grouped by theme |
| [doc/dev/INSTALLING.md](doc/dev/INSTALLING.md) | Developer setup from source |
| [doc/dev/BUILDING.md](doc/dev/BUILDING.md) | Build pipeline and packaging installers |
| [doc/dev/PLUGINS.md](doc/dev/PLUGINS.md) | Plugin loader contract, manifest, hooks, builder extension host |
| [doc/dev/BUILDER.md](doc/dev/BUILDER.md) | Builder live preview and peer syncing |
| [doc/dev/PEERING.md](doc/dev/PEERING.md) | Master/follower network protocol (v2) |
| [doc/dev/PUBLIC_RELAY.md](doc/dev/PUBLIC_RELAY.md) | Running the socket relay |
| [doc/dev/REVEL_FORMAT.md](doc/dev/REVEL_FORMAT.md) | `.revel` file format specification (vendor-neutral) |
| [doc/dev/REVEL_IMPLEMENTATION.md](doc/dev/REVEL_IMPLEMENTATION.md) | How this app exports, imports, opens, registers and secures `.revel` files |
| [doc/dev/README-PDF.md](doc/dev/README-PDF.md) | PDF import via the Poppler plugin |
| [doc/API_REFERENCE.md](doc/API_REFERENCE.md) | Control API (port 8900) |
| [doc/GUI_REFERENCE.md](doc/GUI_REFERENCE.md) | User workflows and app features |
| [doc/BUILDER_REFERENCE.md](doc/BUILDER_REFERENCE.md) | Builder user reference and shortcuts |
| [doc/SETTINGS.md](doc/SETTINGS.md) | Settings screen reference (**out of date** vs the real tabs — KNOWN_ISSUES) |
| [doc/TROUBLESHOOTING.md](doc/TROUBLESHOOTING.md) | Runtime issues (Wayland/X11, etc.) |
| [doc/MACOS_INSTALL.md](doc/MACOS_INSTALL.md) | macOS install notes (ad-hoc signed) |
| Root: `README.md`, `QUICKSTART.md`, `CHANGELOG.md`, `ROADMAP.md`, `TODO.md` | Users; quick start; history; planned features; deferred work + security findings |

### Framework submodule (`revelation/doc/`)
| File | Contents |
|------|---------|
| [revelation/doc/REFERENCE.md](revelation/doc/REFERENCE.md) | Top-level index for framework docs |
| [revelation/doc/ARCHITECTURE.md](revelation/doc/ARCHITECTURE.md) | Request flow, compiler pipeline, plugin loader, Vite middleware, socket servers, env vars, offline bundle, themes, tests |
| [revelation/doc/AUTHORING_REFERENCE.md](revelation/doc/AUTHORING_REFERENCE.md) | Extended Markdown syntax, macros, media aliases |
| [revelation/doc/METADATA_REFERENCE.md](revelation/doc/METADATA_REFERENCE.md) | YAML frontmatter schema |
| [revelation/doc/SECURITY.md](revelation/doc/SECURITY.md) | Security model: trust tiers, secrets, endpoint map, collaboration carve-out |

---

## Development Quick Start

```bash
git clone --recursive https://github.com/fiforms/revelation-electron-wrapper.git
cd revelation-electron-wrapper
npm install        # preinstall builds the submodule; postinstall fetches blobs (SKIP_BLOBS=1 to skip)
npm start          # Electron
npm run dev        # Electron + Sass theme watcher
```

Tests: `npm run tests` runs the wrapper suite (static checks, `lib/` units, local API over loopback; no GUI, see [tests/README.md](tests/README.md)). `cd revelation && npm run tests` runs the submodule's compiler/sanitizer fixtures (32 pass); `npm run tests:all` runs both.

## Build & Distribution

```bash
npm run build          # framework + fetch assets + offline plugins + WordPress zip
npm run dist-linux     # Linux DEB + RPM
npm run dist-win       # Windows NSIS
npm run dist-mac       # macOS DMG (Apple Silicon)
npm run dist-mac-intel # macOS DMG (Intel)
```

Output goes to `dist/`. `npm run dist-*` runs `scripts/package.js`: `prepackage.js` prunes (stashing to `.package-stash/` rather than deleting) → electron-builder → `package-stash.js` restores. If a build is killed hard, run `node scripts/package-stash.js` (the next build also does this automatically). Details: [doc/dev/BUILDING.md](doc/dev/BUILDING.md).

## WordPress Integration

`WordPress/revelation-presentations/` is a WordPress plugin for publishing and two-way syncing presentations, using RSA-signed requests after an admin-approved pairing. The desktop side is `plugins/wordpress_publish/`. Build the ZIP with `node scripts/wp-package-plugin.js` (needs `npm run build` first). Runtime assets are copied in from the framework by `scripts/wp-sync-runtime-assets.js`. The version lives in the plugin header (`Version:`); `RP_PLUGIN_VERSION` is derived from it at runtime, so bump it there and in `readme.txt` (`Stable tag:`).

---

## Internationalization

There are two `translations.json` files — one for each part of the project:

| File | Scope |
|------|-------|
| `http_admin/locales/translations.json` | Electron wrapper admin UI (builder, export, settings screens) |
| `revelation/js/translations.json` | Core framework UI (presentation viewer, remote control); Spanish only |

Both must be kept in sync when adding or modifying locale strings. Lookups are by the English string; English is the identity.

Plugins with their own UI strings carry `locales/translations.json` alongside their other files (`bibletext`, `bibletext-live`, `captions`, `compactor`, `markerboard`, `mediafx` (plus `effectgenerator.translations.json`), `resources`, `slidecontrol`, `videostream`, `virtualbiblesnapshots`, `wordpress_publish`). A plugin registers its file by pushing its path onto `window.translationsources`, then calling `window.loadTranslations()`.

The same file also translates the plugin's **manifest** strings (`title`, `description`, `collaboration_detail`) shown on Settings. Those are read by the main process in `pluginDirector.js` (`loadPluginLocale`), keyed by the English text in the manifest, and need no registration. Keep plugin-authored text in the plugin's own locales file — `http_admin/locales/translations.json` is for app UI chrome only.

Spanish documentation lives in `doc/i18n/es/` and has fallen behind (and has two parallel trees); see KNOWN_ISSUES → Documentation debt. Several admin screens (`create.js`, import, add-media) have no translation hooks at all.

---

## Notes for AI Agents

**Orientation and workflow**

- **Read before editing.** Every `lib/*.js`, `http_admin/builder/*.js`, plugin entry file and the main `revelation/` modules now begin with a header comment (purpose, callers, IPC/routes, gotchas). `doc/dev/ARCHITECTURE.md` §10 is a "where do I change…?" table.
- **Follow the code and comment style** in [doc/dev/ARCHITECTURE.md](doc/dev/ARCHITECTURE.md) §11 (small modules, header comment per file, one-line section comments, blank line above multi-line comments, wrap at 100–120).
- **Check `KNOWN_ISSUES.md` and `REFACTOR_CANDIDATES.md` before adding code.** Much of this codebase has several copies of the same helper (front-matter parsing, HTML escaping, slugify, path checks, HTTP download, URL building). Prefer reusing the best existing one over writing another; don't add a new copy.
- **This project spans two repositories.** The wrapper and the `revelation/` submodule are developed together but live in separate git histories. Commit and push changes in `revelation/` first, then update the submodule pointer here.
- **Never launch Electron or other GUI apps** from an agent session; the owner tests the UI. Don't create git commits unless asked — the owner handles commits and pushes.
- Wrapper tests live in `tests/` (`npm run tests`); the submodule has its own fixture suite (`cd revelation && npm run tests`). Run the wrapper suite after any change, and add a test for new `lib/` logic. Code that needs a real window or Electron runtime is not covered; the owner tests that by hand.

**Security-sensitive areas**

- **IPC is security-sensitive.** Renderer↔main communication goes through the preload scripts; never expose Node APIs to renderer contexts. Renderer-supplied slugs, filenames and paths must be confined to the presentations directory (use `lib/pathSafety.js`) — don't hand-roll another check.
- **Markdown is untrusted input** (imported `.revel` files, shared decks). The sanitizer is `revelation/js/compiler/html-sanitization.js` (string pass + live-DOM pass) with a CSP on `presentation.html`; escape anything you interpolate into `innerHTML`, including attributes (the DOM-based `escapeHTML` copies do **not** encode quotes).
- **Plugin ZIP installation** validates `plugin-manifest.json` before extracting; preserve this when modifying `pluginDirector.js`.
- **Peer pairing** uses RSA keypairs stored in config. The signature constructions live once, in `revelation/server/peer-protocol.js` (`lib/peerAuth.js` re-exports it, so master and follower cannot drift); change them there and bump `PEER_PROTOCOL_VERSION`; read [doc/dev/PEERING.md](doc/dev/PEERING.md) first. The WordPress keypair is separate from the peer keypair on purpose.
- **Never expose the normal server to the internet**; only the public-relay mode is meant for that.

**Architecture rules**

- **Server model:** one Vite process (port 8000) hosting three Socket.IO servers on distinct paths, plus the control API on 8900. Don't add a separate remote-broker process and keep the socket paths distinct.
- **`reveal-remote.js` is generated at runtime** by `lib/serverManager.js` (`writeRevealRemoteJSFile`) and is gitignored. `revelation/reveal-remote.js.default` and `revelation/scripts/copy-remote.js` are legacy — don't rely on them. In localhost mode it sets `window.revealRemoteServer = null` (remote disabled); in network mode it points at the Vite server port; it also carries `presenterPluginsPublicServer` and `presenterLiveRoomId`.
- **ffmpeg:** resolve it through `lib/ffmpegResolver.js` (`getActiveFfmpegPath`); never assume a system install. Media probing uses `ffmpeg -i` stderr parsing — ffprobe is not used or bundled.
- **Plugins** never register `ipcMain` handlers; they use `api{}` / `presentationApi{}`. Plugin first-run enablement is `defaultPlugins` in `configManager.js`, not `defaultEnabled`.
- **Presentations and `_media`:** `_media` is shared across presentations; `__builder_temp.md`, dot-paths, and `.sync-conflicts/` are local-only and must never be exported or synced. `_current_open` is the transient read-only slot for opened `.revel` files — use `openedPresentation.assertWritableSlug` before writing to a slug.
- **Localization is runtime-dynamic:** UI strings come from `translations.json` at runtime (main process loads it for the menu and first-run; admin pages fetch it over HTTP), not baked into HTML.
- **Version numbers** live in several places that drift: `package.json`, `revelation/package.json`, the WordPress plugin header and `RP_PLUGIN_VERSION`, `readme.txt`, `CHANGELOG.md`, and the Poppler download URLs/hashes in `lib/popplerRelease.js`. Check all when releasing.
