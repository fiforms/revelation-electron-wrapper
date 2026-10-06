# Installing From Source

---

<a id="install-overview"></a>

## Overview

Use this guide if you are developing locally or manually installing from source.

---

## Prerequisites

- **Node.js 22.12 or newer** and npm (required by Electron 44)
- **Git**, with submodule support (the `revelation/` framework is a submodule)

<a id="install-clone"></a>

## Clone, install and run

```bash
git clone --recursive https://github.com/fiforms/revelation-electron-wrapper.git
cd revelation-electron-wrapper
npm install
npm start
```

`npm install` builds the `revelation/` submodule (preinstall) and then downloads large binaries and legacy CSS
(postinstall). To skip those downloads, for example on a slow connection or in CI, set `SKIP_BLOBS=1`:

```bash
SKIP_BLOBS=1 npm install
npm run fetch-blobs   # later, to fetch what was skipped
```

To produce installers and packages, see [BUILDING.md](BUILDING.md). On macOS, see
[../MACOS_INSTALL.md](../MACOS_INSTALL.md).
