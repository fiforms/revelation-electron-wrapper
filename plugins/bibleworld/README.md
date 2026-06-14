# BibleWorld.ai Plugin

Browse [bibleworld.ai](https://bibleworld.ai) inside an embedded browser window and
import downloaded media directly into the shared media library (`_media`), with
metadata filled in automatically. Everything on the site is licensed **CC0**.

## How it works

1. A **📖 BibleWorld.ai** button appears in the sidebar (under *Plugins*). Click
   it to open the embedded browser at `https://bibleworld.ai/explore`. The button
   uses the core `pluginButtons` action hook — `{ title, action: 'open-explorer' }`
   — which calls the plugin's `open-explorer` api method directly (no page nav).
2. The browser uses a persistent session partition (`persist:bibleworld`), so you
   stay logged in between sessions. Authentication via **Auth0** and the
   **Google / Microsoft / Facebook** OAuth providers runs inside the embedded
   browser (popups included). Any other off-site link opens in your system
   browser instead.
3. When you trigger a download on the site, the file is captured automatically and
   imported into the media library. A toast confirms the import.

## Metadata extraction

For a download such as:

```
https://cdn.bibleworld.ai/bible-world/generations/<uuid>.png?dl=The%20Compassionate%20Mercy%20of%20the%20Savior.png&format=png
```

the plugin records:

| Field        | Source                                                        |
|--------------|---------------------------------------------------------------|
| Title        | `dl` query parameter (filename without extension)             |
| Attribution  | Scraped from the originating item page (creator link/handle)  |
| License      | `CC0` (fixed — all site assets are CC0)                       |
| Description   | Scraped from the page (`og:description` / `meta[name=description]`) |
| url_direct    | The CDN download URL                                          |
| url_origin    | The bibleworld.ai item page URL                              |

Title and description detection are reliable; attribution uses heuristics. If the
site markup changes, you can pin exact CSS selectors in **Settings → BibleWorld.ai**:

- `titleSelector`
- `descriptionSelector`
- `attributionSelector`

Leave them blank to use auto-detection.

## Enabling

Enable **BibleWorld.ai** in **Settings → Plugins**, then relaunch.
