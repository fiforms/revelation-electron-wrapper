# FreeShow Export Plugin

Exports a presentation as a [FreeShow](https://freeshow.app/) project file.

## Usage

Open **Export** for a presentation and choose **FreeShow (.project)**. A native Save dialog asks where to write the
file. Nothing is sent over the network.

## Options

- **Include speaker notes / description as slide notes** (default on): copies the presentation's `description`
  front-matter field into the notes of the first slide.

---

## What is converted

- Slides are split on `---` lines. Each slide becomes one FreeShow text item.
- Inline markdown (bold, italic and so on) is converted to styled text runs.
- `:shortcode:` macro blocks and `{{...}}` template expressions are dropped.
- Each slide gets a FreeShow group from its first line: `#` heading = Intro, `>` quote = Quote, `:` macro = Info,
  anything else = Verse.
- Italic-only lines are treated as labels: left-aligned before the main text, right-aligned after it.

Images, video, backgrounds and transitions are not exported.

## Configuration

None.
