# REVELation Snapshot Builder

This is the cross-platform desktop app and presentation builder for [REVELation Snapshot Presenter](https://github.com/fiforms/revelation), built with Electron and bundled for easy installation on Windows and Linux.

It provides a user-friendly way to manage and display local Reveal.js presentations with enhanced features like background video, live Markdown editing, and remote control.

---

## 📦 Download and Install

**Recommended for Most Users**  
Download the latest release from the [Releases Page](https://github.com/fiforms/revelation-electron-wrapper/releases) for Windows, Linux, and OSX

Just run the installer, and you’re good to go!

### Linux display server note (Wayland/X11)

On some Ubuntu/Wayland setups, you may need to launch with the X11 backend:

```bash
revelation-electron --ozone-platform=x11
```

If you launch from the desktop, you can add a `.desktop` entry like this:

```ini
[Desktop Entry]
Name=REVELation Snapshot Presenter
Exec=revelation-electron --ozone-platform=x11
Terminal=false
Type=Application
Categories=Utility;
```

---

## 👨‍💻 Developer Setup (or manual install)

If you're a developer or prefer building from source, here's how to set it up:

### 1. Clone the Repo (with submodules)

```bash
git clone --recursive https://github.com/fiforms/revelation-electron-wrapper.git
cd revelation-electron-wrapper/revelation
````

### 2. Install Dependencies

Install everything for the revelation submodule:

Install and start the Vite server inside the submodule:

```bash
npm install
npm run build
npm run dev
# Ctrl-C to exit
```

Return, install the electron dependenceis, and start the Electron app:

```bash
cd ..
npm install
npm start
```

---

## 💡 What This Does

This wrapper will:

* Launch a local Vite server to serve your Reveal.js-based presentations
* Start a Reveal.js Remote server for remote control and multi-screen
* Open a full Electron window pointing to your local server
* Automatically bundle everything for offline use when packaged

---

## 🛠 Build an Installer

See BUILDING.md for details

---

## 🔗 Related Projects

* 📽️ [REVELation Framework](https://github.com/fiforms/revelation) — Modular Reveal.js system with YAML-driven themes, macros, and media integration.

---

## 📜 License

MIT License — Free to use and modify.

