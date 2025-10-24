# CHANGELOG

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
