# CHANGELOG

# REVELation Snapshots Presenter 0.2.4beta

### 🧱 Presentation Builder & Markdown Tools

* **New Presentation Builder (beta)**: Introduced a builder-oriented workflow with presentation properties, slide markdown tools, and builder-first defaults.
* **Markdown editing upgrades**: Added a formatting toolbar, column editing (combine/break), and a dedicated markdown column edit mode.
* **Quality-of-life fixes**: Intercepted link opens inside the builder, improved handling of speaker notes screens, and resolved layout glitches with collapsed panels.
* **Defaults for modern screens**: Tuned widescreen-friendly defaults and adjusted slide-number visibility for speaker view.

### 🖼️ Media Creation & Library Workflows

* **Bulk media add**: Added a bulk image importer plus direct wiring to the VRBM plugin for fast image ingest.
* **Media picker evolution**: Enabled selecting existing media and inserting it into slides; added tag-name customization and “None” insert type.
* **Presentation management**: Added presentation deletion and an “Open Folder” button for quick file access.

### 📄 PDF Import/Export Enhancements

* **In-app PDF export**: Export to PDF now works directly in the app.
* **PDF import feature**: Added PDF import with improved conversion flow (now outputting `.jpg`), plus better UI handling.
* **Docs update**: Added README guidance for installing `poppler` to support PDF operations.

### 🎬 MediaFX & Rendering Pipeline

* **MediaFX plugin shipped**: Added MediaFX as a default plugin with rendering UI, progress, logging, and concurrency controls.
* **FFmpeg/ffprobe improvements**: Better detection, configurable paths, new filters, and a bundled fetcher for the `effectgenerator` binary.

### 🌐 Remote Pairing, mDNS & Security

* **New peer system**: Built peer pairing infrastructure with improved UI, manual pairing by IP, and unpair support.
* **Security upgrades**: Added PIN requirements, RSA challenge validation, and localhost-only page access hardening.
* **mDNS resilience**: Cached peer discovery and enabled browsing even when publishing is disabled.

### 🎨 Themes, Thumbnails & UI Polish

* **Theme thumbnail picker**: Added a rich picker, automated thumbnail generation, and updated build steps for theme thumbnails.
* **UI polish**: Cleaned up menu items, improved settings reset behavior, and made builder UX tweaks throughout.

### 🧰 Platform, Build & Packaging

* **Dependency updates**: Upgraded Electron/Vite and refreshed internal `revelation` submodule snapshots.

# REVELation Snapshots Presenter 0.2.0

### 🔌 Plugin System Enhancements

* **Plugin Installation**: Added "Install Plugin from ZIP" menu option for easy plugin management
* **Plugin Settings UI**: Removed empty configuration boxes for plugins without settings
* **Plugin Versions**: Updated all core plugins to version 0.2.0

### 📖 Bible Text Plugin Major Update (v0.2.0a)

* **Offline Bible Support**: Added support for local Bible translations in XMLBIBLE format (.xml and .xml.gz)
* **Automatic Bible Download**: New post-install script automatically fetches default Bible translations from remote server
* **Bible Format Compatibility**: Enhanced XML parser to support multiple XMLBIBLE formats including Hebrew text with Strong's numbers
* **Configurable Options**: 
  - Added option to disable online Bible API
  - Added default translation selection (defaults to KJV.local)
  - Improved translation list with language indicators
* **Memory Optimization**: Bible data now loaded on-demand rather than kept in memory
* **Translation Management**: Bibles automatically converted from XML to JSON for faster loading

### 🎵 Hymnary Plugin (v0.1.1)

* **New Feature**: Search and import public domain hymn lyrics from Hymnary.org
* **Smart Formatting**: Automatic verse and refrain detection with proper slide breaks
* **Language Support**: Search hymns in multiple languages
* **Copy & Insert**: Copy lyrics to clipboard or insert directly into presentations
* **Attribution**: Automatic title, author, and source attribution

### 📦 Media Library Improvements

* **Batch Import**: Added ability to load multiple media files simultaneously
* **Metadata Enhancement**: Expanded metadata fields to match full library schema
* **Temporary File Cleanup**: Fixed /tmp space leak by properly deleting temporary files
* **Sticky Backgrounds**: Added support for persistent background images across slides

### 🎨 Add Media Plugin Updates

* **Enhanced Options**: Added "Sticky Background" and "Fit Image" insertion modes
* **Improved Workflow**: Simplified media picker interface
* **macOS Compatibility**: Fixed modal dialog issues on macOS
* **Better Formatting**: Improved Markdown insertion with cleaner slide breaks

### 🖼️ Virtual Bible Snapshots Plugin

* **Lightbox Preview**: Click images to preview in fullscreen lightbox before importing
* **Menu Cleanup**: Removed redundant menu entries for cleaner interface

### 🌍 Localization

* **Translation System**: New centralized translation framework with `translations.json`
* **Spanish Support**: Partial Spanish (es) localization throughout application
* **Dynamic Language Loading**: `translate.js` automatically applies translations to UI elements
* **Menu Translation**: Main menu now automatically translates based on selected language
* **Setting Interface**: Added language selector to settings with Chromium language integration

### ⚙️ Core Application Changes

* **Settings Window**: Language preference now persists and applies throughout app
* **Plugin Framework**: Plugins now default to enabled on first run (addmedia, bibletext, hymnary, virtualbiblesnapshots)
* **Version Management**: All plugin versions synchronized to 0.2.0

### 🛠️ Bug Fixes

* **Thumbnail Format**: Changed default thumbnail format from `.webp` to `.jpg` for better compatibility
* **Export Improvements**: Added background tint overlay support to exported presentations
* **Import/Export**: Updated to handle new `.thumbnail.jpg` format
* **Translation Scripts**: Offline HTML bundles now include translation support

### 📚 Resources Plugin (NEW)

* **Resource Hub**: New plugin providing curated links to:
  - Free stock photo and video sites
  - Biblical imagery resources
  - Audio and music sources
  - Markdown editor recommendations
* **Tabbed Interface**: Organized resources by category (About, Media, Editors)

### 🏗️ Developer Notes

* **Build Instructions**: Updated with Bible JSON cleanup steps for all platforms
* **Dependencies**: Added `xml2js` for Bible XML parsing
* **Revelation Framework**: Updated internal framework to latest commit (e514547)

---

# REVELation Snapshot Presenter 0.1.6


### 🌐 Localization and Translations

* Added a partial **Spanish (es)** localization across admin and settings windows.
* Implemented a new **translation system** with `translations.json` and dynamic language loading in `translate.js`.
* Added `AppContext.translate()` and menu auto-translation in the Electron main process.
* Each admin HTML file now references `translate.js` and `data-translate` attributes.
* Added localized labels and documentation for all presentation schema fields (`presentation-schema.json`).

### 🧰 Core Features and Enhancements

* **Settings Window**

  * Added language selector (`English`, `Español`).
  * Localized UI labels and confirmation dialogs.
  * Now respects Chromium language setting (`app.commandLine.appendSwitch('lang', ...)`).
* **New Presentation Window**

  * Added option to disable automatic title slide creation.
  * Improved styling and localization.
* **Media Handling**

  * Renamed default thumbnail format from `.webp` → `.jpg` for better compatibility.
  * Adjusted all export, import, and cleanup logic accordingly.
  * Thumbnail delay increased from 2s → 3s for more reliable slide rendering.

### 🎵 Hymnary Plugin (v0.1.1)

* New plugin to **import public domain hymns** directly from [Hymnary.org](https://hymnary.org).
* Supports **search by title or text**, language selection, and **Markdown lyric insertion**.
* Automatically structures verses and refrains with Markdown slides.
* Added **Copy Lyrics** button, improved UI layout, and proper title/author attribution.

### 🖼️ Add Media Plugin

* Simplified **media picker** (removed unnecessary buttons, cleaner flow).
* Added “Sticky Background” and “Fit Image” options.
* Fixed macOS modal dialog issue by removing `modal: true` flag.
* Adjusted Markdown insertion format for cleaner slide breaks.

### 📦 Export & Import Improvements

* `exportPresentation`:

  * Added **automatic inclusion of translation scripts** and JSON into offline bundles.
  * Added support for new background tint overlay (`#fixed-tint-wrapper`).
* `importPresentation`:

  * Adjusted to look for `.thumbnail.jpg` instead of `.webp`.

### 🧩 Presentation Creation and Schema

* Expanded `presentation-schema.json` to include bilingual (`en`/`es`) labels and tooltips.
* Added documentation fields for Reveal.js options.
* Integrated translation-aware form builder that dynamically switches labels and tooltips based on selected language.

### 🪶 Other Improvements

* Updated internal submodule `revelation` to latest commit (`e514547`).
* General cleanup of developer console and improved load logging.
* Consistent naming and spacing fixes across plugins.

***

# REVELation Snapshot Presenter 0.1.4a

* Fixed bugs including one preventing adventisthymns plugin from working in packaged env

# REVELation Snapshot Presenter 0.1.4

## Highlights
* Added an in-app plugin manager that lets you enable, disable, and configure packaged or user-installed plugins while exposing them to the renderer and browser-facing sidebar UI.【F:lib/pluginDirector.js†L2-L168】【F:http_admin/settings.html†L82-L136】【F:http_admin/settings.js†L140-L177】【F:http_admin/sidebar.js†L14-L83】
* Expanded the plugin catalog with Adventist Hymns fetching, a revamped Virtual Bible Snapshots experience, reworked Add Media tooling, Bible Text translation support, and packaged highlight.js themes.【F:plugins/adventisthymns/plugin.js†L1-L139】【F:plugins/virtualbiblesnapshots/plugin.js†L1-L194】【F:plugins/virtualbiblesnapshots/search.html†L1-L98】【F:plugins/addmedia/plugin.js†L1-L144】【F:plugins/addmedia/add-media.js†L1-L74】【F:plugins/addmedia/media-picker.js†L1-L55】【F:plugins/bibletext/plugin.js†L1-L205】【F:scripts/copy-plugins.js†L1-L41】【F:plugins/highlight/plugin.js†L1-L31】【F:plugins/highlight/client.js†L1-L23】
* Streamlined media workflows with hashed storage, metadata capture, usage tracking, deletion, and high-bitrate variants, plus richer admin tools for managing assets.【F:lib/mediaLibrary.js†L1-L226】【F:lib/mediaUsageScanner.js†L1-L77】【F:http_admin/add-media.html†L1-L87】
* Delivered new import/export paths including offline ZIP bundles with media, slide image export, and safer presentation ZIP import cleanup.【F:lib/exportPresentation.js†L1-L210】【F:lib/exportWindow.js†L1-L104】【F:http_admin/export.html†L1-L43】【F:http_admin/export.js†L1-L62】【F:lib/importPresentation.js†L1-L156】
* Improved packaging and deployment by bundling static ffmpeg binaries, adding cross-platform build targets, defaulting to the documents folder, and mirroring resources to writable locations when packaged.【F:package.json†L1-L92】【F:lib/configManager.js†L1-L84】【F:main.js†L200-L301】

## Plugin ecosystem
* `pluginDirector` now resolves plugin folders for both development and packaged builds, exposes plugin metadata/config templates to renderers, writes a browser-readable index, and reloads plugins with preserved configuration defaults; preload bridges the new `getPluginList` and `pluginTrigger` APIs.【F:lib/pluginDirector.js†L2-L168】【F:preload.js†L28-L58】
* Settings gained a “Plugin Manager” section that toggles plugins, edits config fields, and persists the draft back through IPC, while the sidebar dynamically lists plugin-provided buttons ordered by priority.【F:http_admin/settings.html†L82-L136】【F:http_admin/settings.js†L140-L177】【F:http_admin/sidebar.js†L14-L83】
* The highlight integration now bundles the reveal.js highlight plugin and all highlight.js themes during `npm install`, allowing users to pick a stylesheet per presentation via plugin configuration.【F:scripts/copy-plugins.js†L1-L41】【F:plugins/highlight/plugin.js†L1-L31】【F:plugins/highlight/client.js†L1-L23】
* New Adventist Hymns plugin scrapes hymn slides, converts them to markdown, and can append them directly to a presentation file.【F:plugins/adventisthymns/plugin.js†L1-L139】
* Virtual Bible Snapshots adds menu entries, configurable API endpoints, multiple insertion modes (remote, inline, media library), and respects high-bitrate downloads with YAML media tagging.【F:plugins/virtualbiblesnapshots/plugin.js†L1-L194】【F:plugins/virtualbiblesnapshots/search.html†L1-L98】
* The Add Media plugin now offers dialogs for manual selection, scanning missing assets, and an electron-powered media picker that feeds YAML metadata into front matter via the plugin trigger API.【F:plugins/addmedia/plugin.js†L1-L211】【F:plugins/addmedia/add-media.js†L1-L74】【F:plugins/addmedia/media-picker.js†L1-L55】
* The Bible Text plugin can fetch translations from bible-api.com, prioritise KJV/ESV, call the ESV API when a key is provided, and insert formatted markdown with cite tags and copyright notices.【F:plugins/bibletext/plugin.js†L1-L205】

## Media management
* Media ingestion hashes files into a shared `_media` directory, records metadata/thumbnail sidecars, links optional high-bitrate variants, and falls back to ffmpeg when sharp fails while supporting deletion and usage scans.【F:lib/mediaLibrary.js†L1-L226】【F:lib/mediaUsageScanner.js†L1-L77】
* The Add Media admin form captures license, attribution, and source URLs before invoking the hashing pipeline so web downloads and metadata travel together.【F:http_admin/add-media.html†L1-L87】

## Presentation import & export
* Exporting a presentation now builds offline HTML per markdown file, copies Reveal resources, optionally packages referenced media (including large variants), and zips everything for distribution.【F:lib/exportPresentation.js†L1-L210】
* A dedicated export window provides ZIP, PDF, and JPEG image workflows, including headless slide capture with delay/size controls and thumbnail-only mode.【F:lib/exportWindow.js†L1-L104】【F:http_admin/export.html†L1-L43】【F:http_admin/export.js†L1-L62】
* Importing a REVELation ZIP cleans existing folders, extracts content, moves embedded media into the shared library, and prunes generated HTML and `_resources` artifacts.【F:lib/importPresentation.js†L1-L156】

## UI and administration
* Admin pages share a fixed sidebar that links presentations, the media library, settings, and plugin-specific tabs, highlights the current section, and surfaces the active presentation summary with clear/reset controls.【F:http_admin/sidebar.css†L1-L58】【F:http_admin/sidebar.js†L4-L137】
* Settings expose networking, Reveal Remote, FFmpeg path, plugin toggles, and plugin-specific fields, persisting them via the preload IPC surface.【F:http_admin/settings.html†L88-L136】【F:http_admin/settings.js†L151-L169】【F:preload.js†L28-L58】
* The main menu adds shortcuts for importing REVELation ZIPs, opening the plugins folder, and debugging (copy URL, open DevTools, log management).【F:lib/mainMenu.js†L10-L135】

## Packaging & deployment
* Electron Builder configuration now copies the `revelation`, `plugins`, `http_admin`, and bundled `ffmpeg-static` assets into packaged builds with platform-specific targets including Linux deb/rpm.【F:package.json†L10-L92】
* On startup the app mirrors bundled resources into the user data directory when the system install path is read-only and keeps them in sync on version changes without overwriting user-added plugins.【F:main.js†L240-L299】
* Default configuration picks a `REVELation Presentations` folder inside the user’s Documents directory, initialises it if missing, and preserves plugin configuration data in `config.json`.【F:lib/configManager.js†L12-L84】
* Server management launches Vite with presentation/plugin overrides, optionally hosts the Reveal Remote server for network mode, and guards against port conflicts while updating the resolved host address.【F:lib/serverManager.js†L1-L200】
