# PDF Import Setup (Poppler)

### Table of Contents
* [Overview](#pdf-overview)
* [Configure Paths in the App](#pdf-configure-paths)
* [Windows Setup](#pdf-windows)
* [macOS Setup](#pdf-macos)
* [Linux Setup](#pdf-linux)
* [Troubleshooting](#pdf-troubleshooting)

---

<a id="pdf-overview"></a>

## Overview

This guide explains how to install Poppler and configure the Add Media plugin so PDF pages can be imported as slides.

---

<a id="pdf-configure-paths"></a>

## Configure Paths in the App

1. Open the app Settings window.
2. Go to the Plugins section.
3. Find the Add Media plugin.
4. Fill in:
- `pdftoppmPath`
- `pdfinfoPath`
5. Save settings and restart the app.

Use full binary paths.

---

<a id="pdf-windows"></a>

## Windows Setup

1. Download Poppler for Windows:
`https://github.com/oschwartz10612/poppler-windows/releases`
2. Unzip to a local folder (for example `C:\Tools\poppler`).
3. Locate binaries (example):

```text
<unzipped>\poppler-<version>\Library\bin\pdftoppm.exe
<unzipped>\poppler-<version>\Library\bin\pdfinfo.exe
```

4. Paste those full paths into Add Media plugin settings.

Example:

```text
pdftoppmPath = C:\Tools\poppler\poppler-24.08.0\Library\bin\pdftoppm.exe
pdfinfoPath  = C:\Tools\poppler\poppler-24.08.0\Library\bin\pdfinfo.exe
```

---

<a id="pdf-macos"></a>

## macOS Setup

```bash
brew install poppler
which pdftoppm
which pdfinfo
```

Use the resulting paths in plugin settings. On Apple Silicon this is often:

```text
/opt/homebrew/bin/pdftoppm
/opt/homebrew/bin/pdfinfo
```

---

<a id="pdf-linux"></a>

## Linux Setup

Install Poppler with your package manager:

```bash
sudo apt install poppler-utils
sudo dnf install poppler-utils
sudo pacman -S poppler
```

Then find paths:

```bash
which pdftoppm
which pdfinfo
```

Typical paths:

```text
/usr/bin/pdftoppm
/usr/bin/pdfinfo
```

---

<a id="pdf-troubleshooting"></a>

## Troubleshooting

- If PDF import cannot run Poppler, verify both paths and restart the app.
- Ensure both binaries exist and are executable.
