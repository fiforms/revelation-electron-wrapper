# Refactor Candidates

Places where the same job is implemented more than once, found in the **2026-10-05 audit**. Nothing
here has been changed — this is a to-do list for a future consolidation pass.

Grouped by *what is duplicated*, not by folder, because most duplication crosses the
wrapper / submodule / plugin boundaries. Each group lists the copies, a suggested home, and the
bugs it would fix ([KNOWN_ISSUES.md](KNOWN_ISSUES.md) IDs). Line numbers drift; search by function name.

**Suggested order** (best payoff per effort):

1. [Path safety](#1-path-safety--slugs) — **started**: `lib/pathSafety.js` exists and fixed S1; the rest of the call sites below still need it.
2. [Front-matter parsing](#2-front-matter-parsing) — ~20 copies, three failure behaviours.
3. [HTML escaping](#3-html-escaping) — ~15 copies, one of them wrong (quotes).
4. [Local server URL building and admin windows](#5-window-and-url-boilerplate-main-process) — mechanical, removes ~25 call sites.
5. [HTTP download/fetch helpers](#4-http-fetch-and-download) (**started**: `lib/httpUtil.js` now backs URL import and `downloadToTemp`) and [ZIP handling](#6-zip-handling).
6. The rest, as touched.

A caution that applies across the board: the submodule is a **separate repo that must also run
standalone** (`npm run relay`, dev server), and `revelation/js/*` is bundled for the browser, so
"shared module" there means ESM that Node and the browser can both import. `lib/*` is CommonJS in
the Electron main process. Anything shared across the two needs a dual-format home (see §2).

---

## 1. Path safety / slugs

**Problem:** every module re-derives "is this path inside the presentations folder?" and "make a
safe slug" with slightly different rules, and a few still don't check. `lib/pathSafety.js` (`assertSafeBasename`, `isSafeMediaFilename`, `resolveInside`, `resolvePresentationDir/File`) now covers media filenames and most renderer-supplied slug/mdFile joins; adopt it for the rest rather than adding another variant.

| Copy | Where |
|------|-------|
| `slugify` | `lib/importPresentation.js` ~L411, `lib/createPresentation.js` ~L54, inline in `lib/openedPresentation.js` ~L236, `http_admin/create.js` ~L233 (+ `randomFourDigits`), `http_admin/import-presentation.js` ~L78 |
| "stays inside base" checks | `importPresentation.js` (`resolvePresentationPath`, `resolvePresentationDestPath`, `resolveManifestTarget`, `runUrlImport`), `exportPresentation.js` (`isInsideDir`), `revelFormat.js` extract, `pluginDirector.js` (`extractZipSafely`), `presentationControlRoutes.js` (ad hoc `includes('/')`/`'..'`), `plugins/wordpress_publish/plugin.js` (`safePresentationFilePath` and `safeMediaLibraryFilePath` — the same function twice) |
| Still no check | `mediaLibrary.js delete-media-item`; the macro-file handlers in `lib/otherEventHandlers.js` (dialog-chosen paths, by design) |
| Markdown filename validators | `revelation/js/compiler/compiler-utils.js` (`sanitizeMarkdownFilename`, `resolveExternalFilePath`), `presentationlist.js isValidMarkdownPath`, `SAFE_MD_LINK_RE` ×2 (`presentations.js`, `handout.js`) — overlapping, subtly different (`sanitizeMarkdownFilename` allows a `./` prefix and strips `?#`; the regexes do not) |

**Suggest:** `lib/pathSafety.js` with `slugify`, `resolveInside(base, rel)` (throws),
`assertSafeBasename`, `resolvePresentationFile(AppContext, slug, mdFile)`. Expose it to plugins
via `AppContext` so they stop hand-joining paths. Browser-side markdown-name validation stays in
`compiler-utils.js`, but the two regex copies should import it.

**Fixes:** S1 and S5 (done).

---

## 2. Front-matter parsing

**Problem:** roughly 20 independent copies of `/^---\n…\n---/` + `yaml.load`, with three different
behaviours on bad input and an LF-only variant that breaks CRLF files. The js-yaml 5 empty/comment-only
throw is already handled everywhere by `lib/yamlParse.js` `parseYamlOrEmpty` (and
`revelation/js/yaml-parse.js` in the browser); the regex + parse copies themselves remain.

| Copy | Failure behaviour |
|------|-------------------|
| `revelation/js/compiler/markdown-compiler.js` ~L86 | `{malformed YAML}` placeholder |
| `revelation/js/presentationlist.js` ~L737 | returns `{}` |
| `revelation/vite.plugins.js` `readFrontMatterData` ~L13 | `yaml.loadAll` (the correct one), throws, caller builds placeholder |
| `revelation/js/presentation-bootstrap.js` ~L262, `handout.js` ~L216 | `load(x) \|\| {}` — throws on empty |
| `http_admin/builder/markdown.js` (`extractFrontMatter`, `parseFrontMatterText`) | CRLF-tolerant; silently merges `imports` |
| `http_admin/create.js` ~L185, 246 | LF-only |
| `plugins/virtualbiblesnapshots/search.js` and `hymnary/hymnarysearch.js` (new local `escapeHtml`, plus `safeUrl` in the former),
`plugins/richbuilder/builder-utils.js` `normalizeFrontmatterYaml` (+ slidesorter copy), `mdvalidate/plugin.js`, `addmedia`, `freeshow` | various |
| `lib/createPresentation.js` ~L136, `presentationBuilderWindow.js` ~L70/154, `exportPresentation.js` ~L132 (CRLF-aware), `importPresentation.js` ~L863 (LF-only), `openedPresentation.js` ~L70, `mediaUsageScanner.js` ~L40 (loose), `mediaLibrary.js` ~L640, `docsPresentationBuilder.js` ~L279 | various |

**Related duplication that should move with it:**
- Note-separator version gating (`NOTE_VERSION_BREAKPOINT` `[0,2,6]`, `normalizeNoteSeparators`, `parseSemverTuple`, `compareVersionTuples`, `isLegacyNoteVersion`) — **four** copies: `builder/markdown.js`, `compiler-utils.js`, `lib/createPresentation.js`, `lib/presentationBuilderWindow.js` (identical).
- Slide/column segmentation: `builder/markdown.js` (`splitByMarkerLines`, `parseSlide`) duplicates `revelation/js/compiler/presentation-segments.js` (`splitSlides`, `splitSlideContentAndNotes`). Plugins richbuilder/slidesorter do *not* re-split (they use the host's `stacks`). `mdvalidate/plugin.js` has a *third* independent separator and code-fence scanner (own `~~~` handling, `imports` merge).
- Slide joiner literal `'\n\n---\n\n'` hard-coded in `markdown.js`, `slides.js` ×2, plus a magic `before.length + 7` and `SMART_PASTE_SLIDE_BREAK`.
- `imports:` merging and `alternatives:` handling: `presentation-bootstrap.js` ~L254–290 vs `handout.js` ~L205–235 (verbatim copy, including the dynamic `import('js-yaml')`).
- The CSS snapshot table: `lib/exportPresentation.js` ~L13 mirrors `CSS_VERSION_SNAPSHOTS` in `compiler-utils.js` ("keep both in sync").
- "Syncable path"/hidden-path rules in three places: `presentationManifest.shouldIncludeInManifest`, `revelFormat.hasHiddenSegment` + `planRevelContents` (hard-codes `'manifest.json'`/`'__builder_temp.md'` although `presentationManifest` has the constants), `presentationSyncPlan.isSyncablePath` (own `MANIFEST_FILENAME`).

**Suggest:** one pure module with `parseFrontMatter(text) → {data, body, malformed}` using
`loadAll` semantics, CRLF-tolerant, written as dual ESM/CJS-safe (e.g.
`revelation/shared/frontmatter.js`, served to browser pages at `/js/` and `require`d by `lib/`).
Put the note-separator/version helpers and segmentation in `compiler-utils.js` / `presentation-segments.js`
(they are plain JS already) and have the builder import them; keep `{top, body, notes}` slide parsing
in the builder on top. Export the manifest/hidden-path constants from one place.

**Fixes:** U3 (note separator round trip), U11, the `mediaUsageScanner` loose-regex bug.

---

## 3. HTML escaping

**Problem:** ~15 `escapeHtml`-style helpers; the DOM-based version does **not** encode quotes yet is
used inside attributes (KNOWN_ISSUES S7).

Copies: `revelation/js/presentationlist.js` ~L9, `media-core.js` ~L6, `handout.js` ~L14 (identical DOM-based,
no quote encoding), `markdown-compiler.js escapeHtmlAttr`; `http_admin/settings.js` ~L135, `export.js` ~L33;
`lib/presentationWindow.js` ~L81, `exportPresentation.js encodeHTML` (no quote escaping);
`plugins/richbuilder/builder-utils.js` (`escapeHtml`, `escapeAttribute`), `revealchart` (`escapeHTML`, `escapeAttr`),
`credit_ccli` ×2, `bibletext/search.js`, `read.js` (`esc`), `bibletext-live/plugin.js`, `compactor/client.js`,
`lowerthirds` (`esc`, `escapeXml`), `markerboard` (`escapeXml`), `ontime/client.js` (`esc`, only `&` and `"`).

**Suggest:** `revelation/js/escape.js` exporting `escapeHTML` that encodes `& < > " '`, plus
`escapeAttr`. Plugin client code gets it by import (or via the plugin loader context); main-process code
gets a CJS twin. Prefer `textContent` where possible (the builder already does).

**Fixes:** the `presentationlist.js` attribute-injection item, and
`ontime`'s partial escaping.

---

## 4. HTTP fetch and download

| Copy | Behaviour |
|------|-----------|
| `lib/importPresentation.js fetchBinary` | http/https, redirects, timeout, no size cap |
| `lib/mediaLibrary.js downloadToTemp` | https only; no redirect, timeout, size cap or stream-error handling |
| `lib/pluginDirector.js downloadToFile` | `net.fetch`, size cap + sha256 |
| `lib/peerHttp.js fetchJSON` | JSON, timeout |
| `plugins/wordpress_publish/plugin.js fetchJson` (~L86) | idle timeout, misleading error text |
| `plugins/virtualbiblesnapshots/api-server.js fetchJson` | GET, 1 h cache, https only |
| `plugins/widgets/endpoint-server.js httpsGet` | SSRF-hardened (keep this property) |
| `plugins/bibletext/plugin.js` (`fetchESVPassage`, `fetchPassage`, `get-translations`) | hand-rolled `https.get`, no status check |
| `plugins/adventisthymns/service.js`, `hymnary/plugin.js` | `fetch`, no timeout / no `ok` check |
| `scripts/fetch-*.js`, `download-libs.js`, `build-popplerpdf-win.js` | each reimplements download + redirect |

**Status:** `lib/httpUtil.js` exists (`downloadToFile`, `fetchBuffer`: streaming, 8 GiB per-file cap, idle timeout, redirect limit, exclusive create). `importPresentation` and `mediaLibrary.downloadToTemp` use it. The rows below marked for `importPresentation.fetchBinary` and `downloadToTemp` are done; the plugin and script copies remain. Original suggestion: `lib/httpUtil.js` — `fetchBuffer`, `fetchJson`, `downloadToFile` with redirects, timeout,
`maxBytes`, optional sha256, and a pluggable resolver so `widgets` keeps its SSRF guard. A separate
`scripts/lib/download.js` for build tooling (it can't depend on Electron). Use `fs.mkdtemp` instead of
predictable names in `os.tmpdir()`.

**Fixes:** S6 (done for URL import and `downloadToTemp`), `wordpress_publish` timeout message, `bibletext` status checks.

---

## 5. Window and URL boilerplate (main process)

| ID | Duplicated thing | Where | Suggest |
|----|------------------|-------|---------|
| D1 | `buildServerURL(AppContext.hostURL, config.viteServerPort, config.httpsEnabled)` ~25×  | `serverUrl.js` callers: `mainWindow.js`, `aboutWindow`, `peerPairingWindow`, `settingsWindow`, `otherEventHandlers` ×2, `exportWindow` ×2, `handoutWindow`, `createPresentation`, `presentationBuilderWindow`, `presentationWindow` ×3, `plugins/wordpress_publish` | `serverUrl.fromContext(AppContext, {lan})` and `adminPageUrl(AppContext, path, params)`; one `loadAdminPage(win, path, params)` for menu navigation |
| D2 | Admin window boilerplate: `new BrowserWindow({… preload}); setMenu(null); loadURL(base+path)` | `aboutWindow`, `exportWindow`, `createPresentation`, `presentationBuilderWindow` | `openAdminWindow(AppContext, {path, query, width, height})` (e.g. `lib/adminWindow.js`) |
| D3 | External-link policy (`isExternalURL` + `setWindowOpenHandler` + `will-navigate` + `shell.openExternal`) | `mainWindow.js` ×2, `handoutWindow`, `presentationWindow` ×3, `presentationBuilderWindow`, `mainMenu` (no catch), `otherEventHandlers` (no catch); renderer `openExternalIfNeeded` in `preload_handout.js` and `preload_presentation.js` | `attachExternalLinkPolicy(webContents, {allowOrigin})` + `openExternalSafe(url)` with http/https/mailto allow-list and `.catch` (check whether sandboxed preloads can `require` a shared file) |
| D5 | `normalizeZoomFactor` | `appContext.js`, `otherEventHandlers.js` ~L90 | export once |
| D8 | `deriveThumbnailName(mdFile)` | `exportWindow.js` ~L20, `createPresentation.js` ~L69, `presentationBuilderWindow.js` ~L112, `revelation/vite.plugins.js` ~L218, `presentationlist.js` ~L754 | one export (exportWindow owns thumbnail generation); the submodule copy must stay in sync by convention |
| D9 | Theme-CSS exclusion list `['handout.css','presentations.css','medialibrary.css','lowerthirds.css','confidencemonitor.css','notes-teleprompter.css']` | `otherEventHandlers.js getAvailableThemes` and `themeThumbnailer.js` (commit 1c6d079 had to fix one of them) | `listThemeFiles(revelationDir)` exported once; the IPC handler also has its own 4-candidate directory search the thumbnailer lacks |
| D10 | Wayland/X11 detection (`--ozone-platform=x11` argv scan; `isGnomeWayland`/`isKdeWayland` are copies) | `presentationWindow.js` (inline ~L245, `hasOzoneX11Override` ~L546), `otherEventHandlers.js` ~L410 | `lib/session.js` (`isWayland()`, `desktopIs('GNOME'\|'KDE')`) |
| D11 | `delay()`, execFile-promise wrapper, XDG data home | `gnomeWindowHelper`, `kwinWindowHelper`, `linuxFileIcon` | `lib/util/proc.js`, `xdgDataHome()` (low priority) |
| D13 | Presentation URL query building (lang/variant/ccli/media=high); `createPresentation` builds `dir=,slug=,md=` by hand, **not URL-encoded** | `presentationWindow.js applyPresentationOptions` vs `buildInternalPresentationUrl`; `exportWindow.js`; `handoutWindow.js`; `createPresentation.js`; `pdfExport.js` | `buildPresentationUrl(AppContext, slug, mdFile, {lang, variant, extra})` with `URLSearchParams` everywhere |
| D14 | `config.preferredPresentationLanguage \|\| config.language \|\| 'en'` (6+ copies in `presentationWindow.js`, plus `handoutWindow`, `exportWindow`) | | `getPresentationLanguage(config)` |
| D15 | Icon path selection (`assets/icon.ico\|png`) ×4; `app.isPackaged ? process.resourcesPath : __dirname` | `mainWindow.js`, `firstRunWizard.js`, `profileWindow`, `splashWindow` | `resolveAppIcon()`, `resolveResourcePath()` |
| D16 | Thumbnail regeneration on builder close (two identical blocks) | `presentationBuilderWindow.js` ~L850, 869 | local helper |
| D17 | Result-dialog and "toast + OK dialog + reloadServers" tails | `otherEventHandlers.js` ~L598–680, `settingsWindow.js` ×3 | `showResultDialog`, `finishAndReload` |
| D18 | Profile-name normalisation | `configManager.js` ×4, `settingsWindow.js` ×2, `mainMenu.js` | `normalizeProfileName()` exported from configManager |

---

## 6. ZIP handling

- **Extraction:** `revelFormat.extractRevelArchive` (hardened: skips unsafe/hidden/prohibited, sanitizes SVG, size limits) vs `pluginDirector.extractZipSafely` (own traversal check, **no limits**) vs `plugins/addmedia/plugin.js` and `scripts/*`.
- **Writing:** archiver in `revelFormat.writeRevelArchive`, `exportPresentation.js` (standalone glob), `exportWindow.js` ~L238; **jszip** in `exportWindow.js` ~L301.

**Suggest:** `safeExtractZip(zipPath, dest, {filter, limits})` (pluginDirector reuses revelFormat's limits with a different name filter); standardize on archiver + unzipper and drop jszip.

---

## 7. Media helpers

- **Type detection:** `mediaLibrary.js mediaType` (audio/svg/avif) vs `importPresentation.js mediaTypeFromFilename` (narrower).
- **Thumbnails:** `makeThumbnail` (jpg, `mediaLibrary.js`) vs `makeWebpThumbnail` (webp, `importPresentation.js`). **Pick one format** — see KNOWN_ISSUES (exported thumbnails missing).
- **ffmpeg path:** `lib/ffmpegResolver.js configureFfmpegForModule` exists but is unused; `importPresentation.js`, `mediaLibrary.js` and `plugins/compactor/plugin.js` each call `ffmpeg.setFfmpegPath(getActiveFfmpegPath(...))` by hand; `mediafx` runs `ffmpeg -i` twice per file (`getMediaDurationSeconds`, `getMediaDimensions`) where one probe would do.
- **Binary resolvers:** `ffmpegResolver`, `libreofficeResolver`, `plugins/addmedia/popplerResolver.js` / `plugins/popplerpdf` all do "configured → known locations → PATH". A generic `resolveBinary({configured, candidates, names})`.
- **Media-reference scanning:** `mediaUsageScanner.extractUsedMedia` vs `exportPresentation`'s `frontMatter.media` loop (scanner ignores `large_variant`). One `collectMediaFilenames(mdText)`.
- **Hashing:** SHA-1 in `presentationManifest.hashFile`, `importPresentation.hashFileSha1`, `plugins/wordpress_publish` ~L1023; md5 `computeFileHash` in `mediaLibrary`. One `hashFile(path, algo)`.
- **Front-matter `media:` writers:** `builder/media.js addMediaToFrontmatter` (error alert on collision) vs `extensions-host.js tx.mergeMediaEntries` (numeric suffix) vs `lib/mediaLibrary.addMediaToFrontMatter`. Unify collision rules.
- **Media tag → markdown switch** (background / backgroundnoloop / fit / normal): `plugins/addmedia/plugin.js` ×4 (one with a dead duplicate branch). One table.
- **Tag/entry generation:** `plugins/virtualbiblesnapshots/api-server.js generateTag/buildEntry` is explicitly "mirrors addmedia/api-server.js". Export once from addmedia or `lib/mediaLibrary.js`.
- **Media-path helpers in builder plugins:** `slidesorter/builder.js` and `richbuilder/builder-utils.js`/`builder-media.js` carry the same `encodePathSafely`, `normalizeFrontmatterYaml`, `updateMediaRuntime`, `resolveMediaDisplaySrc`, `toThumbnailUrl`, `isVideoSrc`, sticky-background parsing. Share one module under `http_admin/builder/` and expose it via the builder host (`host.media.resolveDisplaySrc(raw)`), since the host already holds the metadata.
- **Offline asset lookup:** `exportPresentation.js` repeats the `[revelationRoot, resourcesPath, REVELATION_ROOT]` triple 5×; a `findRevelationAsset(relPath)` removes ~40 lines.

---

## 8. Version comparison

`revelFormat.compareVersions`, `pluginDirector.compareVersions` (suffix handling — different semantics),
`exportPresentation.parseSemverTuple`/`compareVersionTuples`, `updateChecker.js`, and the note-version copies
in §2. → `lib/versionUtil.js` with strict and lenient modes.

---

## 9. Filesystem walking and copying

- Folder walkers: `presentationManifest.collectManifestFiles`, `revelFormat.planRevelContents`, `exportPresentation.collectMarkdownFilesRecursive` (~L296) and `copyDir`, `presentationBuilderWindow.js` ~L48 (another `collectMarkdownFilesRecursive`) → one `walkFiles(root, {skipHidden})`.
- POSIX normalisation: `revelFormat.toPosix`, `presentationManifest.toPosixPath`, `exportPresentation.toPosixRel`.
- Submodule: `copyRecursiveSync` ×3 (`vite.plugins.js`, `scripts/copy-fonts.js`, `scripts/init-presentations.js`) — `fs.cpSync` replaces all.
- "Append markdown to a presentation": `appendSlidesMarkdown` copied in `adventisthymns/plugin.js` and `hymnary/plugin.js`; `bibletext insert-passage` does the same without an exists-check; `addmedia` does `fs.appendFileSync` in ~6 places → `lib/presentationFiles.js appendMarkdown(slug, mdFile, text)` (validated).

---

## 10. Peer / sync

- `pickPeerHost` duplicated in `peerPairing.js` and `mdnsManager.js`; peer base-URL construction repeated in `peerPairing`, `mdnsManager`, `peerCommandClient`.
- `plugins/wordpress_publish/plugin.js publishPresentationToSite` (~200 lines) hard-codes WordPress transport while `presentationSyncPlan`/`presentationSyncPeers` are generic (`kind: 'wordpress'|'url'`). If another transport is planned, split `pullPresentationFile / uploadPresentationFile / commit` behind an interface. Not a defect today.
- `wordpress_publish` `pair-site` and `pair-status` build the same pairing record twice → `buildPairingRecord`.

---

## 11. Plugin-layer duplication

| What | Copies | Suggest |
|------|--------|---------|
| Embedded-browser importer | `plugins/bibleworld/plugin.js` vs `flickr/plugin.js`, ~70% identical (`isWebUrl`, `hostAllowed`, `openExternal`, `stripExt`, `sanitize`, `pickExtension`, `scrapePageMetadata`, `notifyPage`, `registerDownloadCapture`, `attachNavigationHandlers`, `openExplorer`) | `lib/embeddedBrowserImporter.js({partition, startUrl, allowedSuffixes, scraper, licenseFn})` |
| Presenter-plugins Socket.IO client | hand-rolled in `bibletext-live/client.js`+`plugin.js`, `captions/client.js`, `markerboard/client/socketMethods.js` (+ `getPresenterSocketEndpoint` URL parsing in each); `slidecontrol` and `videostream` use the same channel | One `RevelationPresenterSocket` helper in `revelation/js` plus a main-process twin. Room ids are inconsistent today: `bibletext-live` uses per-session `presenterLiveRoomId`; `captions`/`markerboard` use `remoteMultiplexId` from localStorage (the F3 "master key in room table" fix applied only to `bibletext-live`) |
| Hymn search/insert | `adventisthymns` and `hymnary`: own dialog opener, search UI, `toYamlScalar`, `:credits:` title-slide builder, verse/refrain parser, near-identical 49-line `client.js` | shared `hymnSlides.js` and a generic content-creator dialog opener |
| Builder-loader stubs | `slidesorter/client.js`, `richbuilder/client.js`, `mdvalidate/client.js`, `test/client.js` (`isBuilderPage` + dynamic import of `./builder.js` + try/catch), ~100 lines | `lazyBuilderExtensions('./builder.js')` in pluginloader |
| Plugin window opener | `http://${hostURL}:${viteServerPort}/plugins_${key}/<plugin>/<page>?…` in `addmedia` ×4, `adventisthymns`, `hymnary`, `bibletext` | `AppContext.openPluginWindow(plugin, page, query, opts)` |
| `humanRefToOsis` | `bibletext/api-server.js` ~L7 and `plugin.js` ~L575 (plugin already exports it) | api-server calls the export |
| `color-spans.js` | **byte-identical** in `plugins/richbuilder/` and `http_admin/builder/` (header says "keep in sync") | serve one copy, import from the other |
| `mdvalidate` report formatter | `api-server.js formatValidationReport` vs `builder.js formatReportText` | formatter in `plugin.js`; `api.validate` returns text |
| Builder `getBuilderTemplates` | `revealchart/client.js` and `revealchart/builder.js` (unused) | delete the latter |
| Modals / menus | inline-`cssText` modals in `compactor`, `appearance`, `credit_ccli`, `immich`, `markerboard`; hand-built fixed menus ×2 in `slidesorter/builder.js`; core: `extensions-host.js openDialog`, `variants.js`, `media.js`, `create.js` ×2, `readonly.js`, `settings.js` pin modal | core code should use `host.openDialog`; add `host.showContextMenu(items)`; move colours to CSS classes; a shared `/js` modal for pages outside the builder (`credit_ccli`, `immich`) |

---

## 12. Builder UI internals (`http_admin/`)

- **Dropdown boilerplate** (open/close/outside-click/Escape) ~11 copies across `menus.js`, `media.js`, `content.js`, `properties.js`; the `addItem(label,onClick,disabled)` builder is copy-pasted in `content.js`, `media.js` ×3, `menus.js` → `createDropdown({menu, button, render})`.
- **Translation helpers:** the builder uses `trFormat(key, vars)`; `settings.js` and `export.js` define their own `t(key)` and hand-`replace('{x}', …)` dozens of times; `create.js`, `import-presentation.js`, `add-media.html` are hard-coded English; the submodule has four local shims around the global `tr` (`info-panel.js t()`, `media-line-parsers.js tr`, `media-core.js tt`, `contextmenu.js` bare `tr`). → put `trFormat` on `window` from `translate.js`.
- **Peer-push iframe URL** built three times in `builder/preview.js` (`updatePreview`, `pushToPeers`, `resetPeerPushState`) → `buildPreviewUrl({peer})`.
- **Slide split-at-caret** in `slides.js breakCurrentSlide`, `extensions-host.js tx.splitSlide`, and richbuilder's own → `splitSlideAt(h, v, before, after)`.
- **`getPreviewDeck()`** defined in both `preview.js` (unused) and `slides.js`. Delete one.
- **`getMetadata()`/imports merging:** `parseFrontMatterText` silently merges `state.importsData` into every parse; callers that then stringify write the flattened imports back, and `getFullMarkdown` un-flattens by value comparison. A `parseFrontMatterRaw()` (no merge) would simplify it.
- **Poll → event:** `renderSlideList` and `events.js` poll `window.translationsources` with `setTimeout`; use the existing `translations-loaded` event.
- **Media-picker UIs:** builder delegates to `addmedia` via `pluginTrigger` + localStorage return key; `create.js` has a separate media tile editor (~L1494–2010); `add-media.html` is a third minimal form.

---

## 13. Presentation listing and thumbnails

Presentation listing: `revelation/server/presentation-index.js` (server walk + front matter → `index.json`) vs `presentationlist.js loadPresentationDetails` (re-fetches and re-parses each md client-side) vs `lib/` listing code. "Hidden alternative" rules live in `vite.plugins.js isHiddenAlternativeMetadata`, `loader-dom.js createAlternativeSelector` and the bootstrap's `rawKey !== 'self' && langCode !== 'hidden'`.

Thumbnail generation exists in four forms — the server's `/thumbs_<key>` ffmpeg (`createThumbnailGenerator` in `revelation/server/thumbnails.js`), slide capture (`exportWindow.js`), media `.thumbnail.jpg` (media library), theme thumbnails (`menu:generate-theme-thumbnails`) — sharing only the naming and 320 px size by convention. `vite.plugins.js` also has two local-IP helpers (`getLocalIpAddress` is dead).

---

## 14. Theme CSS and generated assets

- **Theme SCSS:** 16 of 17 slideshow themes repeat the same ~15-line `#fixed-overlay-wrapper` / `#fixed-tint-wrapper` / `.info-head,.info-body` block (only 3 colours differ) and the same header. Extract a mixin in `custom/layouts.scss` taking `($overlay-bg, $overlay-fg, $tint, $info-bg)`; it would also fix the invalid `zIndex:`/`pointerEvents:`/`rgba(…266…)` (R3).
- **WordPress runtime copies:** `WordPress/revelation-presentations/assets/runtime/js/{offline-bundle.js,.min.js,.min.js.map,translate.js,translations.json}` and a second full copy under `WordPress/build/…`. All gitignored (not tracked bloat), but they are rebuilt by `wp:sync-runtime`, which currently runs twice per `npm run build`. Copy from `revelation/dist` / `revelation/js` in one step.
- **`oldcss`:** `assets/oldcss/1.0.6` (9.1 MB) is untracked and fetched; a fresh clone silently depends on it (R9). Decide: track it, or generate it deterministically.
- **`doc/i18n/es`:** two parallel trees (`es/dev/*` and `es/doc/dev/*`), mostly byte-identical; pick one layout. `lib/docsPresentationBuilder.js` publishes both.
- **Build scripts:** the fetch scripts (§4); `fetch-blobs.js` and `postinstall.js` list the same sequence and have drifted; `fetch-wordpress-libs.js` is a 24-line wrapper of `download-libs.js`; `wp-package-plugin.js` and `prepackage.js` carry the same `readPluginVersion` regex and zip-name format; `dist-popplerpdf-win` and `-mac` are identical commands.

---

## 15. Things that look duplicated but are fine

Recorded so they aren't "fixed" later.

- `lib/peerAuth.js` is the single owner of RSA signing for peers. `plugins/wordpress_publish` reuses `signChallenge` with a *different* key by design (WordPress vs peer keypairs are deliberately separate).
- The peer signature constructions live once, in `revelation/server/peer-protocol.js`; `lib/peerAuth.js` re-exports them (`lib/revelationModules.js`).
- `slidesorter` and `richbuilder` do **not** re-parse markdown; they work on the host's `stacks`.
- The wordpress_publish plugin correctly delegates planning and peer storage to `lib/presentationSyncPlan.js` / `presentationSyncPeers.js`.
- `http_admin/builder/tint.js` is the only colour-conversion implementation in the repo.
- `plugins/widgets/endpoint-server.js`'s own fetch is deliberate (SSRF guard).
