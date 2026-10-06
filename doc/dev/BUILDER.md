# Builder Architecture

This document covers non-obvious internal mechanics of the builder (`http_admin/builder/`).

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

**Re-link:** If `state.dirty`, the builder calls `_peerSaveFn()` (= `savePresentation()`) first and waits 1 s so the server has the updated file before peers receive a slide-change. Then `peerLinked = true` → `resumeRevealRemote` → `setMultiplexPaused(false)` + `sendCurrentState()`.

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
