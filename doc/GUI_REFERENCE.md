# Snapshot Builder GUI Reference

---

### Table of Contents

* [Overview](#gui-overview)
* [Main Screens](#gui-main-screens)
* [Presentation List and Actions](#gui-presentation-list)
* [Builder and Editing Tools](#gui-builder)
* [Media Library and Import](#gui-media-library)
* [Plugins in the GUI](#gui-plugins)
* [Handout and PDF Workflows](#gui-handout-pdf)
* [Export Workflows](#gui-export)
* [Settings and Networking](#gui-settings-network)
* [Debug and Recovery Tools](#gui-debug-recovery)
* [Common Gotchas](#gui-gotchas)
* [Recommended Workflow](#gui-workflow)

---

<a id="gui-overview"></a>

## Overview

This guide covers the desktop GUI experience in `revelation-electron-wrapper`.

Use this document when you want practical, app-level guidance. For markdown syntax and framework internals, use the REVELation framework docs.

---

<a id="gui-main-screens"></a>

## Main Screens

Primary GUI areas include:

- **Presentation List**: browse, open, and manage presentations.
- **Media Library**: manage shared media in `_media`.
- **Presentation Builder**: visual editing and insertion tools.
- **Settings**: app, plugin, media, and network configuration.
- **Handout View**: print-friendly presentation rendering.

---

<a id="gui-presentation-list"></a>

## Presentation List and Actions

From the presentation list you can typically:

- Create a new presentation
- Open/present a presentation
- Open handout view
- Open builder/editor
- Show presentation folder
- Export artifacts (PDF/images/offline package)
- Delete presentation variants or full presentation folders

---

<a id="gui-builder"></a>

## Builder and Editing Tools

The builder is focused on fast authoring workflows:

- Slide/column navigation and structure tools
- Insert content from menus (notes, tables, media, plugin templates)
- Metadata and presentation property editing
- Variant-aware editing support
- Preview and presentation launch shortcuts

Builder insert actions are plugin-extensible, so installed plugins can add custom content creators.

---

<a id="gui-media-library"></a>

## Media Library and Import

Media Library helps you:

- Import media files into shared `_media`
- Generate and store metadata sidecars
- Preview media and inspect attribution/origin details
- Delete or manage existing media assets
- Reuse the same media across many presentations

The Add Media workflow can also import external sources (including formats like PDF/PPTX, depending on tool availability and plugin configuration).

For PDF import setup details, see [doc/dev/README-PDF.md](dev/README-PDF.md).

---

<a id="gui-plugins"></a>

## Plugins in the GUI

Plugin integration points in the GUI include:

- Plugin pages in the sidebar/menu
- Builder insert actions
- Dialog-based tools (search/import/effects)
- Plugin settings and config in app settings

You can open the plugins folder from the Plugins menu and install additional plugin packages (where supported).

---

<a id="gui-handout-pdf"></a>

## Handout and PDF Workflows

Handout mode provides a print-friendly presentation output with optional controls:

- Show/hide notes
- Show/hide images
- Show/hide attributions
- Slide number link behavior

---

Typical PDF flow:

1. Open handout view.
2. Set desired display toggles.
3. Use print/save-to-PDF.

---

<a id="gui-export"></a>

## Export Workflows

Common export paths from the GUI:

- PDF export
- Slide image export
- Offline/export package workflows

Availability depends on presentation state, plugin support, and local environment/tooling.

---

<a id="gui-settings-network"></a>

## Settings and Networking

Settings include:

- Presentation and media preferences
- Plugin config values
- Localization/language options
- Network mode and remote presentation settings
- Peer presenter pairing/discovery options

In network mode, additional behavior (discovery, remote control, peer command routing) is enabled.

---

<a id="gui-debug-recovery"></a>

## Debug and Recovery Tools

Useful built-in maintenance actions:

- Open debug log
- Clear/reset debug log
- Regenerate documentation presentation
- Regenerate theme thumbnails
- Reset all settings and plugins

For reset/uninstall/log-path details, see [doc/TROUBLESHOOTING.md](TROUBLESHOOTING.md).

---

<a id="gui-gotchas"></a>

## Common Gotchas

- **Wayland display issues**: on some Linux setups, launching with X11 backend is more stable.
- **Missing plugin behavior**: verify plugin is installed/enabled and its settings are complete.
- **Media not resolving**: confirm files exist in `_media` and aliases/paths match markdown/front matter.
- **Export differences**: handout/print/offline outputs may differ from live reveal behavior depending on plugin/runtime constraints.
- **Unexpected reset impact**: reset removes local overrides/settings; back up critical local data first.

Troubleshooting guide: [doc/TROUBLESHOOTING.md](TROUBLESHOOTING.md).

---

<a id="gui-workflow"></a>

## Recommended Workflow

1. Create/open a presentation from the list.
2. Import media into `_media` first.
3. Build slides and metadata in builder.
4. Preview in presentation mode.
5. Validate handout/PDF output.
6. Export/share as needed.
