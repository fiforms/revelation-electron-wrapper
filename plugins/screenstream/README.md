# Screen Stream Plugin

Captures one screen and sends it with ffmpeg over [RIST](https://www.rist.tv/) (Reliable Internet Stream Transport) to an IP address and port. Use it to feed a live screen to a video switcher, a streaming PC, or any RIST receiver (OBS, vMix, `ffplay`, `ffmpeg`).

## Usage

1. Enable **Screen Stream** under Settings → Plugins, then set the options below and relaunch if asked.
2. Open **Plugins → Stream Screen (RIST)…** (or the **Plugins** sidebar entry).
3. Pick the screen, then **Start Streaming**. **Stop Streaming** ends it. Quitting the app also stops it.

To test, run a receiver on the destination machine, for example `ffplay "rist://@0.0.0.0:5000"`.

## Sound

By default the stream is silent. To add sound, pick a source in the window's **Audio** list before starting. It works with both **Start Streaming (RIST)** and **Stream Screen to Peers**. Sound is encoded to AAC (128 kbit/s by default); video is untouched, so Wayland passthrough still copies the H.264 without re-encoding.

| Platform | What the list offers |
|---|---|
| Linux (PulseAudio or PipeWire) | **System sound (default output)**, which is what the speakers play, plus every other source. |
| Windows | The sound inputs DirectShow lists. Windows has no desktop-sound input by default: enable **Stereo Mix** in the sound settings, or install a virtual audio capturer, and it will appear. Device names containing `:` or `=` are not offered. |
| macOS | The audio devices avfoundation lists. macOS cannot capture desktop sound by itself: install a virtual device such as BlackHole, send the system output to it, and pick it. |

Notes:
- Peer mode: followers play the sound in their player window. The sender tells followers whether sound is included, so a silent stream behaves as before.
- **Lip-sync on Wayland.** There the screen video comes from the browser and the sound from ffmpeg, as two separate captures, so they cannot be locked together exactly. The plugin starts ffmpeg only when the first video arrives, which makes the offset small and repeatable. In tests with simulated video it was within about 200 ms, with sound slightly early. Use the **Audio delay (ms)** field that appears in the window when a sound source is chosen (it starts from the `audioOffsetMs` setting and is remembered): if you hear things before you see them, raise it; if after, lower it, going in steps of about 100 and restarting the stream each time. Screens captured by ffmpeg directly, and macOS, are captured together and need no adjustment (macOS also ignores `audioOffsetMs`).
- **Black screen on a receiver once sound is on.** A receiver cannot show video until it has seen a keyframe and read the video parameters. If the keyframe interval is longer than the receiver's analysis time, a receiver that does not require the video track can end up with sound only. Keep `browserGopSeconds` short, and raise `peerProbeMs` above the real keyframe interval if it still happens. Receivers should map the video as mandatory (see PEERING.md, "Video is mandatory").
- Electron can capture Windows desktop sound itself, but this plugin does not use that yet.

## Stream Screen to Peers

The second button, **Stream Screen to Peers**, sends the screen to every paired REVELation follower on the local network instead of to a fixed address. It needs no destination.

1. On the sending computer, enable network mode and publish this instance (Settings), and pair the followers as usual (see [PEERING.md](../../doc/dev/PEERING.md)).
2. On every follower, enable the **Screen Stream** plugin.
3. Click **Stream Screen to Peers**. The sender listens for RIST connections and sends one `rist-screen` command over the peer channel. Each follower opens a fullscreen player window (on its usual presentation display) and plays the stream. **Stop Streaming** sends a stop that closes the player on every follower, whichever master started its stream. Closing the player window on a follower ends the stream there.

Notes:
- Each follower runs its own ffmpeg to receive the stream and does **not** re-encode it. Sender and followers both need an ffmpeg with librist. Only H.264 is supported.
- The command is sent once, like pushing a presentation: a follower that connects or restarts mid-stream joins at the next start. If the sender quits without stopping, followers keep their player window (retrying) until it is closed.
- The sender must allow inbound UDP on `peerPort` and the next port through its firewall.
- A new stream is encrypted with a random passphrase (AES-128 by default) that is sent to followers over the peer channel. That channel is not encrypted unless HTTPS is on, so this stops casual capture of the video, not an attacker who can also read the peer traffic.
- **Delay before a follower shows a picture.** A follower needs a keyframe before it can show anything, and ffmpeg analyzes the stream for a set time first. Streams ffmpeg encodes (every platform except Wayland passthrough) use a 2-second keyframe interval and a 3-second analysis window, so a picture appears in about 3 seconds. On Wayland passthrough Chromium chooses the keyframe interval, so `peerProbeMs` (default 8000) must be longer than it: too low and followers show nothing. Once it shows, the delay is typically well under a second.
- A follower ignores the stream if it has turned off "open the presentation window when a peer pushes a presentation", and does not play streams while it is capturing itself.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `host` | _(empty)_ | Destination IP address or host name (IPv4, IPv6 or name). |
| `port` | 5000 | Destination RIST port. RIST also uses the next port for retransmission requests; use an even number for the Simple profile. |
| `captureMethod` | `auto` | `auto`, `ffmpeg` or `browser` (see below). |
| `fps` | 30 | Frames per second. |
| `bitrateKbps` | 6000 | Default video bitrate. The window has a **Video bitrate (kbit/s)** field, filled from this and remembered between runs, for changing it per stream; it applies to both buttons and takes effect on the next start. On Wayland passthrough it is the recorder's ceiling, so a still screen uses less. |
| `scaleHeight` | 0 | Scale to this height in pixels; 0 keeps the screen's size. |
| `latencyMs` | 1000 | RIST retransmission buffer; match the receiver's setting. 0 uses ffmpeg's default. |
| `videoEncoder` | `libx264` | Any H.264 encoder in your ffmpeg (`h264_nvenc`, `h264_qsv`, `h264_videotoolbox`…). |
| `captureCursor` | on | Include the mouse pointer. |
| `encryption` | `none` | RIST encryption: `none`, `128` or `256` (AES, bits). The receiver must use the same type and passphrase. |
| `secret` | _(empty)_ | The encryption passphrase. Required when encryption is on. |
| `peerPort` | 5100 | Stream to Peers: the port the sender listens on. |
| `peerEncryption` | `128` | Stream to Peers: `none`, `128` or `256`. A random passphrase is made for each stream. |
| `peerProbeMs` | 8000 | Stream to Peers, Wayland passthrough only: how long followers analyze the stream. Must exceed the keyframe interval. |
| `audioBitrateKbps` | 128 | AAC bitrate when a sound source is chosen. |
| `audioOffsetMs` | 0 | Default lip-sync offset: delays the sound by this many milliseconds (negative makes it earlier). The window has its own **Audio delay (ms)** field, filled from this, for changing it per stream. |
| `browserGopSeconds` | 2 | Wayland passthrough: asks the screen recorder for a keyframe at least this often, in seconds (0 leaves it to Chromium, which can choose 10 s or more). Receivers show nothing until a keyframe arrives, so short is better for pickup. |
| `browserPassthrough` | on | Wayland only: the screen recorder produces H.264 at `bitrateKbps` and ffmpeg sends it unchanged (less CPU and delay). `fps`, `scaleHeight` and `videoEncoder` do not apply then. Off re-encodes with ffmpeg. If H.264 recording is unavailable it falls back to re-encoding. |

The stream is H.264 in MPEG-TS (plus AAC sound if you choose an audio source), encrypted only if you turn on `encryption` (RIST AES with a shared passphrase; this protects the stream, it does not authenticate the receiver). The passphrase is passed to ffmpeg as a command-line option, so other users on the same computer can see it in the process list while streaming. With encryption off, send only across networks you trust. A sink URL such as `rist://host:5000?secret=pw&aes-type=128&buffer=300` corresponds to `host`, `port`, `secret` = pw, `encryption` = 128 and `latencyMs` = 300.

## How it captures

| Platform | `auto` uses | Notes |
|---|---|---|
| Windows | ffmpeg `gdigrab` | Captures the selected screen's rectangle. |
| macOS | ffmpeg `avfoundation` | Needs Screen Recording permission for the app (System Settings → Privacy & Security). The screen list is matched to avfoundation's "Capture screen N" devices in order, primary display first. |
| Linux, X11 | ffmpeg `x11grab` | Captures the selected screen's rectangle. |
| Linux, Wayland | the system screen-share prompt | ffmpeg has no unprivileged Wayland grabber. The app captures through the desktop portal (PipeWire) and pipes it to ffmpeg. By default the recorder produces H.264 and ffmpeg sends it unchanged (see `browserPassthrough`); otherwise ffmpeg re-encodes. The portal's own picker chooses the screen, and re-encoding (passthrough off) adds latency. |

## Requirements

- ffmpeg is found the usual way (Settings → ffmpeg path, the bundled copy, or `PATH`).
- That ffmpeg build must include **librist**. The window shows a warning if it does not. Many distribution builds do; check with `ffmpeg -protocols | grep rist`.

## Files

- `plugin.js`: the ffmpeg process, capability probe, control window, and the sender and follower halves of the `rist-screen` peer command.
- `streamCommand.js`: builds the ffmpeg command line (pure, covered by `tests/screenstream.test.js`).
- `peerStream.js`, `fmp4.js`, `peerReceiver.js`, `player.html`, `player.js`: Stream to Peers (the `rist-screen` command, the fragmented-MP4 parser, the follower's receiver, and its MSE player). Covered by `tests/screenstreamPeers.test.js`.
- `screenstream.html`, `screenstream.js`: the control window (also does the capture on Wayland).
