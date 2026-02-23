# Hymnary Plugin

## Table of Contents
* [Overview](#hymnary-overview)
* [What It Adds](#hymnary-what-it-adds)
* [How It Works](#hymnary-how-it-works)

---

<a id="hymnary-overview"></a>
## Overview

The Hymnary plugin searches Hymnary.org and inserts public-domain hymn lyrics as markdown slides.

---

<a id="hymnary-what-it-adds"></a>
## What It Adds

- Hymn search dialog with language/filter support
- Lyrics fetch and parsing from hymn pages
- Verse/refrain-aware slide generation
- Optional append into the active presentation

---

<a id="hymnary-how-it-works"></a>
## How It Works

The plugin queries Hymnary exports (CSV) for search, fetches selected hymn pages, parses lyrics and metadata, then produces slide-separated markdown.
