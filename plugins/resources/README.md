# Resources Plugin

## Table of Contents
* [Overview](#resources-overview)
* [What It Adds](#resources-what-it-adds)

<a id="resources-overview"></a>
## Overview

The Resources plugin adds a static help page to the plugin sidebar: an About tab for REVELation, plus Images & Media and Text & Editors tabs listing external tools and sites. It does not manage or attach files to presentations. Localized variants (`index.<lang>.html`, currently `es` and `fr`) are picked automatically from the app language or `?lang=`.

<a id="resources-what-it-adds"></a>
## What It Adds

- A "Resources" plugin button that opens `index.html` (tabs handled by `resources.js`)
- No client hook, IPC channels or config; external links open through `electronAPI.openExternalURL`

This plugin is intentionally lightweight and primarily UI-routing focused.
