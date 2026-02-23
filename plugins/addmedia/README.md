# Add Media Plugin

## Table of Contents
* [Overview](#addmedia-overview)
* [What It Adds](#addmedia-what-it-adds)
* [How It Works](#addmedia-how-it-works)
* [Configuration](#addmedia-configuration)

<a id="addmedia-overview"></a>
## Overview

The Add Media plugin provides import tools for adding external content into presentations.

<a id="addmedia-what-it-adds"></a>
## What It Adds

- Import media files into a presentation or `_media` library
- Add PowerPoint (`.pptx`) slides as images
- Add PDF pages as images/slides (via Poppler tools)
- Insert generated markdown and media aliases into front matter

<a id="addmedia-how-it-works"></a>
## How It Works

The plugin opens modal dialogs from the builder, lets the user choose files, then copies or converts assets and appends markdown to the target presentation file.

It also reads slide notes from PowerPoint files and can include those notes in generated markdown.

<a id="addmedia-configuration"></a>
## Configuration

Optional plugin settings:

- `pdftoppmPath`: path to Poppler `pdftoppm`
- `pdfinfoPath`: path to Poppler `pdfinfo`

If these are not set, the plugin tries command names from `PATH`.
