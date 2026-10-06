# Settings Guide

This guide explains the Settings screen in plain language:

- what each option changes in real use
- when you might want to change it
- what to expect after you apply your changes

For a broader tour of the app, see [doc/GUI_REFERENCE.md](GUI_REFERENCE.md).

## Before you change settings

- The Settings window has seven tabs: **Screens**, **Networking**, **Folders & Paths**, **PIP**, **Hotkeys**, **Plugins** and **Peer Pairing**.
- The **Apply and Relaunch** button at the top right stays disabled until you change something. Clicking it saves every tab and restarts the app so all changes take effect.
- The ❔ button opens this guide inside the app. **Info ⓘ** shows version information.

## Quick recommendations for most people

- Keep **Networking** on `localhost` unless you need other devices to connect.
- Set **Preferred Display** first if you use two screens.
- Leave server ports at their defaults unless you have a conflict.
- Only set a custom **FFMPEG** path if media features are not working.

## Screens

### Preferred Display

- Chooses which monitor the presentation opens on.

### Window Zoom Factor

- Scales the interface of all app windows (`1.00` = 100%, `1.25` = 125%). Range 0.5 to 3.

### Wayland, GNOME and KDE helpers

On Linux the Screens tab shows a banner describing how presentation windows are placed on the chosen display:

- **Wayland detected, mode is X11**: the app is running under XWayland, and display selection works normally.
- **Wayland detected** (warning): the compositor will not let the app place windows. Restart the app with `--ozone-platform=x11`, or use one of the helpers below.
- **GNOME Window Helper**: on GNOME, a small shell extension can place windows on the chosen display without X11. The panel shows the installed and running versions, with **Install GNOME Window Helper** and **Remove GNOME Window Helper** buttons. Installing it also turns on GNOME's "Use Extensions" setting.
- **KDE Plasma**: when Plasma is detected, windows are placed on the chosen display through a KWin script. There is nothing to install.

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for Wayland and X11 problems.

### Language

- Changes the app interface language (English or Español).
- The app restarts when you apply it, so the language is used everywhere.

### Preferred Presentation Language

- A two-letter code (for example `en` or `es`) that sets the default language version of presentations.
- Leave it blank to follow the app language. You only need it if you present in a language other than the interface language, for example when this instance presents a translated version of your decks. You can also leave it blank and configure virtual screens in other languages.

### Screen Type Variant

- Sets the default presentation style: Normal, Lower Thirds, Confidence Monitor, Notes (Split View), Notes (Slide Preview) or Notes (Teleprompter).
- If you are unsure, keep `Normal`.

### CCLI License Number

Configured on the **Plugins** tab under `credit_ccli`. It makes your number available to slides that use `:ccli:` and `:credits:` blocks. Leave it empty if you do not use CCLI content.

### Additional Screens (Virtual Peers)

Use this when you want more than one output at the same time, for example a projector, a browser link, or an output in another language. Click **Add Screen** for each extra output. Each row has:

- **Screen**: `Window only` (an extra local window), `URL Publish` (a browser link), or a specific display.
- **Language**: overrides the language for that output (for example, main screen in English, side screen in Spanish).
- **Variant**: overrides the layout (for example, notes on one screen, normal slides on another).
- **Default Screen**: what the output shows when no presentation is open: `Use Main Default`, `Solid Black`, `Solid Green` or `Default Presentation`.
- **Default Pres Path**: the presentation to show when **Default Screen** is `Default Presentation`.

### URL Publish Link

- Shows the browser link (`/publish/{key}.html`) that TVs, tablets and phones can open to follow the presentation, with a **Copy URL** button.
- It is filled in only when at least one row uses `URL Publish`.

### Main Presentation Window Mode

- `Full Screen` covers the entire display. `Windowed` opens a resizable window.

### Open Main Presentation Window on Peer Push

- When off, commands from a peer never open, navigate or close the main presentation window. Virtual screens are still controlled by peers.

### Mute Main Presentation Window

- Silences all audio from the main presentation window.

### Presentation Screen Mode

Controls when configured extra screens open:

- `Always Open`: opens them automatically after app startup.
- `Group Control`: open them manually with **Open Screens**.
- `On Demand`: opens them only while actively presenting.

### Main Screen Default and Main Default Presentation Path

- **Main Screen Default** sets what the main output shows before slides start: `Solid Black`, `Solid Green` or `Default Presentation`.
- **Main Default Presentation Path** (as `slug/presentation.md`) is used when that is `Default Presentation`, and as the fallback for any virtual screen set to `Use Main Default`.

### Check for updates automatically

- Lets the app check for new versions on its own. Turn it off if your environment blocks update checks or you prefer manual updates.

## Networking

This tab controls whether the app stays local-only or works with other devices on the network.

> **Who you share links with matters.** Some plugins (`slidecontrol`, `markerboard`, `bibletext-live`, `captions` and `videostream`) are built around shared, collaborative control. When any of them is enabled, **anyone holding a presentation or multiplex link can act in that shared space**: advance slides for everyone, draw on the whiteboard, change the live verse or captions. That is intended, not a fault, but it means there is no read-only viewer, no per-person permission, and no way to remove one participant. Share those links only within a small group of people you trust, and treat forwarding a link as handing over the controls. To cut off access you must invalidate the link itself: start a new session, or use **Reset Key** under **Server Access Key** below.

### Networking (`localhost` or `network`)

- `localhost`: the app only works on the same computer.
- `network`: other devices on your network can connect. Needed for Master Mode peering and for URL Publish.

### Enable HTTPS (experimental)

- Serves the app over HTTPS using a self-signed certificate. Requires OpenSSL.
- It adds little real security, but enables features that need a secure context, such as WebRTC. For a properly certified site, publish through the WordPress Publish plugin instead.

### Local Network Discovery (mDNS)

- **Enable Peering as Follower**: lets this app find and follow another presenter. Other presenters can then share their presentation on your screen. This also turns on the **Peer Pairing** tab.
- **Enable Master Mode**: lets this app act as the main presenter that other devices pair with. It only works when Networking is `network`.
- **Pairing PIN**: 4 to 6 digits required when a follower pairs. If Master Mode is on and no PIN exists, one is created automatically. The PIN is only checked at pairing. Changing it does not disconnect followers that are already paired; to revoke one, use **Forget** under **Peer Pairing > Paired Followers**.
- **Instance Name**: the name other devices see during discovery (for example `Front Stage PC`).

For deeper network behavior, see [doc/dev/PEERING.md](dev/PEERING.md).

### Server Access Key

- A key included in the local server URL. **Reset Key** generates a new one; do this if you suspect unauthorized access. Old links stop working. The local API server also uses this key for authentication.

### Vite Server Port

- The local web port used by the app. Default `8000`; change it only if another program uses it.

### Local API Server

- **Enable Local API Server** starts a local HTTP interface on `127.0.0.1` for programmatic access to plugin data. It requires the server access key.
- **API Server Port** defaults to `8900`.
- See [API_REFERENCE.md](API_REFERENCE.md).

### Reveal Remote Public Server

- The address of the public relay used by **exported standalone presentations** (which have no local server) and, if you turn on the option below, by this app. Change it only if your team runs its own relay.

### Route Live Features Through the Public Server

- **Off (default):** remote control, the markerboard, live captions, live Bible verses and shared video run on this computer's own server. That traffic stays on your network.
- **On:** those features connect through the public relay, so devices that cannot reach your network (a phone on cellular data, for example) can still join.
- Leave it off when everyone is on the same network; local is faster and more reliable. Exported standalone presentations always use the public relay.
- It takes effect when the servers restart.

## Folders & Paths

### Presentations Folder

- Where presentations and shared media are stored. Use **Browse** to pick it.
- Move it carefully and make sure existing files are in the new location. A folder in cloud storage (Google Drive, Nextcloud, OneDrive) can sync presentations between computers. The Media Library lives here too and can grow large.

### Prefer High Bitrate Media

- Prefers higher-quality media variants when options exist. Use it when your hardware and network can handle it.

### Auto-convert AV1 media for older hardware and software

- Converts AV1 media so older systems can play it. Leave off unless you see playback problems.

### Path to FFMPEG

- Points to the `ffmpeg` tool used for video thumbnails and other media tasks. Set it only if media features fail because ffmpeg cannot be found.

### Path to LibreOffice

- Points to LibreOffice (`soffice`), used to convert PowerPoint files (`.pptx`, `.ppt`, `.ppsx`, `.pps`, `.odp`, Keynote `.key`) to PDF during import.
- Leave it blank to detect it automatically (usual install locations, Snap and Flatpak on Linux, then your `PATH`). The note under the field shows where it was found.
- Set it only if LibreOffice is installed somewhere unusual. Without it, export the deck to PDF yourself and import the PDF.

For PDF import setup (used by the Add Media plugin), see [doc/dev/README-PDF.md](dev/README-PDF.md).

## PIP

Picture-in-picture, for video production tools that use chroma key workflows.

- **Enable PIP mode**: opens presentations in a PIP-friendly layout.
- **PIP Side**: which side the PIP area is placed on.
- **Chroma key color**: the key color. Match your keying setup to avoid artifacts.

## Hotkeys

Global hotkeys control slides with keyboard shortcuts while a presentation window is open.

Actions: `pipToggle` (sends `X`), `previous` (`P`), `next` (`Space`), `blank` (`B`), and `up`, `down`, `left`, `right`.

- Click **Record** next to an action, then press your key combination. **Clear** removes it.
- Duplicate shortcuts are not allowed. Press `Esc` while recording to cancel.
- Keep shortcuts simple so volunteers can operate reliably.

## Plugins

- Turn plugins on or off, and edit each plugin's settings.
- Turning a plugin off removes its features from the app. Some plugin settings need an app restart, which **Apply and Relaunch** does for you.
- For the meaning of a plugin's options, see its `README.md` (for example [plugins/addmedia/README.md](../plugins/addmedia/README.md)).

For technical plugin internals, see [doc/dev/PLUGINS.md](dev/PLUGINS.md).

## Peer Pairing

Pairing connects this app with another presenter on the network. The tab has two halves.

**Follower side** (needs **Enable Peering as Follower** on the Networking tab; otherwise the tab says so):

- **Discovered Peers**: presenters found by mDNS that you have not paired with. Choose one and enter its pairing PIN.
- **Manual Pairing...**: pair by **IP Address** and **Pairing Port** (default `8000`) without mDNS. **NAT Compatibility (rewrite master URLs)** helps when the master is reached through address translation.
- **Paired Masters**: presenters you are paired with, with an unpair button.

**Master side** (shown when **Enable Master Mode** is on):

- **Paired Followers**: devices that paired with this presenter. **Forget** revokes one; **Forget All** revokes all. Changing the pairing PIN does not do this.

See [doc/dev/PEERING.md](dev/PEERING.md) for how pairing works.
