# Snapshot Builder GUI Reference

---

## Table of Contents
* [Overview](#gui-overview)
* [Media Library](#gui-media-library)
* [Handout and PDF Workflow](#gui-handout-pdf)
* [Recommended Workflow](#gui-workflow)

---

<a id="gui-overview"></a>

## Overview

This documentation is for the Electron wrapper (`revelation-electron-wrapper`) GUI features, not core REVELation markdown syntax.

---

<a id="gui-media-library"></a>

## Media Library

In the GUI, Media Library tools help you:
- Import media files
- Generate thumbnails and metadata
- Create `media:` YAML snippets
- Preview and delete library items

---

<a id="gui-handout-pdf"></a>

## Handout and PDF Workflow

The app can open handout view for a presentation and export to PDF through the print flow.

Typical flow:
1. Open a presentation in handout mode.
2. Configure toggles (images, notes, attributions, slide links).
3. Print to PDF.

PDF import requirements for the Add Media plugin are documented in [doc/dev/README-PDF.md](dev/README-PDF.md).

---

<a id="gui-workflow"></a>

## Recommended Workflow

1. Create or open a presentation in the GUI.
2. Import assets into `_media/` using Media Library or Add Media tools.
3. Edit markdown and metadata.
4. Preview in presentation mode.
5. Export handout/offline artifacts as needed.
