# Markerboard Plugin

## Table of Contents
* [Overview](#markerboard-overview)
* [What It Adds](#markerboard-what-it-adds)
* [Controls](#markerboard-controls)
* [Data Model](#markerboard-data-model)
* [Realtime Sync](#markerboard-realtime-sync)
* [Plugin Settings](#markerboard-plugin-settings)
* [Current Notes](#markerboard-current-notes)

<a id="markerboard-overview"></a>
## Overview

The Markerboard plugin adds a draw-on-top annotation layer for Reveal presentations.

It is designed around slide-space coordinates so annotations stay aligned with slide content across different display sizes.

<a id="markerboard-what-it-adds"></a>
## What It Adds

- Toggleable marker overlay in presentation view
- Per-slide annotation storage
- Pen, highlighter, and eraser tools
- Color palette and width slider
- Per-slide clear and step-by-step undo
- Transition-aware hide/fade/repaint behavior
- Optional realtime sync channel for shared presentations

<a id="markerboard-controls"></a>
## Controls

- Context menu:
- `Markerboard: Enable/Disable`
- `Markerboard: Undo`

- Left toolbar (when enabled):
- `✏️` pen
- `🖍️` highlighter
- `🧽` eraser
- color circles
- `📏 Width` slider
- `↩️` undo
- `🗑️` clear current slide
- `✖️` disable markerboard

<a id="markerboard-data-model"></a>
## Data Model

The runtime uses an operation-based in-memory document:

- `doc` with `coordinateSpace`, `slides`, `opLog`
- per slide:
- `strokes` map
- draw `order`
- `tombstones`

Primary op types:

- `begin_stroke`
- `append_points`
- `end_stroke`
- `clear_slide`

Coordinates are stored in slide units (`config.width`/`config.height`), not raw viewport pixels.

<a id="markerboard-realtime-sync"></a>
## Realtime Sync

Markerboard can sync through a shared presenter plugin socket path:

- Socket path: `/presenter-plugins-socket`
- Event channel: `presenter-plugin:event`
- Plugin scope: `markerboard`

Room resolution behavior:

- Follower/shared URLs: use `remoteMultiplexId` query parameter
- Master URLs: if no query param exists, room lookup can be resolved from the same local storage presentation mapping used by share-link logic, and only when markerboard is enabled

Realtime payloads currently include:

- `markerboard-op`
- `markerboard-snapshot`
- `markerboard-request-snapshot`
- `markerboard-enabled`

Append-point operations are batched before emit (configurable in `client.js`).

<a id="markerboard-plugin-settings"></a>
## Plugin Settings

- `allowPeerFirstToggle` (boolean, default `true`)
- When `true`, master attempts room connection on load (via stored multiplex id) so a connected peer can toggle markerboard first and have it sync immediately to all clients.
- When `false`, master keeps previous behavior and typically joins the room only when markerboard is enabled locally.

- `publicMode` (boolean, default `true`)
- When `true`, any connected peer in the multiplex room can draw and broadcast markerboard changes.
- When `false`, follower sessions become view-only and only the presenter/master session can draw, clear, restore, import, or broadcast markerboard enabled-state changes.
- Permission model note: `publicMode` is client-enforced behavior (cooperative access control), not server-side authorization.

<a id="markerboard-current-notes"></a>
## Current Notes

- Current persistence is in-memory during runtime.
- Realtime support is intentionally lightweight and meant as a base for further hardening.
- If no multiplex room id can be resolved, socket sync is skipped and markerboard remains local-only.
