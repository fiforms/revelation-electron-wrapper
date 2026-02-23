---

# Installing From Source

---

## Table of Contents
* [Overview](#install-overview)
* [Clone With Submodules](#install-clone)
* [Install and Run Framework](#install-framework)
* [Install and Run Wrapper](#install-wrapper)

---

<a id="install-overview"></a>

## Overview

Use this guide if you are developing locally or manually installing from source.

---

<a id="install-clone"></a>

## Clone With Submodules

```bash
git clone --recursive https://github.com/fiforms/revelation-electron-wrapper.git
cd revelation-electron-wrapper
```

---

<a id="install-framework"></a>

## Install and Run Framework

Install dependencies for the `revelation/` submodule and run it once to verify setup:

```bash
cd revelation
npm install
npm run build
npm run dev
# Ctrl-C to exit
```

---

<a id="install-wrapper"></a>

## Install and Run Wrapper

Return to the repository root and start the Electron wrapper:

```bash
cd ..
npm install
npm start
```
