# MediaFX Plugin

## Table of Contents
* [Overview](#mediafx-overview)
* [What It Adds](#mediafx-what-it-adds)
* [How It Works](#mediafx-how-it-works)
* [Using the Preset Gallery](#mediafx-preset-gallery)
* [Advanced Effect Layering](#mediafx-advanced-layering)
* [Resize and Output Notes](#mediafx-resize-output)

---

<a id="mediafx-overview"></a>
## Overview

The MediaFX plugin applies visual effects/transforms to media and helps insert results into presentations.

It combines two effect engines:

- `ffmpeg`: a widely used and powerful command-line video processing tool
- `effectgenerator`: the custom REVELation backend for advanced/custom effect pipelines

---

<a id="mediafx-what-it-adds"></a>
## What It Adds

- Effect listing and effect execution workflows
- Media picker and save dialogs
- Preset save/load support
- Batch and process-managed media conversion paths
- Video resize/format conversion workflows

---

<a id="mediafx-how-it-works"></a>
## How It Works

The plugin coordinates UI dialogs, runs effect pipelines (effectgenerator and ffmpeg-backed flows), tracks active jobs, and returns output media for insertion into presentations.

When multiple effects are applied, ffmpeg-based effects are processed first, then additional effectgenerator processing continues on the output.

---

<a id="mediafx-preset-gallery"></a>
## Using the Preset Gallery

The easiest workflow is choosing a preset from the built-in gallery:

1. Open MediaFX.
2. Pick a source media file.
3. Choose a gallery preset.
4. Render and save/insert the result.

This is the fastest way to get polished effects without manual tuning.

---

<a id="mediafx-advanced-layering"></a>
## Advanced Effect Layering

For more control, build your own pipeline by selecting and stacking one or more effects.

- Mix and match effect steps for custom looks
- Tune parameters per effect
- Save and reload presets for repeatable workflows

Caveat:
- ffmpeg effects are always executed first in the pipeline.

---

<a id="mediafx-resize-output"></a>
## Resize and Output Notes

MediaFX can also be used to resize video output for specific presentation or export needs.

Audio note:
- Videos produced through effect pipelines are generally silent.
- If you need audio, use an external video editor to merge/recover audio.
- Future versions may add better audio handling directly in MediaFX.
