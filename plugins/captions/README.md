# Live Captions Plugin

This plugin launches a local speech-to-text command, shows the transcript as an on-slide caption overlay, and mirrors the caption text to other slideshow clients through the existing presenter plugin socket.

## Settings

- `command`: Full command used to start captioning, for example `/home/user/programs/whisper.cpp/build/bin/whisper-stream`
- `workingDirectory`: Optional working directory for the command
- `inputDevice`: Optional capture device number; when set, the plugin appends `-c <number>`
- `autoStart`: Start automatically when an Electron presentation window opens
- `captionHoldMs`: Time before captions clear after silence
- `maxLines`: Number of caption lines kept visible

## Notes

- The main Electron presentation window is the caption source. Follower/browser clients receive caption text over the presenter plugin socket.
- `whisper-stream` writes terminal control characters while updating the current line. The plugin strips those sequences before rendering captions.
- If no `remoteMultiplexId` or stored `multiplexId` is available, captions still appear locally but are not mirrored to peers.
