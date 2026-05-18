# Building REVELation Snapshot Presenter

## Prerequisites

- **Node.js** 18+ and npm
- **Git** (with submodule support)
- **Python** (for native module compilation)
- Platform-specific build tools (see platform sections below)

---

## Initial Setup

### 1. Clone the Repository with Submodules

```bash
git clone --recurse-submodules https://github.com/fiforms/revelation-electron-wrapper.git
cd revelation-electron-wrapper
```

If you already cloned without submodules, initialize them:

```bash
git submodule update --init --recursive
```

---

### 2. Install Dependencies

Standard installation:

```bash
npm install
```

This will:
- Install all npm packages
- Build the Revelation GUI
- Copy plugins
- Download remote assets (Bibles, effectgenerator, theme thumbnails, oldcss, mediafx gallery)
- Download WordPress plugin PHP dependencies from GitHub

---

## Remote Assets and Offline Installation

The project downloads several pre-built resources during `npm install`:

---

### Assets from www.pastordaniel.net

- **Bibles** — Bible translation XML files
  - Alternatively, download translations from https://sourceforge.net/projects/zefania-sharp/files/Bibles/ or another XMLBIBLE source
  - Place the extracted XML files in `plugins/bibletext/bibles`
- **effectgenerator** — Native binary for effect generation
  - Alternatively, download the latest release from https://github.com/fiforms/effectgenerator
  - Place `effectgenerator` or `effectgenerator.exe` binary for your platform in `bin/`
- **Theme thumbnails** — Preview images for available themes
  - Stored in source folder: `revelation/css/theme-thumbnails/`
  - Copied into dist during build (survives rebuilds)
  - Alternatively, generate by launching the application and choosing "Help → Debug → Generate Theme Thumbnails" (saves to source folder)
- **oldcss** — Legacy CSS assets
  - Safe to ignore if full backwards compatibility is not a priority
  - Alternatively, extract from a previous release
- **mediafx gallery** — MediaFX effect preview videos
  - Alternatively, generate by running `./generate_gallery.sh` inside `plugins/mediafx/gallery/` (Linux/Mac only)

---

### PHP Libraries from GitHub

- **WordPress plugin dependencies** — Composer libraries for the WordPress plugin
  - Downloaded from GitHub releases (league/commonmark, symfony components, nette utilities, etc.)
  - Extracted into `WordPress/revelation-presentations/vendor/`
  - **Download**: `npm run fetch-wordpress-libs` — Downloads only the GitHub PHP dependencies for the WordPress plugin

---

### Skipping Downloads During Install

If you want to install dependencies manually or www.pastordaniel.net is unreachable

```bash
SKIP_BLOBS=true npm install
```

This will complete the installation without downloading any remote resources (both www.pastordaniel.net assets and GitHub-hosted WordPress libraries).

---

### Downloading Assets Later

If you skipped downloads and want to fetch them later:

- `npm run fetch-blobs` — Downloads everything (www.pastordaniel.net assets and WordPress PHP libraries)

If specific downloads fail, the process continues with others (they are non-critical for development).

### How Caching Works

Theme thumbnails are cached in the **source folder** (`revelation/css/theme-thumbnails/`) rather than the build output folder (`revelation/dist/css/theme-thumbnails/`). During `npm run build`:

1. The Revelation build process rebuilds `revelation/dist` from scratch
2. Theme thumbnails are fetched (or checked) in the source folder
3. They are then copied from source to dist

This approach ensures:
- Files are only downloaded once and cached persistently
- Rebuilds don't require re-downloading from the network
- The generate script naturally writes to the source folder for consistency

---

## Building on macOS

Before building, make sure you have Homebrew, Node.js and Git installed. From a terminal:

```shell
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Make sure it's available
brew --version

# Install Node:
brew install node

# Verify:
node -v
npm -v

# Install Git
brew install git

# Verify
git --version
```

### Building the Application (Apple Silicon)

```shell
git clone --recurse-submodules https://github.com/fiforms/revelation-electron-wrapper.git
cd revelation-electron-wrapper

npm install

# Testing the app
npm start

npm run dist-mac
```

### Building on macOS (Intel, cross compiling from arm64)

- Install Rosetta
- Set the Terminal app to open using Rosetta
- Follow build instructions above in a fresh directory

---

## Building on Windows

First install [Git](https://gitforwindows.org/) and [Node](https://nodejs.org/en/download)

Open a PowerShell window

```shell
git clone --recurse-submodules https://github.com/fiforms/revelation-electron-wrapper.git
cd revelation-electron-wrapper
npm install

# Testing the app
npm start

# Build Poppler Plugin
npm run build-popplerpdf-win
npm run dist-popplerpdf-win

# Building Package
npm run dist-win
```

---

## Building on Linux

Setup environment (Ubuntu):

```shell
sudo apt install git npm libnspr4 libnss3 ffmpeg
sudo npm install -g node@latest
sudo npm install -g npm@latest
```

Build:

```shell
git clone --recurse-submodules https://github.com/fiforms/revelation-electron-wrapper.git
cd revelation-electron-wrapper
npm install
npm start
npm run dist-linux
```

---

## Development

### Running in Dev Mode

```bash
npm run dev
```

Starts the Electron app with hot-reload for theme development.

### Building Assets Only

```bash
npm run build
```

Rebuilds Revelation GUI, downloads all blobs, and packages assets.

### Building Offline Plugins

```bash
npm run build:offline-plugins
```

---

## Troubleshooting

### "Revelation submodule not found"

Ensure submodules are initialized:

```bash
git submodule update --init --recursive
npm install
```

### Missing Blobs

If some resources fail to download during install:

1. Try downloading again: `npm run fetch-blobs`
2. Specific resources may fail silently; the app may work without them but with reduced functionality

### Native Module Compilation Issues

If you see errors building native modules (ffmpeg-static, ffprobe-static, sharp), ensure you have platform-specific build tools installed:

- **macOS**: Xcode Command Line Tools (`xcode-select --install`)
- **Windows**: Visual Studio Build Tools for C++
- **Linux**: `build-essential` and other dev tools

---

## Project Structure

- `revelation/` — Revelation GUI submodule (Vue.js frontend)
- `plugins/` — Plugin modules (BibleText, MediaFX, etc.)
- `WordPress/` — WordPress plugin source
- `scripts/` — Build and utility scripts
- `http_admin/` — Server administration interface

See [AGENTS.md](../../AGENTS.md) for detailed architecture documentation.
