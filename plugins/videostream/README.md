# Video Stream Plugin

Stream live video (webcam or screen share) to other participants in a shared presentation.

## Overview

The Video Stream plugin enables peer-to-peer video sharing within a presentation that has a shared `remoteMultiplexId`. Any participant can start streaming their webcam or screen, and the video will appear on all other participants' presentations in a configurable location (overlay, background, or floating).

**Key Design Decisions:**
- **Single Active Stream:** Only one peer can stream at a time (simplest approach for LAN)
- **Full-Mesh WebRTC:** Each streamer connects directly to each viewer (ideal for small groups on LAN)
- **Signaling via Socket.io:** Uses the existing `/presenter-plugins-socket` namespace for WebRTC handshakes
- **User-Selectable Source:** Viewers can choose webcam or screen share when starting
- **Configurable Display:** Overlay (corner), background (behind slides), or floating window

## Architecture

```
videostream/
├── plugin.js              # Plugin metadata and config schema
├── client.js              # Browser-side implementation (all-in-one for now)
├── offline.js             # Export handler (for offline presentations)
└── README.md
```

### How It Works

1. **Starting a Stream:**
   - Click the "📹 Stream" button in the top-left controls
   - Select webcam or screen share
   - Browser requests access to media device
   - Peer announces `videostream:stream-started` to all others via socket

2. **Receiving a Stream:**
   - Other peers are notified of the incoming stream
   - They request a WebRTC offer from the streamer
   - Full-mesh peer connections are established (streamer → each viewer)
   - Remote video appears in the configured location

3. **Stopping:**
   - Click "⏹ Stop" button
   - Local tracks are closed, peer connections cleaned up
   - Peers are notified and clean up their side

### Configuration

Plugin settings (in `config.json` or settings UI):

### Display Settings

| Option | Values | Default | Purpose |
|--------|--------|---------|---------|
| `displayMode` | `overlay`, `background`, `floating` | `overlay` | Where video appears on slides |
| `overlayPosition` | `top-left`, `top-right`, `bottom-left`, `bottom-right` | `top-right` | Overlay corner position |
| `overlayOpacity` | 0–100 | 85 | Overlay transparency (%) |

### Video Capture Settings

| Option | Values | Default | Purpose |
|--------|--------|---------|---------|
| `videoWidth` | 320–1920 pixels | 640 | Preferred video width (adapts to device capability) |
| `videoHeight` | 240–1080 pixels | 480 | Preferred video height (adapts to device capability) |
| `videoFramerate` | 5–60 fps | 24 | Target frames per second (lower = less bandwidth) |

### Bitrate & Quality Settings

| Option | Values | Default | Purpose |
|--------|--------|---------|---------|
| `maxVideoBitrate` | 300–10000 kbps | 2500 | Max video bitrate (controls quality/smoothness tradeoff) |
| `maxAudioBitrate` | 16–256 kbps | 64 | Max audio bitrate |
| `degradationPreference` | `maintain-framerate`, `maintain-resolution`, `balanced` | `maintain-framerate` | What to sacrifice when bandwidth is limited |

### Tuning Tips

**For LAN (fast, local network):**
- `videoWidth`: 1280, `videoHeight`: 720, `videoFramerate`: 30
- `maxVideoBitrate`: 3500–5000 kbps
- `degradationPreference`: `maintain-framerate` (smooth video matters more than resolution)

**For lower bandwidth / WiFi:**
- `videoWidth`: 640, `videoHeight`: 480, `videoFramerate`: 15–20
- `maxVideoBitrate`: 1500–2500 kbps
- `degradationPreference`: `maintain-resolution` (sharper video matters more than smoothness)

**For screen share (text needs clarity):**
- `videoWidth`: 1280, `videoHeight`: 720, `videoFramerate`: 15
- `maxVideoBitrate`: 2000–3000 kbps
- `degradationPreference`: `maintain-resolution`

## Limitations & TODOs

### Current Implementation (v0.1.0 - Rough Outline)
- ✅ Socket.io signaling scaffolding
- ✅ WebRTC peer connection setup
- ✅ UI for start/stop controls and source selection
- ✅ Configurable display modes and positions
- ⚠️ **Not yet implemented:**
  - **Server-side signaling:** No actual socket event handlers in the Node backend
  - **Offer/Answer flow:** Handshake logic is sketched but untested
  - **ICE candidate handling:** Needs robust error handling
  - **Bitrate constraints:** `maxStreamBitrate` config not wired to encoder
  - **Floating window drag:** Can be added if needed
  - **Multiple simultaneous streams:** Currently supports only one (by design)
  - **Fallback STUN servers:** Only uses Google's; may add more
  - **Audio level indicators:** Would be nice for debugging
  - **Stream recording:** Out of scope for v0.1

### Testing Needed
- Browser media permissions flow (different per OS)
- WebRTC connection establishment on LAN
- Socket.io reconnection & room cleanup
- Cleanup when presentation window closes
- Performance with bitrate constraints

## Server-Side Implementation

The plugin **signals only** — it doesn't require any server-side code beyond what already exists:
- `/presenter-plugins-socket` namespace is already listening
- The plugin just needs to emit/listen to custom events on that socket
- No state management needed (stateless relay)

If you want to add server-side logging or relay validation, modify `revelation/vite.plugins.js` to handle the new event types.

## Usage

1. **Create a shared presentation** with a peer using a `remoteMultiplexId`
2. **Right-click on a slide** → You'll see:
   - 📷 **Start Stream (Webcam)**
   - 🖥️ **Start Stream (Screen)**
3. **Click your choice** → browser requests permission for webcam/screen access
4. **Video starts** and appears on both presentations:
   - Your preview (usually just seeing yourself)
   - Your peer's presentation (in their configured location: overlay, background, or floating)
5. **A pulsing red indicator** ("● Streaming") appears in the top-right corner
6. **Right-click again** → Select "⏹️ Stop Stream" to end the broadcast
7. Both sides clean up connections and are ready for the next stream

**Tip:** You can continue presenting and interacting with slides while streaming. Your peer sees the video in their configured display location and can work with slides normally.

## Future Enhancements

- **Bitrate adaptation:** Monitor connection quality and adjust encoding
- **Multi-stream grid:** Support simultaneous streams (requires SFU or more complex UI)
- **Stream stats:** Show bandwidth, packet loss, latency (WebRTC stats API)
- **Recording:** Save incoming streams to disk
- **Remote control of stream:** Requester can pause/hide/switch streams
