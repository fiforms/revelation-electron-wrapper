# Slide Sorter Plugin

## Overview

Adds a builder-only slide sorter mode with draggable slide tiles.

## What It Adds

- `Slide Sorter` mode button in Builder preview header
- Tile-based sorter overlay for rapid structural editing
- Drag-and-drop slide reordering
- Double-click tile to navigate to that slide and exit sorter mode
- Right-click slide menu:
  - Insert Slide After
  - Duplicate Slide
  - Delete Slide
- Right-click column chip menu (top strip):
  - Insert Column After
  - Delete Column

## Behavior

- Single-column decks:
  - Slides render in left-to-right wrapping grid order
- Multi-column decks:
  - Slides render by Reveal horizontal/vertical structure
  - Matrix supports 2D scrolling for large shows
- Tile rendering is intentionally simplified:
  - Heading text large
  - Body text compact
  - Image references shown as chips
  - `||` two-column markdown layout preview when detected
- Slides with top matter (`slide.top`) show a red indicator bar

## Notes

- This plugin is builder-only and lazy-loads `builder.js` from `client.js`.
- Reordering commits through `host.transact(... tx.replaceStacks(...))`.
