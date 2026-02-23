# Virtual Bible Snapshots Plugin

## Table of Contents
* [Overview](#virtualbiblesnapshots-overview)
* [What It Adds](#virtualbiblesnapshots-what-it-adds)
* [How It Works](#virtualbiblesnapshots-how-it-works)
* [Configuration](#virtualbiblesnapshots-configuration)

---

<a id="virtualbiblesnapshots-overview"></a>
## Overview

This plugin interfaces with the 
[Virtual Bible Snapshot Project](https://snapshots.vrbm.org/), allowing the user to search and directly importassets into presentations or the shared media library.

The [Virtual Bible Snapshots Collection](https://snapshots.vrbm.org/)
includes over 10,000 Bible-focused visual resources for teaching and preaching, including:

- Motion backgrounds
- AI-generated images
- Photographs of the Holy Land
- Other media assets for Bible classes, sermons, and presentation slides

---

<a id="virtualbiblesnapshots-what-it-adds"></a>
## What It Adds

- Search dialog for VRBM media
- Download into current presentation or `_media`
- Sidecar metadata generation (attribution, license, AI flags, origin URLs)
- Optional high-bitrate variant handling
- Builder workflow support for direct insertion while editing slides

---

Import options:

- Import directly into `_media` (shared media library) for reuse
- Import directly into the current presentation for fast slide-building workflows

---

<a id="virtualbiblesnapshots-how-it-works"></a>
## How It Works

The plugin queries remote catalog endpoints, lets users pick assets, downloads files, stores metadata, and inserts markdown/media references into the target presentation.

---

<a id="virtualbiblesnapshots-configuration"></a>
## Configuration

Key settings:

- `apiBase`: Virtual Bible Snapshot API base URL
- `libraries`: comma-separated remote library paths
- `downloadIntoMedia`: store into `_media` and use aliases
