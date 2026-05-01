# Media Share Plugin

Lets the master machine push a local media file — video, audio, or image — directly to all paired peer screens, without first creating a presentation or importing the file into the media library.

## Purpose

The normal workflow for showing media to peers requires creating a presentation, importing the file, and opening it. Media Share is a shortcut for the common case where you just want to get something on the peer screens _right now_: pick a file, and it appears.

**Supported media:**

| Type | Extensions |
|---|---|
| Video | `.mp4` `.webm` `.mov` `.m4v` `.ogv` `.mkv` |
| Audio | `.mp3` `.ogg` `.wav` `.m4a` `.aac` `.opus` |
| Image | `.jpg` `.png` `.webp` `.gif` `.avif` `.svg` |

## Usage

1. Switch to **LAN (network) mode** in Settings — peers on other devices need to be able to reach the master's Vite server.
2. Open **Presentation → Share Media to Peers…** from the menu bar.
3. Click **Share a Media File…** and pick a file from anywhere on the local filesystem.
4. The file is immediately served to peers. The management panel shows all active shares.
5. Click **Stop** on an individual share (or **Stop All Shares**) when done. Token access is revoked instantly and peer screens receive a close command.

The file is never copied or moved. It is served in place from its original location for the duration of the share.

## How the token system works

A naive approach to serving an arbitrary local file over the network — such as adding a static directory or passing the path as a URL parameter — creates a path-traversal risk: a malicious or compromised peer could walk the filesystem. The token system avoids this entirely.

### Components

**`dynamicMediaFiles` Map** (`revelation/vite.plugins.js`)

A module-level `Map<token, { absolutePath, mimeType }>` lives inside the Vite utility process. It is the sole source of truth for which files are currently shareable. The real file path is never transmitted to any client; only the opaque token leaves the server.

**`parentPort` message listener** (`revelation/vite.plugins.js`)

Because Vite runs in an Electron `utilityProcess.fork()`, it is isolated from the main process. The two sides communicate via Electron's built-in utility-process IPC channel. The Vite process listens for two message types:

- `register-media-token` — adds `{ absolutePath, mimeType }` to the Map under the given token.
- `revoke-media-token` — removes the entry, making the URL return 404 immediately.

**`registerMediaToken` / `revokeMediaToken`** (`lib/serverManager.js`)

Wrapper methods on the `serverManager` object. They generate the token and call `viteProc.postMessage()` to relay the instruction across the process boundary. Token generation uses `crypto.randomBytes(24).toString('hex')`, producing a 192-bit random 48-character hex string — astronomically unlikely to be guessed.

**`/media-share/<token>` middleware** (`revelation/vite.plugins.js`)

Registered early in Vite's Connect middleware stack, before any static file serving. For every incoming request:

1. The URL must begin with the `/media-share/` prefix; all others fall through to the next middleware.
2. The extracted token is validated against the regex `/^[a-f0-9]{48}$/`. Anything that does not match (wrong length, wrong characters, path separators, encoded sequences) returns 404 immediately — no Map lookup, no filesystem access.
3. The token is looked up in `dynamicMediaFiles`. If absent, 404.
4. The file is stat'd. If it has disappeared since registration, 404.
5. The file is streamed with full HTTP `Range` support, so video players can seek without downloading the entire file first.

### Security properties

| Threat | Mitigation |
|---|---|
| Path traversal | The URL never contains a path. The file path is stored server-side only, keyed by the opaque token. |
| Token guessing | 192-bit random token — brute-force is not feasible. |
| Symlink escape | `fs.realpathSync()` is called at registration time. The resolved real path is what gets stored, so symlinks cannot be used to bypass access. |
| Stale access after stop | `revokeMediaToken()` removes the Map entry. The next request for that URL returns 404 before any filesystem I/O is attempted. |
| Unintended exposure via LAN | The token URL is only served when Vite is already running in `--host` (network) mode, which the user has explicitly enabled. No new network surface is opened. |
| Presentation index visibility | Temp presentations use `alternatives: hidden` in their YAML front matter so they are filtered from the library UI. |

### Lifecycle

```
User picks file
  → plugin.js: fs.realpathSync() validates the path
  → serverManager.registerMediaToken() generates token, postMessages to Vite
  → Vite process: token added to dynamicMediaFiles Map
  → plugin.js: temp presentation written to presentationsDir/_mediashare_<id>/
  → plugin.js: sendPeerCommand({ type: 'open-presentation', url }) dispatched to peers
  → Peer screens: load the temp presentation, which references /media-share/<token>
  → Vite middleware: validates token, streams file with Range support

User clicks Stop (or app quits)
  → serverManager.revokeMediaToken() postMessages revocation to Vite
  → Vite process: token removed from Map — URL returns 404 immediately
  → plugin.js: temp presentation directory deleted from disk
  → sendPeerCommand({ type: 'close-presentation' }) dispatched to peers
```
