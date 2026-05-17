# Video Stream Plugin — Implementation Notes

## Current Status: Rough Outline / Architecture

The `client.js` provides a **complete skeleton** for:
- Socket.io signaling via generic `presenter-plugin:event` messaging (no core changes needed!)
- WebRTC peer connection setup (offer/answer/ICE handshake)
- UI controls (start stream, source selection, stop stream)
- Configurable display modes (overlay, background, floating)

✅ **No server-side changes required.** The plugin reuses the existing generic `presenter-plugin:event` messaging system already implemented in the core and used by markerboard.

---

## How Signaling Works (No Core Changes Needed)

The plugin follows the **markerboard pattern**: all events are sent as generic `presenter-plugin:event` messages, which the core already relays to all peers in the room. No new socket handlers needed.

**Event flow:**
1. Client calls `this.emitPresenterPluginEvent('stream-started', { clientId, source })`
2. Core broadcasts this to all peers in the presentation's room
3. Other clients receive it via `socket.on('presenter-plugin:event', ...)`
4. Plugin filters by checking `event.plugin === 'videostream'` and `event.type`

**Example event structure:**
```javascript
{
  plugin: 'videostream',
  type: 'stream-started',  // or 'stream-stopped', 'offer', 'answer', 'ice-candidate'
  roomId: <remoteMultiplexId>,
  payload: {
    clientId: 'vs-abc123',
    source: 'webcam',
    // ... type-specific fields (offer, answer, candidate, etc)
  }
}
```

Core routes all `presenter-plugin:event` messages to peers in the same room. The plugin only listens for events with `event.plugin === 'videostream'` and ignores others.

**No socket handlers to add.** This is the beauty of the existing architecture!

---

## Client-Side Refinements Still Needed

### 1. **Error Handling & Reconnection**

Add robust error handling:
- Socket disconnect → close peer connections
- Peer connection failure → retry with different STUN servers
- Media device errors → show user-friendly error message

### 2. **Bitrate Constraints**

Wire the `maxStreamBitrate` config to WebRTC:

```javascript
// In createPeerConnection():
const bitrate = this.maxStreamBitrate * 1000; // Convert kbps to bps
const constraints = {
  video: {
    frameRate: { ideal: 30 },
    width: { ideal: 640 },
    height: { ideal: 480 }
  }
};
// Apply via RTCRtpSender.setParameters() after adding track
```

### 3. **Cleanup on Presentation Unload**

Add Reveal.js event handlers to clean up:

```javascript
bindDeck() {
  if (!Reveal) return;
  
  Reveal.on('slide-transition-end', () => {
    // Optional: pause stream on overview mode
  });
  
  window.addEventListener('beforeunload', () => {
    this.stopStreaming();
  });
}
```

### 4. **Handle ICE Candidate Routing**

Currently ICE candidates are broadcast to all peers. Since each peer is interested in candidates only from peers it has a connection to, this is safe (peers ignore unrelated candidates). However, we could optimize by storing sender IDs, but it's not necessary for correctness.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────┐
│         Browser (Peer A - Streamer)                 │
│  ┌───────────────────────────────────────────────┐  │
│  │ videostream plugin client.js                  │  │
│  │                                               │  │
│  │ MediaStream (webcam/screen)                   │  │
│  │  ↓                                             │  │
│  │ RTCPeerConnection (to Peer B)                 │  │
│  │  ↓  (RTP video/audio)                         │  │
│  │ emitPresenterPluginEvent('stream-started')    │  │
│  │  ↓                                             │  │
│  │ Socket.io ← (generic messaging)               │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
                      ↓↑
         Socket.io Namespace: /presenter-plugins-socket
         Generic presenter-plugin:event messaging
         (Core routes to peers in same remoteMultiplexId)
                      ↓↑
┌─────────────────────────────────────────────────────┐
│         Browser (Peer B - Viewer)                   │
│  ┌───────────────────────────────────────────────┐  │
│  │ videostream plugin client.js                  │  │
│  │                                               │  │
│  │ socket.on('presenter-plugin:event', ...)      │  │
│  │  ↓ (filter by plugin='videostream')           │  │
│  │ RTCPeerConnection (from Peer A)               │  │
│  │  ↓ (RTP video/audio)                          │  │
│  │ <video> element (overlay/background)          │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

---

## Next Steps to Get This Working

1. **[ ] Test socket connectivity** — verify two browsers can connect with shared `remoteMultiplexId`
2. **[ ] Test signaling flow** — verify `presenter-plugin:event` messages reach both peers
3. **[ ] Test WebRTC connection** — verify offer/answer/ICE handshake works
4. **[ ] Add bitrate constraints** to WebRTC encoder
5. **[ ] Implement cleanup** on disconnect and presentation unload
6. **[ ] Handle permission denied** errors gracefully
7. **[ ] Add audio/video permission UI** prompts
8. **[ ] User testing** with different media sources and display modes

---

## Known Limitations

- **Single stream:** By design; if you want multiple simultaneous streams later, you'd need:
  - A grid/PiP layout UI
  - Possible SFU (Selective Forwarding Unit) for efficiency
- **No audio level meters:** Would require Web Audio API
- **No stream recording:** Out of scope; could add later via MediaRecorder API
- **Limited STUN servers:** Only Google's; could add more for robustness
- **LAN only:** Works on LAN; WAN requires TURN server (not included)
- **No bandwidth detection:** Stream bitrate is static; could adapt dynamically

---

## References

- [WebRTC API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API)
- [Socket.io Rooms](https://socket.io/docs/v4/rooms-and-namespaces/)
- [RTCPeerConnection (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection)
- Markerboard plugin source (`plugins/markerboard/client/socketMethods.js`) — reference implementation
