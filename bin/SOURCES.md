# Bundled binaries

Downloaded by `npm install` (or `npm run fetch-blobs`) into this folder; none are committed.

## effectgenerator

Find the latest version at https://github.com/fiforms/effectgenerator

## ffmpeg (macOS and Windows only)

`bin/ffmpeg/` is fetched by `scripts/fetch-ffmpeg.js` for macOS and Windows. On Linux the app uses the system `ffmpeg`.
The downloaded `versions.txt` beside the binary records the exact build.

- **macOS (arm64, x64):** static builds from https://www.martin-riedl.de, configured with `--enable-gpl --enable-version3`.
- **Windows (x64):** the "essentials" build from https://www.gyan.dev/ffmpeg/builds/, also GPL.

These builds are licensed **GPL v3** (not the LGPL), so an installer that ships them is distributed under GPL terms for
that component. FFmpeg's source is at https://ffmpeg.org/download.html; the build providers above publish the matching
configuration and source. The app runs ffmpeg as a separate process and does not link it.
