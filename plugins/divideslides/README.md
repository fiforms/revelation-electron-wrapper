# Divide Slides Plugin

Splits long slides, such as song verses or pasted paragraphs, into several shorter slides. It is enabled by default.

## Usage

In the builder, open the **Content** menu and choose **Divide Slides**. The dialog offers:

- **Apply to**: all slides in the current column, or the current slide only.
- **Maximum lines per slide** (default 4).
- **Maximum words per slide** (optional, off by default; 40 when enabled). Whichever limit is hit first starts a new slide.
- **Find natural breaks**: prefer to break after punctuation instead of at a raw cutoff.
- **Avoid orphaned lines**: on by default; avoids leaving a single short line on its own slide.

---

## What is left alone

Macro lines (`:hide:`, `:credits:`, `{{transition}}`, attribution and AI-disclosure lines), images, table rows and raw
HTML are never split by words and are kept with their slide. Hard line breaks (two trailing spaces or a backslash) are
preserved.

## Configuration

None. The plugin has no settings, IPC or network access; its code runs in the builder only (`client.js` registers the
menu entry and loads `builder.js` on demand).
