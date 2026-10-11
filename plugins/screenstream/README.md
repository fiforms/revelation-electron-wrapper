# Screen Stream Plugin

Captures one screen and sends it with ffmpeg over [RIST](https://www.rist.tv/) (Reliable Internet Stream Transport) to an IP address and port. Use it to feed a live screen to a video switcher, a streaming PC, or any RIST receiver (OBS, vMix, `ffplay`, `ffmpeg`).

## Usage

1. Enable **Screen Stream** under Settings → Plugins, then set the options below and relaunch if asked.
2. Open **Plugins → Stream Screen (RIST)…** (or the **Plugins** sidebar entry).
3. Pick the screen, then **Start Streaming**. **Stop Streaming** ends it. Quitting the app also stops it.

To test, run a receiver on the destination machine, for example `ffplay "rist://@0.0.0.0:5000"`.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `host` | _(empty)_ | Destination IP address or host name (IPv4, IPv6 or name). |
| `port` | 5000 | Destination RIST port. RIST also uses the next port for retransmission requests; use an even number for the Simple profile. |
| `captureMethod` | `auto` | `auto`, `ffmpeg` or `browser` (see below). |
| `fps` | 30 | Frames per second. |
| `bitrateKbps` | 6000 | Video bitrate. |
| `scaleHeight` | 0 | Scale to this height in pixels; 0 keeps the screen's size. |
| `latencyMs` | 1000 | RIST retransmission buffer; match the receiver's setting. 0 uses ffmpeg's default. |
| `videoEncoder` | `libx264` | Any H.264 encoder in your ffmpeg (`h264_nvenc`, `h264_qsv`, `h264_videotoolbox`…). |
| `captureCursor` | on | Include the mouse pointer. |
| `encryption` | `none` | RIST encryption: `none`, `128` or `256` (AES, bits). The receiver must use the same type and passphrase. |
| `secret` | _(empty)_ | The encryption passphrase. Required when encryption is on. |
| `browserPassthrough` | on | Wayland only: the screen recorder produces H.264 at `bitrateKbps` and ffmpeg sends it unchanged (less CPU and delay). `fps`, `scaleHeight` and `videoEncoder` do not apply then. Off re-encodes with ffmpeg. If H.264 recording is unavailable it falls back to re-encoding. |

The stream is H.264 in MPEG-TS, video only, encrypted only if you turn on `encryption` (RIST AES with a shared passphrase; this protects the stream, it does not authenticate the receiver). The passphrase is passed to ffmpeg as a command-line option, so other users on the same computer can see it in the process list while streaming. With encryption off, send only across networks you trust. A sink URL such as `rist://host:5000?secret=pw&aes-type=128&buffer=300` corresponds to `host`, `port`, `secret` = pw, `encryption` = 128 and `latencyMs` = 300.

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

- `plugin.js`: the ffmpeg process, capability probe and window.
- `streamCommand.js`: builds the ffmpeg command line (pure, covered by `tests/screenstream.test.js`).
- `screenstream.html`, `screenstream.js`: the control window (also does the capture on Wayland).
