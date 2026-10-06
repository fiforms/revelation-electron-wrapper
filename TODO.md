# TODO

Known work that has been identified and deliberately not done yet. Completed
items move to [CHANGELOG.md](CHANGELOG.md).

---

## Codebase audit follow-ups (2026-10-05)

A whole-codebase read produced three companion documents. Work from them rather
than duplicating their contents here:

* **[doc/dev/KNOWN_ISSUES.md](doc/dev/KNOWN_ISSUES.md)** — outstanding bugs
  and risks with file, severity and suggested fix. Start with its *Priority
  picks* table (S1–S4, C1, C2, H1, U1).
* **[doc/dev/REFACTOR_CANDIDATES.md](doc/dev/REFACTOR_CANDIDATES.md)** — duplicated
  implementations to consolidate, in suggested order: path safety → front-matter
  parsing → HTML escaping → URL/window boilerplate → HTTP/ZIP helpers.
* **[doc/dev/ARCHITECTURE.md](doc/dev/ARCHITECTURE.md)** — the wrapper architecture
  map (replaces the thin overview that used to live in AGENTS.md).

Nothing in the audit was runtime-tested; entries marked *(uncertain)* need a
check before fixing. The security findings below (F5–F9) are *design-level* and
stay in this file; the audit's code-level security items (S1–S7) are in
KNOWN_ISSUES.md.

Other follow-ups raised by the audit:

* **Commit the submodule.** `revelation/` now has uncommitted comment/doc edits
  (header comments across `vite.plugins.js`, `js/*`, `server/peer-server.js`, scripts;
  rewritten `doc/ARCHITECTURE.md`, corrected `doc/SECURITY.md` rows) and sits at
  `fb5f752` while the wrapper records `61edb1a`.
* **Rewrite `doc/SETTINGS.md`** against the real Settings tabs, and add a
  plugin-author doc for the builder extension host (`RevelationBuilderHost`).
* **Refresh the Spanish docs** and collapse the duplicate `doc/i18n/es/` trees.
* **Finish `revelation/doc/SECURITY.md`**: "namespace" → three Socket.IO servers on
  three paths; add `pip.html`; endpoint-map gaps (details in KNOWN_ISSUES).

---

## Security hardening

Open findings from the 2026-09-20 review of the HTTP/WebSocket surface. The
model these were measured against is
[revelation/doc/SECURITY.md](revelation/doc/SECURITY.md); fixed items (F1–F4
and most of F3) are in the CHANGELOG. Nothing open is rated above Medium.

### F7 — `/plugins_<key>/` serves main-process plugin source over the network

**Medium** · `revelation/vite.plugins.js` (plugins static mount in `configureServer`)

The mount passes `{}`, so it keeps `serve-static`'s default `index` behaviour
and serves the *entire* plugin directory — including files that only ever run
in the Electron main process (`plugin.js`, `api-server.js`,
`localbiblemanager.js`, `fetch-bibles.js`). Only `client.js`, HTML and locales
are needed by the browser.

The code is open source, so this is disclosure rather than compromise. The
real risk is forward-looking: any future plugin shipping a credential or a
template with an embedded token alongside its client code is published to
every key holder automatically.

**Fix:** mirror the presentations mount (`{ index: false, fallthrough: true }`)
and serve only browser-facing files — either an extension allowlist or a
per-plugin `web/` subdirectory declared in `plugin-manifest.json`.
Estimated ~1 hour.

### F6 — `/thumbs_<key>/` has an unbounded work queue

**Medium** · `revelation/server/thumbnails.js` (`createThumbsMiddleware`)

Reachable by anyone holding a presentation link. Each request for an uncached
thumbnail spawns `ffmpeg`. Path traversal is handled correctly and concurrency
is capped at 2, but `_thumbQueue` has no ceiling and requests have no timeout,
so sustained requests for distinct files grow the queue and the pending-socket
set until the Vite process degrades.

**Fix:** cap the queue (reject with 503 past ~200 pending) and reject requests
whose extension is not in the video/image allowlist before doing any
filesystem work. Estimated ~1 hour.

> Not load-tested. The failure mode is reasoned from the code, not measured —
> worth confirming before investing in a fix.

### F5 — `allowedHosts: true` disables Vite's DNS-rebinding protection

**Medium** · `revelation/vite.config.js`

Vite's host check exists to stop DNS rebinding. With it disabled, any website
the presenter visits can point a hostname it controls at `127.0.0.1` and make
the browser issue same-origin requests to the dev server. Those arrive from
`127.0.0.1`, so every loopback gate passes: `index.json` becomes enumerable,
`/admin` readable, and `/peer/status` readable. (`POST /peer/command`, which
this used to expose, no longer exists: commands go to the Vite process over
`parentPort`.)

The API server is `http.createServer` with no `Host` validation either, so it
is rebindable too — though it additionally requires the access key.

**Fix:** replace `allowedHosts: true` with an explicit list built from what the
app actually needs — `localhost`, `127.0.0.1`, the current LAN IP, and the
mDNS `.local` name. `serverManager` already tracks the LAN address and
restarts on change, so pass it through the child env alongside the other
`*_OVERRIDE` variables. Add a `Host` check to `apiServer` as well.
Estimated ~2 hours.

> Public relay mode already removes the server-side half of this concern for
> the one deployment that is meant to be exposed. F5 is the browser-side half,
> which relay mode does not address.

### F9 — Reveal Remote `/socket.io` accepts unauthenticated presenters

**Low** · `revelation/server/reveal-remote-broker.js`

No handshake auth and `cors: { origin: true }`. The channel ids are sound —
`remoteId` and `multiplexId` are UUIDv4, bound by a process-lifetime secret, so
a follower cannot forge a presenter session and a remote cannot reach the
multiplex channel. The residual issue is resource consumption: any client,
including a web page the presenter visits, can send `{type:'presenter'}`
repeatedly, allocating room state and generating two QR images each time.
State is freed on disconnect, so this is a live-connection cost rather than a
leak.

**Fix:** rate-limit `start` per socket and cap concurrent presenter sessions.
Do not set `cors: { origin: '*' }` here. Low priority.

---

## Deliberate non-goals

Recorded so they are not re-filed as bugs on a later pass.

### Publish/subscribe permission split on `/presenter-plugins-socket`

**Deferred, not planned.** Five plugins treat a shared room as a space where
every participant is a peer; holding the room id is the permission. That is
what makes collaborative navigation and the shared whiteboard work. Splitting
publish from subscribe would need a presenter-held token and read-only
viewers, and there is no concrete use case today for a participant who should
see the shared space but not act in it.

Revisit only if a mixed-permission deployment appears — for example a public
broadcast where the audience should watch but not draw. See the collaboration
carve-out in `revelation/doc/SECURITY.md`.

### F8 — hostname disclosure at `/peer/public-key`

**Withdrawn — not a defect.** The original finding claimed `os.hostname()` in
that payload was gratuitous fingerprinting. It overlooked that `/peer/*` is
gated on the same `mdnsPublish` flag that starts the mDNS announcement, whose
TXT record already broadcasts hostname, instance id, mode, version, pairing
port and key fingerprint to the whole subnet. The endpoint discloses close to a
subset of what is already public, and removing `hostname` would not even meet
the stated goal, since `instanceName` sits beside it and is usually more
identifying.

---

## Smaller items

* **`allowControlFromAnyClient` is not exposed in Settings.** An operator who
  wants the collaborative model *off* has to hand-edit `pluginConfigs`.
  Surfacing the toggle would make the sharing guidance actionable rather than
  advisory. Usability, not security.
* **`shareUrl` handling in Reveal Remote.** `initialData.shareUrl` is
  client-supplied, interpolated into `multiplexUrl`, and emitted to
  remote-control clients as `presentation_url`. No server-side risk; the open
  question is whether the reveal.js-remote UI navigates to it. Worth one pass
  through `node_modules/reveal.js-remote/server-ui`.
* **The `index.json` gate parses URLs differently from the handlers behind
  it.** `revelation/server/access-gates.js` uses `new URL(req.url, base)`, which
  reads a request target starting with `//` as a protocol-relative URL:
  `//index.json` has pathname `/` and is not blocked. Nothing is served at that
  path today, so this is not exploitable, and the unit test documents it. If a
  new route is ever mounted where such a path could resolve, parse `req.url`
  without `URL` (as Connect's `parseurl` does) in the gate.

---

## Testing

* The wrapper now has a CLI suite in `tests/` (`npm run tests`, see
  `tests/README.md`). `tests/helpers/electron-stub.js` lets modules that
  `require('electron')` load under plain Node, so function-body extraction is no
  longer needed for `serverManager.js` / `configManager.js`.
* The submodule's server is covered by unit tests of each `revelation/server/`
  module and by real-server tests (`revelation/tests/`, see its README).
  `createRevelationPlugin(options)` lets those tests run several servers in one
  process without touching `process.env`.
* Still untested: the pure port helpers (move into an electron-free
  `lib/portUtils.js`), the security findings above that were verified with
  throwaway harnesses, and anything needing a real window.
* A DOM is needed for the sanitizer and Settings-UI tests; the wrapper has no
  `jsdom` devDependency.
