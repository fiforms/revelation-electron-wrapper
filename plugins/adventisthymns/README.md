# Adventist Hymns Plugin

## Table of Contents
* [Overview](#adventisthymns-overview)
* [What It Adds](#adventisthymns-what-it-adds)
* [How It Works](#adventisthymns-how-it-works)

---

<a id="adventisthymns-overview"></a>
## Overview

The Adventist Hymns plugin converts hymns into slide-ready markdown. It loads a hymn index (cached 24h) and public-domain lyrics from `pastordaniel.net/bigmedia/adventisthymns`, and scrapes other hymns from AdventistHymns.com.

---

<a id="adventisthymns-what-it-adds"></a>
## What It Adds

- A hymn search dialog in the app
- Automatic parsing of hymn slides from source HTML
- Title slide + verse/refrain slide generation
- Optional direct append into the active presentation markdown

---

<a id="adventisthymns-how-it-works"></a>
## How It Works

The plugin opens its search UI, fetches hymn pages, parses slide sections, and converts content into markdown separated for Reveal slides.
