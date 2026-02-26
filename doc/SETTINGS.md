# Settings Guide

This guide explains the Settings screen in plain language:

- what each option changes in real use
- when you might want to change it
- what to expect after you click **Save Settings**

For a broader tour of the app, see [doc/GUI_REFERENCE.md](GUI_REFERENCE.md).

## Before you change settings

- Changes take effect after you click **Save Settings** at the bottom of the *Settings* window.

## Quick recommendations for most people

- Keep **Networking** on `localhost` unless you need other devices to connect.
- Set **Preferred Display** first if you use two screens.
- Leave server ports at their defaults unless you have a conflict.
- Only set custom `FFMPEG`/`FFPROBE` paths if media features are not working.

## General

### Preferred Display

- Chooses which monitor the presentation opens on.

### Language

- Changes the app interface language.
- Saving this setting restarts the app so the new language is used everywhere.

### Preferred Presentation Language

- Sets the default language version of presentations.


- You should only need to set this if you prefer presentating in a language other than the application interface language, i.e. this instance or peer is presenting a translated version of your presentations. You may also wish to leave this blank and configure virtual peers (screens) in alternative languages.

In practice:
- Leave it blank to follow the app language.
- Set it (for example `en` or `es`) to force that language by default.

### CCLI License Number

What it does:
- Makes your CCLI number available to slides that use the CCLI macro.

Why change it:
- You need your license number included when presenting content that expects it.

In practice:
- If you do not use CCLI-related content, you can leave this empty.

### Screen Type Variant

What it does:
- Sets a default presentation style variant, like lower thirds or notes.

Why change it:
- You usually run a specific output style and want it to be the default.

In practice:
- If you are unsure, keep `Normal`.

## Additional Screens (Virtual Peers)

Use this section when you want more than one output at the same time, for example:
- one output to a projector
- one output in a browser link
- one output with a different language or layout

Each row is one extra output.

### Screen

What it does:
- Picks where that extra output goes:
- `Window only`: extra local window
- `URL Publish`: browser link output
- a specific display: direct to that monitor

Why change it:
- You want to target a room display, stream screen, or remote browser viewer.

### Language

What it does:
- Overrides language for that one extra output.

Why change it:
- You need bilingual output (for example main screen in English, side screen in Spanish).

### Variant

What it does:
- Overrides layout style for that one extra output.

Why change it:
- You want notes on one screen, normal slides on another.

### Default Screen

What it does:
- Controls what that extra output shows when no live presentation is open.

Options:
- `Use Main Default`: follow main default behavior
- `Solid Black`: black screen
- `Solid Green`: green screen
- `Default Presentation`: show a chosen presentation by default

Why change it:
- You want clean standby behavior before and after a service.

### Default Pres Path

What it does:
- Sets which presentation opens when **Default Screen** is `Default Presentation`.

Why change it:
- You want a welcome loop, announcement deck, or holding slide by default.

### URL Publish Link

What it does:
- Shows the browser link people can open to follow the presentation.

Why change it:
- You want TVs, tablets, or phones to follow from a web link.

In practice:
- This link appears only if at least one row uses `URL Publish`.

### Presentation Screen Mode

What it does:
- Controls when configured extra screens open.

Options:
- `Always Open`: opens them automatically after app startup
- `Group Control`: open them manually with **Open Screens**
- `On Demand`: opens only while actively presenting

Why change it:
- Pick the mode that matches your event flow and operator habits.

### Main Screen Default

What it does:
- Sets the default standby content for the main presentation output.

Why change it:
- You want a consistent look before slides start.

### Main Default Presentation Path

What it does:
- Chooses which presentation is used when **Main Screen Default** is `Default Presentation`.

Why change it:
- You want a specific default deck every time.

### Check for updates automatically

- Lets the app check for new versions on its own.
- Turn it off if your environment blocks update checks or you prefer manual updates.

## Networking

This section controls whether this app stays local-only or can work with other devices on the same network.

### Networking (`localhost` or `network`)

What it does:
- `localhost`: this app only works on the same computer.
- `network`: allows other devices on your network to connect. Use this to allow "peering" in master mode, or Publish URL.

Why change it:
- Use `network` for multi-device setups.
- Keep `localhost` for simple single-computer use.

### Enable Peering as Follower

What it does:
- Lets this app find and follow another presenter on the network. Other presenters can share their presentation on your local screen.

Why change it:
- You want this machine to mirror or follow commands from another machine.

### Enable Master Mode

What it does:
- Lets this app act as the main presenter that other devices can pair with.

Why change it:
- You want to control other follower devices from this machine.

In practice:
- This only works when **Networking** is set to `network`.

### Pairing PIN

- Adds a PIN required for pairing followers to this master device.
- If master mode is enabled and no PIN exists, one is created automatically.

### Instance Name

What it does:
- Sets the name shown to other devices during discovery.

Why change it:
- Make it easy to identify this machine (for example `Front Stage PC`).

For deeper network behavior details, see [doc/dev/PEERING.md](dev/PEERING.md).

## Server and folders

### Vite Server Port

What it does:
- Sets the local web port used by the app content.

Why change it:
- Only if another app is already using the same port.

In practice:
- Default is `8000` and is usually fine.

### Reveal Remote Port

What it does:
- Sets the port for remote control features.

Why change it:
- Only if you have a port conflict.

In practice:
- Default is `1947` and is usually fine.

### Reveal Remote Public Server

What it does:
- Sets the remote service URL used for reveal remote support.

Why change it:
- Only if your team uses a different remote service endpoint.

### Presentations Folder

What it does:
- Chooses where presentations and shared media are stored.

Why change it:
- You want content on a different drive, shared location, or backed-up folder.

In practice:
- Move this carefully and make sure existing files are in the new location.
- Storing this folder in cloud storage (Google Drive, Nextcloud, OneDrive) could be helpful to allow presentations to automatically sync between computers.
- This path also hosts the Media Library which can grow quite large.

### Prefer High Bitrate Media

What it does:
- Tells the app to prefer higher-quality media when options exist.

Why change it:
- You want best visual quality and your hardware/network can handle it.

### Auto-convert AV1 media for older hardware and software

What it does:
- Helps older devices play AV1 media more reliably by converting it.

Why change it:
- You see playback issues on older systems.

In practice:
- Leave off unless you need compatibility help.

## Picture-in-picture (PIP)

### Enable PIP mode

What it does:
- Opens presentations in a PIP-friendly layout.

Why change it:
- You are feeding video production tools that use chroma key workflows.

### PIP Side

What it does:
- Chooses which side the PIP area is placed on.

Why change it:
- Match your capture/production layout.

### Chroma key color

What it does:
- Chooses the key color used with PIP.

Why change it:
- Match your keying setup to avoid artifacts.

## Global Hotkeys

Global hotkeys let you control slides using keyboard shortcuts while a presentation window is open.

Available actions:
- `pipToggle` (sends `X`)
- `previous` (sends `P`)
- `next` (sends `Space`)
- `blank` (sends `B`)
- `up`, `down`, `left`, `right`

How to use:
- Click **Record** next to an action.
- Press your key combination.
- Click **Clear** to remove it.

Practical notes:
- Duplicate shortcuts are not allowed.
- Press `Esc` while recording to cancel.
- Keep shortcuts simple so volunteers can operate reliably.

## Media tool paths

### Path to FFMPEG

What it does:
- Points the app to the `ffmpeg` tool used for media tasks.

Why change it:
- Set this only if media features fail because the app cannot find ffmpeg.

### Path to FFPROBE

What it does:
- Points the app to the `ffprobe` tool used to read media details.

Why change it:
- Set this only if media metadata/inspection features are failing.

For PDF import setup (used by Add Media plugin), see [doc/dev/README-PDF.md](dev/README-PDF.md).

## Plugin Manager

This section controls which plugins are on, and lets you fill plugin-specific options.

What it does:
- Turn plugins on or off.
- Edit each plugin's settings.

Why change it:
- Enable only what your team uses.
- Configure plugin behavior for your workflow.

Practical notes:
- Turning off a plugin removes its features from the app UI.
- Some plugin settings may require restarting the app or reopening related screens.
- For exact meaning of plugin options, check that plugin's `README.md` (for example [plugins/addmedia/README.md](../plugins/addmedia/README.md)).

For technical plugin internals, see [doc/dev/PLUGINS.md](dev/PLUGINS.md).
