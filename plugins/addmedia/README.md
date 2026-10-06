# Add Media Plugin

## Table of Contents
* [Overview](#addmedia-overview)
* [What It Adds](#addmedia-what-it-adds)
* [How It Works](#addmedia-how-it-works)
* [External Programs](#addmedia-dependencies)
* [HTTP API](#addmedia-api)
* [Configuration](#addmedia-configuration)

<a id="addmedia-overview"></a>
## Overview

The Add Media plugin provides import tools for adding external content into presentations.

<a id="addmedia-what-it-adds"></a>
## What It Adds

- Import media files into a presentation or `_media` library
- Import audio files (`mp3`, `ogg`, `webm`, `wav`, `m4a`, `aac`, `opus`) and insert `:audio:play:` / `:audio:playloop:` slides
- Drag-and-drop import of images, video and audio onto the builder, plus bulk image import from a folder or drop
- Pick items from the shared media library
- Add PowerPoint (`.pptx`) slides as images (converted through LibreOffice)
- Add PDF pages as images/slides (via Poppler tools)
- Insert generated markdown and media aliases into front matter

<a id="addmedia-how-it-works"></a>
## How It Works

The plugin opens modal dialogs from the builder, lets the user choose files, then copies or converts assets and appends markdown to the target presentation file.

It also reads slide notes from PowerPoint files and can include those notes in generated markdown.

Droppable image types: `jpg`, `jpeg`, `png`, `webp`, `gif`, `bmp`. Droppable video types: `mp4`, `webm`, `mov`, `m4v`, `ogv`, `mkv`.
Bulk imports go into numbered `image_import_NN` and `pdf_import_NN` folders inside the presentation.

<a id="addmedia-dependencies"></a>
## External Programs

- **Poppler** (`pdftoppm`, `pdfinfo`) for PDF pages. See [README-PDF.md](../../doc/dev/README-PDF.md).
- **LibreOffice** to convert PowerPoint files to PDF before the pages are rendered. It is located by `lib/libreofficeResolver.js`; install it if PowerPoint import reports it missing.

<a id="addmedia-api"></a>
## HTTP API

When the local API server is enabled, the plugin adds routes under `/api/addmedia/`:

- `GET /api/addmedia/search?query=...` lists matching media-library items (title, description snippet, keywords).
- `GET /api/addmedia/item?filename=...` returns a YAML snippet to paste under `media:` in front matter.

<a id="addmedia-configuration"></a>
## Configuration

Optional plugin settings:

- `pdftoppmPath`: path to Poppler `pdftoppm`
- `pdfinfoPath`: path to Poppler `pdfinfo`

If these are not set, the plugin tries command names from `PATH`.
