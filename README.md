---

# REVELation Snapshot Builder

`revelation-electron-wrapper` is the cross-platform Electron desktop app for [REVELation Snapshot Presenter](https://github.com/fiforms/revelation).

It wraps the core REVELation framework with a local app experience: presentation management, metadata and markdown editing, media workflows, peering/network controls, and export tooling.

---

## 📦 Download and Install

**Recommended for Most Users**  
Download the latest release from the [Releases Page](https://github.com/fiforms/revelation-electron-wrapper/releases) for Windows, Linux, and OSX

Just run the installer, and you’re good to go!

Troubleshooting notes (including Wayland/X11 launch guidance):

* [doc/TROUBLESHOOTING.md](doc/TROUBLESHOOTING.md)

---

## 👨‍💻 Developer Setup (or manual install)

If you're a developer or prefer building from source:

* [doc/dev/INSTALLING.md](doc/dev/INSTALLING.md)

---

## 💡 Project Scope

This repository is responsible for the desktop wrapper and app UX. It:

* Launches a local Vite server to serve Reveal.js-based presentations
* Starts a Reveal.js Remote server for remote control and multi-screen
* Opens a full Electron window pointed to the local server
* Provides GUI flows for editing, media import, and export
* Bundles wrapper and framework resources for packaged/offline use

Core markdown authoring syntax, macro processing, and framework internals live in the `revelation/` submodule.

---

## 🧩 About the REVELation Framework

The bundled `revelation/` submodule is a modular framework for building and presenting Markdown-based Reveal.js slide decks.

For users installing `revelation-electron`, this is the engine behind the app experience:

* Extended markdown authoring (front matter, macros, slide helpers, attributions)
* Media-rich slide support (backgrounds, aliases, and reusable media references)
* Reveal.js runtime integration with remote and handout workflows
* File-based presentations that are easy to version and share

If you want the full framework overview and direct framework-first workflow, see:
* [revelation/README.md](revelation/README.md)

---

## 📚 Documentation

Wrapper docs (this repository):

* [doc/GUI_REFERENCE.md](doc/GUI_REFERENCE.md) - GUI workflows and user-facing wrapper behavior
* [doc/TROUBLESHOOTING.md](doc/TROUBLESHOOTING.md) - runtime troubleshooting notes (including Wayland/X11)
* [doc/dev/INSTALLING.md](doc/dev/INSTALLING.md) - manual/developer installation from source
* [doc/dev/PLUGINS.md](doc/dev/PLUGINS.md) - plugin hooks used by the builder/export pipeline
* [doc/dev/PEERING.md](doc/dev/PEERING.md) - discovery and pairing behavior
* [doc/dev/README-PDF.md](doc/dev/README-PDF.md) - PDF import setup (Poppler) for Add Media
* [doc/dev/BUILDING.md](doc/dev/BUILDING.md) - packaging and installer build instructions

Framework docs (submodule):

* [revelation/README.md](revelation/README.md) - framework overview, quick start, and feature summary
* [revelation/doc/REFERENCE.md](revelation/doc/REFERENCE.md) - top-level index for framework docs
* [revelation/doc/AUTHORING_REFERENCE.md](revelation/doc/AUTHORING_REFERENCE.md) - markdown authoring syntax extensions
* [revelation/doc/METADATA_REFERENCE.md](revelation/doc/METADATA_REFERENCE.md) - YAML front matter, macros, media aliases
* [revelation/doc/ARCHITECTURE.md](revelation/doc/ARCHITECTURE.md) - framework architecture and extension model

Plugin-specific syntax and behaviors are documented in plugin-local README files (for example, [plugins/revealchart/README.md](plugins/revealchart/README.md)).

---

## 🛠 Build an Installer

See [doc/dev/BUILDING.md](doc/dev/BUILDING.md) for details.

---

## 🔗 Related Projects

* 📽️ [REVELation Framework](https://github.com/fiforms/revelation) — Modular Reveal.js system with YAML-driven themes, macros, and media integration.

---

## 📜 License

This software itself is licensed under a permissive MIT-style license. However, the project release includes software that is licensed
under other more restrictive licenses such as the GNU General Public License (GPL) and the GNU LGPL, which places some restrictions on 
how you can redistribute it. In particular, it must include some notice like this one with a link to the license and you must make
the source code available.

Please see [LICENSE.md](LICENSE.md) for details.
