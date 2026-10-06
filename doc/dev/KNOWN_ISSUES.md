# Known Issues

Outstanding bugs and risks found in the **2026-10-05 whole-codebase audit** (wrapper,
`revelation/` submodule, bundled plugins, build tooling).

**How to read this list**

- Everything here comes from reading the code. **Nothing was reproduced at runtime** (the app was
  not launched), except where an item says *reproduced*. Items marked *(uncertain)* are the
  auditors' lower-confidence calls and need a runtime check before anyone invests in a fix.
- Severity is the auditors' estimate of impact, not a CVSS score. Confidence is how sure they are the
  code does what the entry says.
- Line numbers drift; search for the named function instead. Paths are relative to the repo root;
  `revelation/…` is the submodule.
- Design-level security findings (F5–F9) and deliberate non-goals live in [TODO.md](../../TODO.md) and
  [revelation/doc/SECURITY.md](../../revelation/doc/SECURITY.md); they are not repeated here.
- Duplicated code that should be merged is tracked separately in
  [REFACTOR_CANDIDATES.md](REFACTOR_CANDIDATES.md). Where a bug is *caused by* duplication, the
  entry points there.
- Fix an item and delete it here; the fix is recorded in git history (CHANGELOG.md is only updated at module releases).

Contents: [Priority picks](#priority-picks) · [Security](#security) · [Correctness: main process](#correctness-main-process) ·
[Correctness: import/export/media](#correctness-importexportmedia) · [Correctness: builder & admin UI](#correctness-builder--admin-ui) ·
[Correctness: plugins](#correctness-plugins) · [Correctness: revelation submodule](#correctness-revelation-submodule) ·
[Build, packaging, repo hygiene](#build-packaging-repo-hygiene) · [Dead code](#dead-code) · [Documentation debt](#documentation-debt)

---

## Priority picks

If you only fix a handful, fix these. All are small.

| # | Issue | Why first |
|---|-------|-----------|
| H1 | WordPress plugin header says `Version: 1.0.9`; code, zip and `package.json` say 1.0.12 / 1.0.13 | WordPress admin shows the wrong version |
| U1 | Builder: Hymnary `Ctrl+Y` never fires (builder redo captures it); docs say `Ctrl+B` for Bible, it is `Ctrl+T` | User-visible |

---

## Security

Security model: bundled and installed plugins are fully trusted (see [ARCHITECTURE.md](ARCHITECTURE.md) §8), and so is
the local user. Findings below are the ones that matter under that model: untrusted content (an imported `.revel`, a
deck's markdown, a downloaded file) or an unauthenticated network request reaching something it should not. Ordered by
importance. Design-level findings and non-goals live in [TODO.md](../../TODO.md) and
[revelation/doc/SECURITY.md](../../revelation/doc/SECURITY.md).

### Builder preview iframe can reach the builder's preload (Medium)

`http_admin/builder.html` frames the deck in `#preview-frame` with `sandbox="allow-scripts allow-same-origin"`. That
combination removes the sandbox's isolation: the frame is same-origin with the builder window, so script running in the
deck can read `window.parent.electronAPI`. The builder uses the full `preload.js` (file access, `plugin-trigger`,
`save-app-config`, export, import, ...), whereas the presentation window's `preload_presentation.js` is deliberately
small. A hostile deck (for example an imported `.revel`) that gets script to run in the preview, through a sanitizer
bypass or any other injection, would therefore get the builder's powers instead of the presentation window's.

What stands in the way today is the markdown sanitizer and the deck page's CSP (`script-src 'self'`). The postMessage
token guards the preview bridge only; it does not stop `window.parent` access. The bridge also posts with target origin
`'*'` (`builder/preview.js`), as do the peer-share URL messages in `revelation/js/presentations.js` and `contextmenu.js`.

Fix direction: drop `allow-same-origin`, so the frame gets an opaque origin and cannot touch the parent. The server
already has a gate for this (`createSandboxOriginGate`: `Origin: null` accepted from loopback only), so the preview was
apparently designed that way once. Needs a check of what the deck needs from its real origin (storage, `index.json` and
media fetches, `widgets` `findBridge`, peer linking), and the bridge should post to the frame's window with a real target
and verify `event.source`. The alternative is to serve the preview from a different origin than the admin page
(`127.0.0.1` vs `localhost`), since the preload is only exposed to the top frame.

### Other open items

- **Unauthenticated `/peer/*` parses the config on every request.** `revelation/server/peer-server.js` `loadPeerConfig` synchronously parses the whole `config.json` (RSA keys, PIN) on every request, including `auth-nonce` / `public-key` when `mdnsPublish` is on. A cheap DoS from the network; cache with an mtime check.
- **Presenter QR / `shareUrl` handling.** `revelation/server/reveal-remote-broker.js` `initPresenter`: QR `baseUrl` is built from unvalidated `X-Forwarded-Host`/`Host`; `initialData.shareUrl.replace` throws if `shareUrl` is missing after the socket already joined.
- **Plugin downloads are not yet on the shared downloader or vetted.** `plugins/virtualbiblesnapshots` calls `downloadToTemp` (so it now has caps, timeouts and unpredictable names) but does not run `vetFileOnDisk` on what it keeps; `bibletext`, `adventisthymns`, `hymnary`, `wordpress_publish` and `widgets` still use their own `https.get`/`fetch` helpers without size caps (REFACTOR_CANDIDATES §4).
- **Legacy Office macro formats** (`.doc`, `.xls`, `.ppt`) are allowed in a `.revel` (the format doc admits it); only the OOXML macro types are prohibited.
- **`escapeHTML` does not encode `"`.** `revelation/js/presentationlist.js` (~L9; used ~L953, 1250, 1271, 1685) puts deck-controlled values (title, thumbnail, description) into double-quoted attributes, so a crafted value can inject an attribute. The page's CSP stops injected script (Low).
- **No CSP on `media-library.html` and `index.html`.** `presentation.html`, `presentations.html`, `handout.html` and `pip.html` have one; these two have not been reviewed.

---

## Correctness: main process

### C5 — Smaller main-process issues
- `docsPresentationBuilder.js` builds the plugin index from the bundled `plugins/`, not the active plugin folder (user-installed plugins are missing from the docs). Fixing it means passing the resolved plugin folder in from `main.js`, which runs before `pluginDirector` has resolved it.
- `lib/popplerRelease.js`: Poppler download URLs/hashes are pinned to release v1.0.12 while `package.json` is 1.0.13 (intentional per comment; rebuild when the ZIPs change).
- `openedPresentation.js` `queue()` keeps only the **last** pending file; a burst of macOS `open-file` events *before the app is ready* drops all but one (docs say "only the first"). Harmless in practice (one presentation opens), but the docs and code disagree.
- `updateChecker.js`: user-facing strings and the User-Agent say "Snapshot Builder" (the `translations.json` key and `about.html` use the same name, so renaming is a branding decision, not a bug fix).
- `pluginDirector.js`: `plugin-trigger` swallows plugin exceptions and returns `undefined`/`1` (inconsistent error contract; plugins' callers rely on it today); menu ZIP install doesn't clear `require.cache` (reinstall may keep old code until restart *(uncertain)*); the `<id>.installing` staging dir sits inside the plugins folder and is briefly listed as a plugin; `pluginConfigs[name]` throws if `pluginConfigs` is missing (`loadConfig` always sets it).
- `lib/otherEventHandlers.js` `reset-key` changes `config.key` but Vite was started with the old `PRESENTATIONS_KEY_OVERRIDE`; verify Settings follows it with `reload-servers`.
- `presentationSyncPeers.js`: renaming/moving a folder orphans its peers (documented).

---

## Correctness: import/export/media

| Where | Severity | Issue |
|-------|----------|-------|
| `lib/exportPresentation.js` `collectMarkdownFilesRecursive` (~L296) | Medium | Doesn't skip dot-dirs or `_resources`: `.sync-conflicts/*.md` backups become "presentations" in standalone exports and manifest `markdownFiles`. |
| `exportPresentation.js` ~L486 | Medium | Theme-CSS lookup runs for `.revel` export too and throws **outside** the `try`, so IPC rejects instead of returning `{success:false}`. |
| `exportPresentation.js` ~L697 | Low | Standalone zip `output` stream has no `'error'` handler. |
| `exportPresentation.js` ~L74 | Low | `<title>${slug}` not HTML-escaped in the offline page. |
| `exportPresentation.js` (run) | Low | Mutates the user's presentation folder and relies on `finally` to undo; a hard kill leaves junk and the slug isn't validated. |
| `lib/pdfExport.js` | Medium | No `try/finally`: any failure leaks the hidden `BrowserWindow` and rejects the IPC. `marginsType` likely not a valid `printToPDF` option *(uncertain)*; large commented-out dead block. |
| `lib/importPresentation.js` ~L185 | Low | `importMediaFromResources` / `importMissingMediaFromYaml` run after extraction with no cleanup; an exception leaves a half-imported folder (or `_current_open`). |
| `lib/mediaUsageScanner.js` ~L22, 48 | Medium | `entry.filename` throws on a null `media` entry (the rest of that file is skipped, so media looks unused and can be offered for deletion); `statSync` on a broken symlink rejects the whole scan; `large_variant` and audio/avif/svg extensions ignored. |
| `lib/mediaLibrary.js` ~L124 | Low | File-picker title is "Import Presentation ZIP" for media. |
| Thumbnail format | Low | Library writes `.thumbnail.jpg`, import writes `.thumbnail.webp`, export copies only `.jpg`; exported thumbnails for imported media are missing. |
| `lib/openedPresentation.js` `importOpened` | Low | Another slugify copy; `renameSync` can fail with EBUSY on Windows if a window still holds files. |

---

## Correctness: builder & admin UI

(`http_admin/`.)

| ID | Where | Sev | Issue |
|----|-------|-----|-------|
| U1 | `builder/history.js` vs `plugins/hymnary/client.js` | Medium | `Ctrl+Y` is redo in the builder (capture phase, `stopImmediatePropagation`), so Hymnary's shortcut never fires. Pick another key or drop Y-as-redo. |
| U2 | `builder/preview.js` `pushToPeers` (~L470–515) | Medium *(uncertain)* | After the multiplex id arrives it never sends `resumeRevealRemote` (only re-link and iframe `ready` do), though `doc/dev/BUILDER.md` step 6 says it does. Peers likely don't get the current slide until unlink/relink. Needs a runtime check. Also push failures only `console.log` — UI stays on "Connecting to peers…". |
| U3 | `builder/markdown.js` ~L224 | Medium *(uncertain)* | `buildSlide` always writes `:note:` while `parseSlide` uses `state.noteSeparator`; a legacy `Note:` file loaded without migration turns notes into body text after save+reload. Mitigated by `normalizeNoteSeparators` in `lib/presentationBuilderWindow.js`; direct URL access and `.revel` read-only paths bypass it. |
| U4 | i18n gaps | Medium | `create.js` has zero `tr()` calls; `edit-metadata.html` doesn't load `/js/translate.js`; `import-presentation.html`, `add-media.html`, `host.openDialog` ("Close"), `events.js` help alert and `sidebar.js` "Clear" are English-only. |
| U5 | `builder/extensions-host.js` `notify()` | Low | Uses `window.__builderToast`, which is never defined; `host.notify()` only logs to the console. |
| U6 | `builder/app-state.js` ~L114 | Low | Leftover `console.trace` on every `markDirty`. |
| U7 | `builder/smart-paste.js` ~L477 | Low | Logs the full clipboard text/HTML on every Smart Paste; the `/\bon\w+\s*=/` sanity regex also rejects harmless text such as `online = 5`. |
| U8 | `builder/document.js` ~L30 | Low | `parseFrontMatterText` returns `null` on invalid YAML; `currentMeta.media` then throws inside save/preview when front matter has `imports:` and the YAML is broken. |
| U9 | `builder/content.js` ~L326 | Low | `triggerContentCreatorByPlugin` matches `c.id` but `builder-template` creators don't copy `item.id`. |
| U10 | `create.js` ~L1232 | Low | Result is coloured `limegreen` even when `res.success` is false. |
| U11 | `create.js` ~L185, 246 | Low | Front-matter regexes accept only `\n`; CRLF files load with defaults in edit mode. Unescaped `new RegExp(alias)`. |
| U12 | `builder/media.js` ~L500 | Low | `innerHTML` with unescaped transition names from the registry (not user-controlled today). |
| U13 | `builder/slides.js` ~L318 and `events.js` ~L1061 | Info | Poll `window.translationsources` with `setTimeout` instead of the `translations-loaded` event. `events.js` ~L663 `setInterval(mutePreviewFrame, 1000)` runs forever per window. |
| U14 | `sidebar.js` ~L136 | Low *(uncertain)* | Second IIFE throws on `?nosidebar` (caught); async `<head>` injection may touch `document.body` before it exists. |
| U15 | `settings.js saveSettings` (~L1250) | Low | `saveAppConfig`/`reloadServers` rejections aren't caught; no unsaved-changes guard on close (matches the planned settings UX follow-up). |
| U16 | `plugins/videostream/plugin.js` config | Medium | `configTemplate` uses `type:'select'` + `options`; `settings.js` only renders dropdowns for `ui:'dropdown'` + `dropdownsrc`, so those three fields show as free-text boxes. (`export.js` and `create.js` already support `select`+`options`; supporting it in `settings.js` is the better fix.) |
| U17 | `builder/extensions-host.js openDialog` | Low | No Escape handling or focus trap; a rejected `spec.render` promise isn't caught. |
| U18 | `builder/media.js` / `content.js` pending maps | Low | `pendingAddMedia` / `pendingContentInsert` keys and their `localStorage` return keys accumulate if the plugin window closes unanswered. |
| U19 | Dead branches | Info | `preview.js setPreviewMode` (both arms return); `preview.js getPreviewDeck` duplicates the `slides.js` one; `slides.js` ~L481 redundant assignment; `export.js` `pdf`/`pdf-vector` share one branch plus a commented-out block; `http_admin/index.html` is a 0-byte file. |
| U20 | `settings.js` field rendering (~L1110) | Low | Fields marked `secret: true` render as plain text boxes; they could be password inputs. |

---

## Correctness: plugins

| Plugin | Where | Sev | Issue |
|--------|-------|-----|-------|
| `bibletext` | `plugin.js` `fetchESVPassage` / `fetchPassage` / `get-translations` | Medium | No HTTP status check; `https.get` throws on a non-https `bibleAPI`; an empty ESV key silently returns an empty passage; `JSON.parse` of an error page surfaces as "Unexpected token". |
| `bibletext` | `register()` | Low | `localBibles.loadBibles(...)` is async, un-awaited and un-caught; early `get-translations` sees an empty list. |
| `bibletext` | online text / `copyrightFull` | Low | Placed into markdown/`<cite>` raw; relies on downstream sanitizing. |
| `infopanel` | `plugin.js` login handler (~L55) | Low–Med | When `loggedIn === authInfo.host` it calls `event.preventDefault()` **without** `callback`, leaving the auth challenge hanging; `loggedIn` is never reset; a new `browser-window-created` listener is added on every re-register. |
| `addmedia` | `add-selected-file` | Low | Silently overwrites a same-named file (batch importers use `makeUniqueName`); three different extension lists disagree (`mkv`/`mov`, `avif`/`svg`). |
| `addmedia` | `process-missing-media` | Low | `alreadyLinked` regex misses `<…>`-wrapped links and `media:` aliases, so files are re-added; `decodeURIComponent` can throw on a malformed `%` and abort the call. Duplicate `fit` branch (dead). |
| `virtualbiblesnapshots` | `downloadAssetToPresentation` | Low | `copyFileSync` silently overwrites; sidecar JSON isn't rewritten if present. Leftover `console.log(item)`; dead `openPluginWindow` with a misspelled `parames=` query. `api-server.js`: unexplained `row.xx === 'XX'` filter, `https`-only fetch, unbounded cache. `downloadIntoMedia` config is declared but unused. |
| `wordpress_publish` | `fetchJson` (~L86–155) | Low–Med | `req.setTimeout(12000)` is an idle timeout and the error is always "Pairing request timed out." — a slow 8 MiB chunk upload aborts with a misleading message. |
| `wordpress_publish` | keep-server conflict branch | Low | For non-pullable paths (`.html`, `_resources/*` other than `_media`) "Keep server versions" backs up the local file but doesn't pull, so it is then re-uploaded — the server loses despite the user's choice. |
| `wordpress_publish` | no-base sync | Low | If `sync-peers.json` is lost, "newer modified wins" is mtime-based and `utimes` stamps the remote mtime; older remote content can overwrite newer local edits. Back up the loser into `.sync-conflicts/` too. Not yet implemented: deletions, per-file conflict choice. |
| `mediashare` | `buildPresentationMarkdown` | Low | Filename embedded in a double-quoted YAML title with only `"` replaced; a `\` breaks YAML. `alt` not escaped. Temp `_mediashare_*` folders leak after a crash. |
| `mediafx` | `getEnv()` / probes | Info | Logs "using FFMPEG_PATH" on every call; `ffmpegPath()` ignores `lib/ffmpegResolver`; two `ffmpeg -i` spawns per file. `runningProcesses` grows until cleared. |
| `popplerpdf` | `register` | Low | `saveConfig()` on every launch even when unchanged. |
| `videostream` | `client.js` ~L576 | Low | Hard-coded Google STUN server, no TURN: leaks peer IPs to Google and fails behind strict NAT. Make it configurable. |
| `ontime` | `client.js` | Low | Lower-thirds `setInterval` never cleared; countdown polling hard-coded to 5 s (ignores `pollIntervalSeconds`); errors swallowed with no indicator. |
| `markerboard` | `client.js` | Low | `socketDebug: true` by default; init logs the full plugin context/config. |
| `test` | `plugin.js` `example-echo` | Low | `this.AppContext` is undefined (`this === api`); always throws and is logged. |
| `compactor` | `plugin.js` | Trivial | `jobs` Map never pruned. |
| `adventisthymns` | `service.js` | Low | Fetches with no timeout (no `AbortController`). |
| `bibleworld` / `flickr` | download capture | Low | Predictable temp names in shared `os.tmpdir()` (use `mkdtemp`); `will-download` is hooked for the whole persistent partition; broad allowed-host suffixes (`google.com`, `facebook.com`, `microsoft.com`). |
| `bibletext/bibles/` | repo weight | Info | Each Bible ships as `.xml`, `.xml.gz` and a generated `.json` (tens of MB). Confirm git-tracked status; the JSON is a derived cache. |
| manifests | `resources/plugin-manifest.json` | Info | Description says it manages resource files; the plugin is a static help page. |
| `resources/plugin.js` | | Info | `exposeToBrowser: true` without `clientHookJS` is a no-op; empty `api`. |
| `plugins.json` | generated | Info | Stale snapshot of whatever was enabled at the last `writePluginsIndex`. |

---

## Correctness: revelation submodule

- **Picture-in-picture hides `electronAPI` from the deck.** The preload exposes it on the top frame (`pip.html`) only, so presentation code that calls `window.electronAPI` directly sees none in PiP and behaves as in a plain browser. Widgets were fixed (they now find it on the parent frame). Likely affected but **not checked**: `captions` (`presentationPluginTrigger`: start/stop and state), the `getAppConfig()` lookups in `revelation/js/presentation-bootstrap.js` and `presentations.js` (CCLI number, high-bitrate preference, peer settings), and `info-panel.js`. A shared helper that returns `window.electronAPI` or, for a same-origin PiP parent only, `window.parent.electronAPI` would fix them in one place; do not alias it globally, because in the builder preview the parent is the admin window with a much larger API.

---

## Build, packaging, repo hygiene

| ID | Where | Sev | Issue |
|----|-------|-----|-------|
| H1 | `WordPress/revelation-presentations/revelation-presentations.php` L5 vs L15; `readme.txt` | Medium | Header `Version: 1.0.9` and `Stable tag: 1.0.9` vs `RP_PLUGIN_VERSION` 1.0.12. WordPress reads the header. |
| H3 | `npm run build` | Low | `wp:sync-runtime` runs twice (the `wp:package` step re-runs it): double copy and esbuild. Call `wp-package-plugin.js` directly. |
| H4 | `wp:package` / `scripts/package.js` on a fresh checkout | Low | Fail ("Required path not found") until `npm run build` has produced inputs; `prepackage.js` throws if the WP zip for the current version is missing. |
| H5 | `.github/workflows/build-macos.yml` | Low | Node 20, but Electron 44 requires Node ≥ 22.12; manual trigger only; `npm install` not `npm ci`; artifact-name typo "revelaton-". No Windows/Linux/WordPress CI. |
| H6 | Fetch scripts | Low | Each of `fetch-ffmpeg`, `fetch-effectgenerator`, `fetch-oldcss`, `fetch-theme-thumbnails`, `fetch-mediafx-gallery`, `download-libs`, `build-popplerpdf-win` re-implements https download+redirect. `postinstall` and `fetch-blobs` list the same sequence and have drifted (`fetch-blobs` lacks ffmpeg). |
| H7 | Stray/stale local artifacts | Info | Empty `package/` tree at the repo root; stale `WordPress/build/…1.0.5-git/` unpacked copy; old zips in `dist/`. All untracked/ignored — safe to delete. |
| H8 | `.gitignore` coverage | Info | `bin/ffmpeg/` (downloaded on mac/win) and `package/` aren't ignored; `revelation/assets/oldcss` and `revelation/css/theme-thumbnails` rely on the submodule's ignores. |
| H9 | Licensing | Info | `package.json` has no `license` field (MIT in `LICENSE.md`); `bin/SOURCES.md` has no licence note for bundled ffmpeg. |
| H10 | `package.json` scripts | Info | `dist-popplerpdf-win` and `-mac` are identical commands; `generate-oldcss-manifest.js` has no npm script (maintainer tool); `build:wp` aliases `wp:package`. |

---

## Dead code

- `lib/pluginBootstrap.js` — empty module, no importer.
- `lib/ffmpegResolver.js configureFfmpegForModule` — unused; three callers set `fluent-ffmpeg`'s path by hand instead (REFACTOR D12).
- `presentationWindow.isRemote` (written, never read); `preload.js` `shell` import; `aboutWindow.js` `ipcMain` import; `AppContext.saveConfig` (used only by `plugins/wordpress_publish`).
- `lib/handoutWindow.js` `menu:handout-view` callback with a placeholder slug; uses `console.log` (silenced unless `--enable-debug`).
- `lib/createPresentation.js` try/catch that rethrows `new Error(err.message)`.
- `configManager` `mdnsAuthToken` — still generated, unused.
- `plugins/revealchart/builder.js getBuilderTemplates` — dead duplicate of `client.js`.
- `plugins/hymnary/plugin.js` unused `const { ref } = require('process')`; `plugins/bibletext/localbiblemanager.js` unused `const { info } = require('console')`.
- `defaultEnabled` on several `plugin.js` files — never read (see [PLUGINS.md](PLUGINS.md)).

---

## Documentation debt

Still open:

- **`doc/SETTINGS.md`** does not match the real tabs (Screens, Networking, Folders & Paths, PIP, Hotkeys, Plugins, Peer Pairing). Server key reset, port, public server and HTTPS live on **Networking**, not "Server and folders". Undocumented: window zoom, HTTPS (experimental), local API server toggle + port, presentation-window modes, Wayland/GNOME/KWin helper panel, the whole Peer Pairing tab. Needs a rewrite against `http_admin/settings.html`.
- **`doc/dev/BUILDER.md`** step 6 of peer syncing (see U2), omits `resetPeerPushState()`, and doesn't describe the builder module map or the `RevelationBuilderHost` extension API. [ARCHITECTURE.md](ARCHITECTURE.md) now has the map; the host API is documented only in the header of `http_admin/builder/extensions-host.js`. A plugin-author doc for `getBuilderExtensions` is still missing.
- **`revelation/doc/SECURITY.md`**: remaining stale items — "namespace" wording (they are three separate Socket.IO servers on three `path`s; also in `doc/dev/PUBLIC_RELAY.md`), endpoint map omits `/css/**` and doesn't say `/thumbs_`, `/plugins_` and `/admin` exist only in custom-path mode, `**/index.json` loopback gate also covers `_media/index.json` (followers lose the high-quality variant lookup). (`pip.html` is now covered.)
- **Plugin READMEs missing:** `freeshow`, `divideslides`, `immich`, `infopanel`. `captions` and `bibletext` omit several defaults. `addmedia` omits audio import, drag-and-drop, LibreOffice dependency, `/api/addmedia/*` routes.
- **`README.md`** doc list omits `MACOS_INSTALL.md`, `API_REFERENCE.md`, `BUILDER_REFERENCE.md`, `PUBLIC_RELAY.md`, `REVEL_FORMAT.md`, `REVEL_IMPLEMENTATION.md`, `BUILDER.md`. `doc/dev/INSTALLING.md` has no prerequisites (Node ≥ 22.12), no `SKIP_BLOBS`, no link to `BUILDING.md`.
- **Spanish (`doc/i18n/es`)**: duplicate trees (`es/{GUI_REFERENCE,SETTINGS,TROUBLESHOOTING}.md` + `es/dev/*` vs `es/doc/…`), mostly byte-identical, and `lib/docsPresentationBuilder.js` publishes both. Heavily outdated: `TROUBLESHOOTING` (222 vs 376 lines), `dev/BUILDING` (98 vs 290), `dev/PEERING` (436 vs 660, pre-v2 protocol), `QUICKSTART` (79 vs 120). No Spanish version of `BUILDER.md`, `PUBLIC_RELAY.md`, `REVEL_FORMAT.md`, `REVEL_IMPLEMENTATION.md`, `API_REFERENCE.md`, `BUILDER_REFERENCE.md`, `MACOS_INSTALL.md`, or 13 plugin READMEs. `doc/i18n/README.md` lists only README and QUICKSTART as canonical sources.
- **In-app Help Contents** (`lib/docsPresentationBuilder.js getDefaultDocSources`) is a hard-coded list that omits `BUILDER.md`, `REVEL_FORMAT.md`, `REVEL_IMPLEMENTATION.md`, `PUBLIC_RELAY.md`, `MACOS_INSTALL.md`.
- **Tech-stack drift in old docs**: Electron is 44 (not 40); Reveal.js is ^6 in `revelation/package.json` (not 5.2.1); `jsdom` and `ffmpeg-static` are not root dependencies; `cheerio`, `ical.js`, `jszip`, `pptxgenjs` are.
