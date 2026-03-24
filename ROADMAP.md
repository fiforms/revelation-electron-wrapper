# REVELation Snapshot Presenter — Roadmap

This document tracks planned features, active investigations, and longer-range ideas.
Items are grouped by theme, not strict priority. Status markers:

- **Planned** — committed direction, implementation expected
- **In Progress** — actively being worked
- **Concept** — worth exploring; not yet committed
- **Deferred** — valid idea, not current focus

---

## Web Publishing & Sharing

**Planned**

- **FreeShow Export** — Export a REVELation presentation to FreeShow's open JSON format so that content authored here (with its media pipeline, Bible text, and hymn plugins) can be used in FreeShow for live service operation. The two tools serve complementary roles; smooth handoff between them is more useful than competing on live-operation features.

**Concept**

- **FreeShow Slide Import** — Import slides from a FreeShow show file (.show) into a REVELation presentation. Useful for congregations migrating content or maintaining a single source in FreeShow while publishing web versions via REVELation. Depends on stability of FreeShow's format and community interest.
- **Ghost / Headless CMS Integration** — Extend the WordPress publishing model to Ghost and other CMS platforms via their APIs.

---

## Language & Internationalization

**Planned**

- **Improved Language Variant UI** — The variant authoring workflow (creating, switching, translating linked files) needs a more visible and guided interface; it is currently underexposed relative to how powerful it is.
- **Per-Slide Language Toggle** — Allow the presenter to switch the active language variant from the slide control panel during a live presentation.
- **Live Interpretation** — Extend current captions plugin to use a translation service like 

**Concept**

- **Machine-Translation Assist** — Optionally pre-populate a new language variant using a local or API-based translation pass, leaving human review as the final step.

---

## Media & Effects

**Planned**

- **MediaFX Preset Sharing** — Package and install effect presets as ZIP plugins, following the existing plugin install model.

**Concept**
- **Attribution Auto-Fill** — When importing media, auto-populate attribution metadata from EXIF, embedded XMP, or known source URLs (e.g. Unsplash API response fields).
- **Live Camera / NDI Input as Background** — Accept an NDI or webcam stream as a slide background source, similar to ProPresenter's video input feature.
- **Audio Ducking** — Automatically reduce background audio level when a slide with recorded narration or video with audio becomes active.

---

## Content & Authoring

**Planned**

- **Rich Builder Enhancements** — Additional block types in the visual builder: two-column layouts, more rich formatting.

**Concept**

- **SVG Slide Editor** — A builder plugin to author SVG formatted slides and embed SVG into the slide deck. 
- **Slide Templates / Snippet Library** — Save frequently used slide structures (title+scripture, title+image+caption, etc.) as named snippets insertable from the Builder menu.
- **Outline / Storyboard View** — A high-level view of all slides as a linear outline, editable as structured text, separate from the per-slide markdown editor.
- **Collaborative Editing** — Multi-user editing of a shared presentation over the LAN, building on the existing Socket.io peer infrastructure.
- **PPTX / Google Slides Import** — Convert an existing PowerPoint or Google Slides deck into a REVELation markdown presentation, preserving text content and images where possible.

---

## Peer & Multi-Screen

**Planned**

- **Audience Response / Poll Integration** — Embed a live polling URL or QR code into a designated slide type, with optional real-time result display.

**Concept**

- **MIDI / Hardware Remote Control** — Map MIDI signals or USB HID button devices to slide advance, blackout, and other presenter actions.

---

## Export & Integration


**Concept**

- **EPUB Export** — Package a presentation as an EPUB for reading on e-readers or in document apps, using the handout view as the source.
- **Podcast / Video Export** — Record a narrated walkthrough of a presentation (slide advances + audio) and export as a video file using the existing FFmpeg pipeline.

---

## Plugin Ecosystem

**Planned**

- **Captions Plugin Enhancements** — Improve live captioning support (speech-to-text or SRT/VTT import) displayed as an overlay during presentation.

**Concept**

- **Plugin Registry / Discovery** — A lightweight online listing of community plugins, browsable from within the app, with one-click install via the existing ZIP install path.
- **ChurchSuite / Planning Center Integration** — Pull service order and song schedule from Planning Center Online or ChurchSuite, generating a slide outline automatically.
- **OpenLP / EasyWorship Import** — Import song and scripture content from common church software databases.

---

## Infrastructure & Developer Experience

**Planned**

- **Signed Installers (macOS / Windows)** — Code-signed builds to eliminate OS security warnings on first launch.
- **Auto-Update** — optional background download of new releases.

**Concept**

- **Snap / Flatpak Packaging** — Distribute the Linux build via Snap Store or Flathub for easier installation on mainstream distributions.
- **Plugin Testing Framework** — Documented test harness and example test suite for plugin authors, so plugins can be validated without running the full Electron app.

---

## Deferred

- **Android / iOS Presenter Remote App** — A dedicated mobile companion app for slide control and notes display. The existing browser-based remote (Reveal Remote) covers this adequately for now.
- **Cloud Sync for Presentations** — Sync presentations across devices via cloud storage. Deferred in favor of simpler solutions (shared folder, cloud storage, git repo) that already work with the plain-file format.

---

*Last updated: 2026-03-23. To propose an item, open an issue on [GitHub](https://github.com/fiforms/revelation-electron-wrapper).*
