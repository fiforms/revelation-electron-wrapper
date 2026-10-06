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
[Documentation debt](#documentation-debt)

---

## Priority picks

If you only fix a handful, fix these. All are small.

| # | Issue | Why first |
|---|-------|-----------|
| U1 | Builder: docs say `Ctrl+B` for Bible, it is `Ctrl+T` | User-visible |

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

Proposal (investigated, not done). Dropping `allow-same-origin` is feasible, but these things depend on the shared
origin today and must change first, in this order:

1. `plugins/widgets/client.js` `findBridge` reads `window.parent.electronAPI.pluginTrigger` in the preview. Replace it
   with a postMessage proxy: the frame asks, the admin page calls `pluginTrigger('widgets', 'fetch', ...)` (widgets
   `fetch` only) and posts the answer back. That also stops the frame from ever holding the admin API.
2. The admin page reads into the frame: `mutePreviewFrame` (`http_admin/builder/events.js`, `contentDocument`, every
   second) and `plugins/richbuilder/builder.js` (`contentWindow.dispatchEvent`). Both fail silently once the origin is
   opaque; replace them with `mute` and `layout` commands on the existing bridge.
3. `window.localStorage` throws in an opaque origin. `revelation/js/contextmenu.js` and `presentations.js`
   (`remoteMultiplexId` fallback) access it without try/catch; wrap them. Check reveal.js plugins too.
4. Then drop the flag. Needs a manual test in Electron: module scripts, fonts and socket.io from `Origin: null`
   (CORS and the loopback gate are already set up for it).
The different-origin alternative (`127.0.0.1` vs `localhost`) needs steps 1 and 2 as well, plus CORS for the admin origin
on every module and font request.

### Other open items

- **Presenter QR / `shareUrl` handling.** `revelation/server/reveal-remote-broker.js` `initPresenter`: QR `baseUrl` is built from unvalidated `X-Forwarded-Host`/`Host`; `initialData.shareUrl.replace` throws if `shareUrl` is missing after the socket already joined.
- **Plugin downloads are not yet on the shared downloader or vetted.** `plugins/virtualbiblesnapshots` calls `downloadToTemp` (so it now has caps, timeouts and unpredictable names) but does not run `vetFileOnDisk` on what it keeps; `bibletext`, `adventisthymns`, `hymnary`, `wordpress_publish` and `widgets` still use their own `https.get`/`fetch` helpers without size caps (REFACTOR_CANDIDATES §4).
- **Legacy Office macro formats** (`.doc`, `.xls`, `.ppt`) are allowed in a `.revel` (the format doc admits it); only the OOXML macro types are prohibited.
- **`escapeHTML` does not encode `"`.** `revelation/js/presentationlist.js` (~L9; used ~L953, 1250, 1271, 1685) puts deck-controlled values (title, thumbnail, description) into double-quoted attributes, so a crafted value can inject an attribute. The page's CSP stops injected script (Low).
- **No CSP on `media-library.html` and `index.html`.** `presentation.html`, `presentations.html`, `handout.html` and `pip.html` have one; these two have not been reviewed.

---

## Correctness: main process

### C5 — Smaller main-process issues
- `updateChecker.js`: user-facing strings and the User-Agent say "Snapshot Builder" (the `translations.json` key and `about.html` use the same name, so renaming is a branding decision, not a bug fix).
- `pluginDirector.js`: `plugin-trigger` / `presentation-plugin-trigger` swallow plugin exceptions and return `undefined` (an unknown plugin or function returns `1`), an inconsistent error contract; callers rely on it today (none catches a rejection), so changing it means auditing the ~100 `pluginTrigger` call sites first.
- `presentationSyncPeers.js`: renaming/moving a folder orphans its peers (documented).

---

## Correctness: import/export/media

| Where | Severity | Issue |
|-------|----------|-------|
| `exportPresentation.js` (run) | Low | Mutates the user's presentation folder and relies on `finally` to undo; a hard kill leaves `_resources/`, generated `*.html` and `manifest.json` behind. |

---

## Correctness: builder & admin UI

(`http_admin/`.)

| ID | Where | Sev | Issue |
|----|-------|-----|-------|
| U13 | `builder/slides.js` ~L317 and `events.js` ~L1033 | Info | Poll `window.translationsources` with `setTimeout` instead of the `translations-loaded` event (kept: the event can fire before the listener exists). `events.js` `setInterval(mutePreviewFrame, 1000)` runs forever per window. |
| U19 | `http_admin/index.html` | Info | A 0-byte file; nothing in the repo references it. |

---

## Correctness: plugins

| Plugin | Where | Sev | Issue |
|--------|-------|-----|-------|
| `mediafx` | probes | Info | Two `ffmpeg -i` spawns per file; merging the probes was judged not clearly safe. |
| `videostream` | `client.js` ~L576 | Low | Hard-coded Google STUN server, no TURN: leaks peer IPs to Google and fails behind strict NAT. Make it configurable. |
| `wordpress_publish` | sync | Low | Not yet implemented: deletions and per-file conflict choice. For non-pullable paths (`.html`, `_resources/*` other than `_media`) "Keep server versions" keeps the local file and the server copy differing until the user acts (by design: those paths are never written locally). |
| `bibleworld` / `flickr` | download capture | Low | Broad allowed-host suffixes (`google.com`, `facebook.com`, `microsoft.com`) — likely needed for OAuth login; narrow only after checking which hosts the sites use. |

---

## Correctness: revelation submodule


---

## Documentation debt

Still open:

- **`doc/SETTINGS.md`** does not match the real tabs (Screens, Networking, Folders & Paths, PIP, Hotkeys, Plugins, Peer Pairing). Server key reset, port, public server and HTTPS live on **Networking**, not "Server and folders". Undocumented: window zoom, HTTPS (experimental), local API server toggle + port, presentation-window modes, Wayland/GNOME/KWin helper panel, the whole Peer Pairing tab. Needs a rewrite against `http_admin/settings.html`.
- **`doc/dev/BUILDER.md`** omits `resetPeerPushState()`, and doesn't describe the builder module map or the `RevelationBuilderHost` extension API. [ARCHITECTURE.md](ARCHITECTURE.md) now has the map; the host API is documented only in the header of `http_admin/builder/extensions-host.js`. A plugin-author doc for `getBuilderExtensions` is still missing.
- **`revelation/doc/SECURITY.md`**: remaining stale items — "namespace" wording (they are three separate Socket.IO servers on three `path`s; also in `doc/dev/PUBLIC_RELAY.md`), endpoint map omits `/css/**` and doesn't say `/thumbs_`, `/plugins_` and `/admin` exist only in custom-path mode, `**/index.json` loopback gate also covers `_media/index.json` (followers lose the high-quality variant lookup). (`pip.html` is now covered.)
- **Plugin READMEs missing:** `freeshow`, `divideslides`, `immich`, `infopanel`. `captions` and `bibletext` omit several defaults. `addmedia` omits audio import, drag-and-drop, LibreOffice dependency, `/api/addmedia/*` routes.
- **`README.md`** doc list omits `MACOS_INSTALL.md`, `API_REFERENCE.md`, `BUILDER_REFERENCE.md`, `PUBLIC_RELAY.md`, `REVEL_FORMAT.md`, `REVEL_IMPLEMENTATION.md`, `BUILDER.md`. `doc/dev/INSTALLING.md` has no prerequisites (Node ≥ 22.12), no `SKIP_BLOBS`, no link to `BUILDING.md`.
- **Spanish (`doc/i18n/es`)**: duplicate trees (`es/{GUI_REFERENCE,SETTINGS,TROUBLESHOOTING}.md` + `es/dev/*` vs `es/doc/…`), mostly byte-identical, and `lib/docsPresentationBuilder.js` publishes both. Heavily outdated: `TROUBLESHOOTING` (222 vs 376 lines), `dev/BUILDING` (98 vs 290), `dev/PEERING` (436 vs 660, pre-v2 protocol), `QUICKSTART` (79 vs 120). No Spanish version of `BUILDER.md`, `PUBLIC_RELAY.md`, `REVEL_FORMAT.md`, `REVEL_IMPLEMENTATION.md`, `API_REFERENCE.md`, `BUILDER_REFERENCE.md`, `MACOS_INSTALL.md`, or 13 plugin READMEs. `doc/i18n/README.md` lists only README and QUICKSTART as canonical sources.
- **In-app Help Contents** (`lib/docsPresentationBuilder.js getDefaultDocSources`) is a hard-coded list that omits `BUILDER.md`, `REVEL_FORMAT.md`, `REVEL_IMPLEMENTATION.md`, `PUBLIC_RELAY.md`, `MACOS_INSTALL.md`.
- **Tech-stack drift in old docs**: Electron is 44 (not 40); Reveal.js is ^6 in `revelation/package.json` (not 5.2.1); `jsdom` and `ffmpeg-static` are not root dependencies; `cheerio`, `ical.js`, `jszip`, `pptxgenjs` are.
