# AGENTS.md — REVELation Snapshot Presenter

Developer and AI-agent onboarding reference for the **revelation-electron-wrapper** repository.

---

## What This Project Is

**REVELation Snapshot Presenter** is a cross-platform Electron desktop application that wraps the REVELation framework to provide a user-friendly desktop experience for creating, managing, and presenting Reveal.js-based markdown presentations.

Target users: speakers, teachers, and content creators who want media-rich slide presentations without needing web-development skills.

---

## Repository Layout

```
revelation-electron-wrapper/
├── main.js                      # Electron main process entry point (~840 lines)
├── preload.js                   # IPC bridge for main window
├── preload_presentation.js      # IPC bridge for presentation windows
├── preload_handout.js           # IPC bridge for handout windows
├── preload_first_run.js         # IPC bridge for first-run language selection
├── package.json                 # Dependencies, build config, npm scripts
├── lib/                         # Core Electron wrapper modules (27 files)
├── http_admin/                  # HTML/CSS/JS for in-app admin screens
├── plugins/                     # Plugin system — 20+ bundled plugins
├── revelation/                  # Git submodule: REVELation core framework
├── WordPress/                   # WordPress plugin source and build artifacts
├── scripts/                     # Build and packaging scripts
├── doc/                         # Documentation (English + Spanish i18n)
├── assets/                      # App icons, default backgrounds
├── bin/                         # binaries like effectgenerator included in package
└── dist/                        # Output directory for built installers
```

> **Submodule:** `revelation/` is a separate git repository. Always clone with `--recursive` and keep it updated with `git submodule update --remote`.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Electron 40.x |
| Presentation engine | Reveal.js 5.2.1 (inside submodule) |
| Framework build | Vite (inside submodule) |
| Markdown parsing | Marked + gray-matter (YAML frontmatter) |
| Real-time sync | Socket.io |
| HTTP serving | Express + CORS |
| Media processing | fluent-ffmpeg, ffmpeg-static, ffprobe-static |
| Peer discovery | bonjour-service (mDNS) |
| Installer packaging | electron-builder 26.x |
| CSS compilation | Sass |
| Scripting extras | js-yaml, archiver, unzipper, csv-parse, xml2js, jsdom |

---

## Key Entry Points

| File | Role |
|------|------|
| `main.js` | Electron main process — initialises `AppContext`, windows, IPC handlers, plugin system, mDNS peers |
| `lib/configManager.js` | Reads/writes `~/.config/revelation-electron/config.json` |
| `lib/serverManager.js` | Spawns and monitors the Vite dev server (port 8000) and Reveal.js-Remote server (port 1947) |
| `lib/pluginDirector.js` | Plugin discovery, version validation, ZIP installation |
| `lib/presentationWindow.js` | Opens and manages the main presentation editor/viewer |
| `lib/exportPresentation.js` | Drives export to handout, PDF, offline ZIP, WordPress |
| `lib/peerCommandClient.js` | Master/follower slide sync over Socket.io |
| `lib/mdnsManager.js` | mDNS service discovery and peer pairing |

---

## Plugin Architecture

- Each plugin lives in `plugins/<name>/` and ships a `plugin-manifest.json`.
- Plugins can be ZIP-installed at runtime; manifest version is validated before install.
- Core plugins loaded by default (see `configManager.js` defaults): `addmedia`, `bibletext`, `hymnary`, `virtualbiblesnapshots`, `resources`, `mediafx`, `compactor`, `richbuilder`, `slidesorter`.
- See **[doc/PLUGINS.md](doc/PLUGINS.md)** for hook API and authoring guide.

---

## Server Architecture

Two HTTP servers run concurrently inside the app:

1. **Vite dev server** (default port **8000**) — serves admin HTML screens and presentation preview.
2. **Reveal.js-Remote server** (default port **1947**) — real-time presenter/audience slide sync via Socket.io.

---

## User Configuration

Config file: `~/.config/revelation-electron/config.json`
Log file: `~/.config/revelation-electron/debug.log`

Notable config keys:

| Key | Purpose |
|-----|---------|
| `mode` | `localhost` or `LAN` server binding |
| `viteServerPort` | Vite dev server port (default 8000) |
| `revealRemoteServerPort` | Remote server port (default 1947) |
| `plugins[]` | Enabled plugin names |
| `pluginConfigs` | Per-plugin config objects |
| `presentationsDir` | Where presentations are stored |
| `revelationDir` | Path to revelation submodule (usually auto-detected) |
| `language` | UI locale (`en`, `es`, …) |
| `ffmpegPath` / `ffprobePath` | Override bundled FFmpeg binaries |

---

## Documentation Index

All documentation lives under `doc/` (wrapper) and `revelation/doc/` (framework). Start here:

### Wrapper (`doc/`)
| File | Contents |
|------|---------|
| [doc/INSTALLING.md](doc/INSTALLING.md) | Developer setup from source |
| [doc/BUILDING.md](doc/BUILDING.md) | Packaging installers for each platform |
| [doc/GUI_REFERENCE.md](doc/GUI_REFERENCE.md) | User workflows and app features |
| [doc/SETTINGS.md](doc/SETTINGS.md) | Settings screen field reference |
| [doc/PLUGINS.md](doc/PLUGINS.md) | Plugin hook API and development guide |
| [doc/PEERING.md](doc/PEERING.md) | Master/follower network protocol |
| [doc/TROUBLESHOOTING.md](doc/TROUBLESHOOTING.md) | Runtime issues (Wayland/X11, etc.) |
| [doc/README-PDF.md](doc/README-PDF.md) | PDF import via Poppler plugin |

### Framework submodule (`revelation/doc/`)
| File | Contents |
|------|---------|
| [revelation/doc/REFERENCE.md](revelation/doc/REFERENCE.md) | Top-level index for framework docs |
| [revelation/doc/AUTHORING_REFERENCE.md](revelation/doc/AUTHORING_REFERENCE.md) | Extended Markdown syntax, macros, media aliases |
| [revelation/doc/METADATA_REFERENCE.md](revelation/doc/METADATA_REFERENCE.md) | YAML frontmatter schema |
| [revelation/doc/ARCHITECTURE.md](revelation/doc/ARCHITECTURE.md) | Framework internals and plugin hooks |

---

## Development Quick Start

```bash
# Clone with submodule
git clone --recursive https://github.com/fiforms/revelation-electron-wrapper.git
cd revelation-electron-wrapper

# Install dependencies (runs pre/postinstall scripts automatically)
npm install

# Run in development (Electron + Vite hot reload)
npm start
# or with watch mode:
npm run dev
```

---

## Build & Distribution

```bash
npm run build          # Build revelation framework + plugins + offline packages
npm run dist-linux     # Build Linux DEB + RPM installers
npm run dist-win       # Build Windows NSIS installer
npm run dist-mac       # Build macOS DMG (Apple Silicon)
npm run dist-mac-intel # Build macOS DMG (Intel)
```

Build output goes to `dist/`.

**Pre-package script** (`scripts/prepackage.js`) removes temp presentations, prunes dev `node_modules`, and copies the WordPress plugin ZIP before electron-builder runs.

---

## WordPress Integration

The `WordPress/` directory contains a WordPress plugin that lets users publish and embed presentations on WordPress sites via RSA-authenticated pairing.

Build the plugin ZIP with:
```bash
node scripts/wp-package-plugin.js
```

---

## Internationalization

There are two `translations.json` files — one for each part of the project:

| File | Scope |
|------|-------|
| `http_admin/locales/translations.json` | Electron wrapper admin UI (builder, export, settings screens) |
| `revelation/js/translations.json` | Core framework UI (presentation viewer, remote control) |

Both files must be kept in sync when adding or modifying locale strings.

Plugins that have their own UI strings each carry a `locales/translations.json` alongside their other files (e.g. `plugins/bibletext/locales/translations.json`). At runtime a plugin registers its file by pushing its path onto `window.translationsources`, then calls `window.loadTranslations()`. The following plugins currently ship their own string files:

- `plugins/bibletext/locales/translations.json`
- `plugins/compactor/locales/translations.json`
- `plugins/mediafx/locales/translations.json` (plus a separate `effectgenerator.translations.json`)
- `plugins/resources/locales/translations.json`
- `plugins/virtualbiblesnapshots/locales/translations.json`
- `plugins/wordpress_publish/locales/translations.json`

When adding a new plugin that needs translated strings, follow the same pattern: create `locales/translations.json` inside the plugin directory and register it via `window.translationsources` in the plugin's client JS.

Full Spanish (`es`) documentation translations also exist in `doc/i18n/es/`. Add new locales by extending all relevant JSON files and adding translated doc files.

---

## Notes for AI Agents

- **This project spans two repositories.** The outer Electron wrapper and the `revelation/` submodule are developed together but live in separate git histories. Changes to `revelation/` must be committed and pushed there separately, then the submodule pointer updated in the wrapper repo.
- **IPC is security-sensitive.** All renderer↔main communication goes through the preload scripts. Do not expose Node APIs directly to renderer contexts.
- **Plugin ZIP installation** validates `plugin-manifest.json` version before extracting. When modifying `pluginDirector.js`, preserve this validation.
- **FFmpeg paths** can be overridden in config; always fall back to bundled binaries (`ffmpeg-static`, `ffprobe-static`), never assume a system-installed FFmpeg.
- **The two-server model** (Vite + Reveal.js-Remote) means there can be port conflicts. Check `serverManager.js` when debugging connectivity issues.
- **Peer pairing** uses RSA keypairs stored in config; see `lib/peerPairing.js` and `doc/PEERING.md` before touching auth logic.
- **Localization** is runtime-dynamic; UI strings are fetched from `translations.json` via IPC, not baked into HTML.
