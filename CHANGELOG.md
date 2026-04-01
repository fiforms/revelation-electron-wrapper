# CHANGELOG

# REVELation Snapshots Presenter 1.0.6beta

## Main Interface Changes

* Added a **Peer Screens menu** for managing connected peer display targets.
* Moved **Peer Presenter Pairing** into the Settings screen for a more unified configuration experience.
* Improved layout of the Settings screen and made the **Apply Settings button** dynamically enabled/disabled based on unsaved changes.
* Made settings screen **tabbed** for better organization.
* Software detects Network and IP address changes seamlessly

## Plugins and Ecosystem

* Built a **richer and safer plugin ecosystem** with an updated interface for discovering plugin info.
* Improved plugin descriptions and the plugin settings interface.
* Added the **Math reveal.js plugin** for rich equation rendering and the **Appearance plugin** for slide animations and effects.
* Added a proof-of-concept **Live Captions presentation plugin** for real-time speech-to-text captions using whisper.cpp.

## Rich Builder Improvements

* Added a **table editor** to the Rich Builder.
* Implemented **2-column layout** support in the Rich Builder.
* Implemented **links** in the Rich Editor.
* Added **blockquote support** and fixed alignment of lists and editing of task lists.
* Refactored the Rich Builder into modular JS files.
* Implemented **Ctrl+Arrow key navigation** in the builder preview.

## Export

* Added a limited (proof-of-concept) **FreeShow export** functionality.
* Added hooks for export plugin features.
* General export improvements.

## WordPress Plugin

* Added many more basic features

## Media and Content

* Added **audio support to the media library** and implemented adding audio from the media library in the builder.
* Added **avif** to safe allowed file extensions.
* Polished the Adventist Hymns plugin and modularized its scraping logic.
* Added test presentation installer.

## Presentation Features

* Implemented the **:hide: feature** for slides.
* Implemented image captions with :caption:: syntax.
* Fixed bugs with paragraph and component animation and fragments.
* Added slide scroll features to settings.

## Networking and Infrastructure

* Combined the RevealRemote server into the same Vite server to reduce port usage.
* Made more explicit option to use RevealRemote.
* Built a **reverse proxy builder** tool.
* Fixed socket path resolution.
* Made pairing more resilient; fixed stale cache pairing bug.

## Localization and Documentation

* Added **default LLM docs** for LLM-assisted presentation authoring.
* Added roadmap and comparison chart.
* Improved translation switching; fixed bug where translation selection did not update Bible view.
* Added a simple credits line.

# REVELation Snapshots Presenter 1.0.4beta3

## WordPress Publishing and Web Delivery

* Added a full **WordPress publish workflow** for pairing the desktop app with a WordPress site and publishing presentations remotely.
* Introduced a companion `revelation-presentations` WordPress plugin with admin approval for pairing, presentation hosting, shortcode/template support, and server-side storage management.
* Added **incremental publish** so only changed presentation files are uploaded during updates.
* Added **shared media library sync** to mirror the desktop `_media` library to WordPress shared storage.
* Hardened pairing and publishing with RSA challenge-response verification, publish tokens, timestamp/nonce checks, and clearer HTTPS warnings.

## Builder and Authoring Workflow

* Added **Smart Paste** for turning copied song lyrics and structured text into slides more automatically, including SongSelect-oriented handling.
* Added the **Slide Sorter** plugin for drag-and-drop slide reordering, quick duplicate/delete actions, and faster deck restructuring.
* Added the experimental **Rich Builder** mode for direct rich-text editing inside the builder preview area.
* Improved builder media workflows with image/video drag-and-drop, thumbnails, smarter slide reparsing, and better handling of directives, citations, and underline formatting.
* Added a global zoom factor option and several builder layout/navigation refinements.

## Presentation Features and Plugins

* Added the **CCLI credit plugin** for license-number macros, YAML-based credits blocks, and better copyright handling in song presentations.
* Added the **Markerboard** plugin for live on-slide annotation with pen/highlighter/eraser tools, undo/clear actions, and optional peer sync.
* Added the **Slide Control** plugin for presentation navigation overlays and optional remote control from connected peers.
* Added a **Bible Reading** page and **Bible verse search** improvements in the Bible Text plugin.
* Expanded plugin coverage by shipping new default plugins including **WordPress Publish**, **Slide Sorter**, and **Rich Builder**.
* Simplified plugin bootstrapping

## Remote, Sync, and Runtime Improvements

* Added web synchronization support required by the WordPress publishing workflow.
* Improved plugin-side socket handling so remote features work more reliably across shared sessions and browser tabs.
* Improved markerboard synchronization behavior and added options for public or presenter-only control modes.
* Added configurable presenter socket endpoint support for more flexible deployment setups.

## Localization, Docs, and Maintenance

* Expanded plugin documentation for new features including WordPress Publish, Markerboard, Slide Control, and CCLI credits.
* Added more Spanish localization coverage, including plugin docs and user-facing strings.
* Updated Electron, npm dependencies, and the internal `revelation` submodule to pull in upstream fixes and improvements.

# REVELation Snapshots Presenter 1.0.2beta2

## Localization and Language Onboarding

* Added a **first-run language selection screen**.
* Expanded Spanish localization coverage across the app and added missing translations.
* Localized multiple plugins and pages, including **Bible Text**, **Virtual Bible Snapshots**, **MediaFX**, **Resources**, and plugin tab labels.
* Updated handout loading to use the appropriate language variant.
* Added plugin-localization documentation and a machine-translated Spanish documentation set.

## Bible Module and Plugin Improvements

* Delivered major improvements to the Bible module.
* Added UI enhancements in the Bible Text plugin.
* Fixed copyright reference text on the reference slide.

## Presentation and Workflow Enhancements

* Added support for storing presentation markdown in subfolders.
* Improved reliability of thumbnail refresh after presentation import.
* Added an option to navigate back in relevant UI flows.
* Added feature to enable global hotkeys for certain actions
* Added "always open screens" feature
* Added compactor plugin to reduce presentation size
* Improvements to PDF Export

## Help, Debug, and Maintenance

* Added a menu option for opening help contents.
* Added a startup flag to launch with `--enable-devtools`.
* Updated the internal Revelation submodule several times to pull in upstream fixes and features.
* Improved lower-third chroma key rendering
* Fixed some NAT-related bugs in peering (for instances running in VM)

# REVELation Snapshots Presenter 1.0.0beta1

## Peering, Pairing, and Multi-Screen

* Added **multi-master peering** and support for **virtual peers / additional screens**.
* Improved pairing reliability with race-condition fixes, clearer PIN flow, hostname/friendly instance display, and pairing event toast messages.
* Simplified peering enable/disable behavior and gated pairing UI when mDNS browse is disabled.

## Builder and Authoring Workflow

* Added **slide timing recording**, a **gradient builder**, transition markdown support, and countdown command support.
* Added context menu actions for slides (**add / delete / duplicate**) and fixed snap-back issues when adding slides/columns at the end.
* Improved markdown parsing and editing stability, including robust handling of `:note:` delimiters and better slide-break behavior.
* Added teleprompter scroll speed controls, notes mode options, variant-aware spellcheck, and font-size shortcuts in speaker notes.

## Media, Charts, and Content Features

* Integrated and expanded **reveal-chart** support, including `:table:` support, column summarization, style attributes, and animation data IDs.
* Upgraded **MediaFX** with multi-effect processing, preset gallery/load-save workflow, backend-aligned UI, and improved output resolution controls.
* Added CCLI attribution handling and license macro support.
* Added PPTX notes import and non-looping background behavior.

## Packaging, Security, and Platform Reliability

* Upgraded Electron/Electron Builder and reduced package size by removing duplicate payloads.
* Added and packaged **Poppler PDF** support for Windows with packaging fixes, plus resilient handling for system `node_modules`.
* Hardened preview and presentation-window security (reduced preload attack surface and tighter builder preview hardening).
* Improved upgrade/export stability, including complete manifest regeneration and cleaner startup/debug behavior.

## Documentation and UX Polish

* Expanded documentation for every aspect of the software including plugin READMEs.
* Added contextual help links/buttons across builder and plugin/admin workflows.
* Improved handout formatting/behavior and multiple builder UX refinements.

# REVELation Snapshots Presenter 0.2.6beta

## Slideshow Builder UI Improvements

* Added a **one-click button to launch presentations directly from the builder**, reducing friction between editing and presenting.
* Reorganized the **builder top bar**, consolidating menus and adding **external edit** and **Open Presentation** buttons
* Introduced **keyboard shortcuts** for common functions
* Improved **slide and column management UI**, including:

  * Reordering slides
  * Moving columns left/right

* Tweaked UI visuals:

  * Editor boxes are different colors to avoid confusion

* Improved Spanish translation

## Builder Architecture & Maintainability

* Refactored and documented `builder.js` for clarity and long-term maintainability.

## Presentation & Preview Behavior

* Fixed an issue where the **preview jumped back to the start unexpectedly**.
* Adjusted debounce/bounce timing and **disabled preview updates while editing notes**, improving performance and editing stability.
* Reduced default presentation size so **default text appears larger and more readable**

## Macros & Text Styling

* Added new macros:
  * `shiftleft`
  * `shiftright`
  * `lighttext`
  * `darktext`
* Added :AI: tag to show AI icon on slide

## VRBM (Media Browser) Improvements

* Reworked image insertion from VRBM, adding **attribution and AI metadata handling**.

# Media Library
 * Repaired high-bitrate loading logic
 * Added option to auto-convert high-bitrate videos to H.264 for older hardware

## Reliability & Infrastructure

* Fixed server startup behavior to **dynamically select a port if the default is already in use**, preventing launch failures.
* Updated the Revelation submodule (twice; consolidated here).


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
