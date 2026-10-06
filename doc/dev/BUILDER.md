# Builder Architecture

This document covers non-obvious internal mechanics of the builder (`http_admin/builder/`).

- **Module map:** see [ARCHITECTURE.md](ARCHITECTURE.md) (the builder section lists every module by concern).
- **Plugin extension API** (`RevelationBuilderHost`, `getBuilderExtensions`): see [BUILDER_EXTENSIONS.md](BUILDER_EXTENSIONS.md).

---

## Builder ↔ Peer Slide Syncing

### Overview

The builder page itself never calls RevealRemote. RevealRemote lives entirely **inside the preview iframe**, which is a real Reveal.js presentation. The builder communicates with the iframe exclusively via a `postMessage` bridge (`revelation-builder-preview-bridge`). When the builder wants to pause or resume multiplex broadcasting, it sends a command string; the iframe obeys.

Peers receive slide-state updates via the Socket.io broker embedded in the Vite server — they have no direct connection to the builder.

```
Builder (outer page)
  │  postMessage commands:
  │  pauseRevealRemote / resumeRevealRemote
  ▼
Preview iframe  ──RevealRemote plugin──▶  Socket.io broker (Vite server)
                                                │
                                       peer windows (followers)
```

---

### Key state variables (`preview.js`)

| Variable | Meaning |
|---|---|
| `previewPeerModeEnabled` | iframe has been reloaded with `builderPreviewPeer=1`; RevealRemote is active |
| `peerPushActive` | peers have been opened and are following this session |
| `peerLinked` | multiplex broadcasting is currently live (not paused) |
| `peerPushResolve` | one-shot callback used to receive the `multiplexId` from the iframe |
| `resetPeerPushState()` | exported function that clears `peerPushActive`, `peerLinked` and `peerPushResolve`, and, if peer mode was on, rebuilds the preview URL without `builderPreviewPeer` so RevealRemote disconnects |
| `_peerSaveFn` | reference to `savePresentation()`, injected by `events.js` via `setPeerSaveFn()` |

---

### Timeline: "Push to Peers" button clicked

**1. Builder reloads the iframe with peer mode enabled**

`pushToPeers()` saves current content to the temp file, then rebuilds the iframe `src` URL with `builderPreviewPeer=1` added. This causes Reveal.js to reinitialise inside the iframe.

**2. Inside the iframe (`presentations.js`)**

- `builderPreviewPeerEnabled = true` (read from the URL param)
- `enableRevealRemote` becomes `true` → RevealRemote plugin is added to Reveal
- On `deck.on('ready')`: multiplex is **immediately pre-paused** (`setMultiplexPaused(true)`) to suppress the initial sync burst before the builder is ready
- 300 ms later, `pollForMultiplexId()` begins polling `remote.getMultiplexId()` (or localStorage as a fallback) waiting for RevealRemote to receive a `multiplexId` from the broker

**3. `multiplexId` obtained — iframe notifies the builder**

Once the broker assigns a multiplexId, the iframe posts `{ event: 'revealRemoteReady', payload: { multiplexId } }` to the parent via `postMessage`.

**4. Builder resolves its promise**

`peerPushResolve(multiplexId)` resolves the `waitForMultiplexId()` promise. The builder now holds the multiplexId.

**5. Peer URL constructed and pushed**

`getBuilderPresentationUrl(multiplexId)` appends `remoteMultiplexId=<id>` to the normal presentation URL. That URL is sent to peer displays via `electronAPI.sendPeerCommand({ type: 'open-presentation', ... })`.

Peers load the presentation with `remoteMultiplexId` in their URL, which puts them in RevealRemote **follower mode** — they subscribe to slide-state events from the broker rather than broadcasting.

**6. Builder activates the link**

`peerPushActive = true`, `peerLinked = true`, then `resumeRevealRemote` is sent to the iframe → `setMultiplexPaused(false)` + `sendCurrentState()`. Peers immediately receive the current slide.

---

### The Link / Unlink toggle

The link button pauses or resumes broadcasting without disconnecting peers.

**Unlink:** `peerLinked = false` → `pauseRevealRemote` → iframe calls `setMultiplexPaused(true)`. Peers freeze on the last slide.

**Re-link:** If `state.dirty`, the builder calls `_peerSaveFn()` (= `savePresentation()`) first and waits 1–5.2 s (see "Peer repaint after edits") so the server has the updated file before peers receive a slide-change. Then `peerLinked = true` → `resumeRevealRemote` → `setMultiplexPaused(false)` + `sendCurrentState()`.

---

### `resetPeerPushState()`

Called by `unpushPeers()` after it sends `close-presentation`, and by the **Re-parse** button in `events.js`
(re-parsing replaces the document, so any earlier push is stale). It only resets the builder's own state; it does not
tell peers anything, so send `close-presentation` first if peers should close.

---

### Peer repaint after edits

Deliberate design for live events: edits made in the builder must not disrupt the big screen mid-show. In `setHotReloading()` (`revelation/js/presentations.js`) a peer (follower) that receives a Vite `reload-presentations` event does **not** reload; it marks the reload pending and waits for the next navigation message from the presenter (`RevealRemote.onBeforeSync`), then fades and reloads. A slide change on the peer also triggers the pending reload.

- **Force a refresh:** toggle Link off and on. Re-linking sends `sendCurrentState()`, which counts as a navigation message and triggers the pending reload. The linked-state tooltip says so ("Toggle again for peer reload").
- **Media blocks it:** while any `<audio>` is playing (or a foreground video on the current slide), the reload stays pending and the toggle has no effect. It runs on the next navigation after the media has stopped; media ending on its own does not trigger it.
- **3-second guard:** a navigation within 3 s of the HMR event is ignored by `onBeforeSync` (treated as the same event).
- **Re-link while dirty:** the builder remembers where peers were last sent (`peerLastSentIndices`, recorded on push and when the link breaks), saves, then waits before resuming. The server watcher debounces ~1.2 s (`presentation-watcher.js`), so peers get the HMR event at ≈1.3–2 s.
  - *Same slide as peers* → waits `PEER_RELINK_SAME_SLIDE_MS` (1 s): the re-link normally arrives before the HMR event, so nothing is pending and nothing reloads (if the HMR does land first, the peer's 3 s guard ignores the re-link).
  - *Different slide* → waits `PEER_RELINK_NEW_SLIDE_MS` (5.2 s): the re-link lands after the guard, so `onBeforeSync` fades to black, drops the navigation and reloads onto the fresh current slide (no visible jump to the new slide on stale content).
  - Waiting less than the watcher debounce makes the re-link arrive *before* the HMR, leaving the reload pending.
- **Toggle right after a manual save:** if the builder is already clean (e.g. Ctrl+S earlier) there is no wait, so a re-link more than 3 s after the save forces a reload even on the same slide.

---

### Unpush

The ⏏️ button (shown next to the link button while `peerPushActive`) calls `unpushPeers()`: it sends `close-presentation` to the peers (same handler as the main UI's close) and then `resetPeerPushState()`, which reloads the preview iframe without `builderPreviewPeer` so RevealRemote disconnects.

---

### Auto-unlink on edit

`initPeerPushButtons()` registers `addDirtyListener(() => unlinkPeers())`. Any edit that calls `markDirty()` automatically breaks the link, preventing mid-edit slide changes from broadcasting to peers. Re-linking is manual (and triggers a save if needed, as above).

---

### Iframe reload recovery

If the preview iframe reloads (e.g. after a preview refresh), RevealRemote reinitialises and multiplex starts paused again. The builder handles this in `bindPreviewBridgeListener`: when the iframe fires a `ready` event and `peerPushActive` is true, the builder immediately re-sends either `resumeRevealRemote` or `pauseRevealRemote` to restore the correct link state. The builder is the authority on link state; the iframe is stateless with respect to it.

---

### How `multiplexId` is created

The multiplexId is assigned by the **RevealRemote Socket.io broker** embedded in the Vite server (`createRevealRemoteBroker()` in `revelation/server/reveal-remote-broker.js`). The iframe's RevealRemote plugin connects as the presenter, and the broker returns a session multiplexId. The builder never touches the broker directly — it just polls the iframe until the ID appears, then uses it to build the follower URL.

See also: `lib/serverManager.js` → `writeRevealRemoteJSFile()` for how `reveal-remote.js` is generated at startup to point the in-app presentation at the correct broker URL.
