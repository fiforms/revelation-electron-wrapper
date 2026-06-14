# Flickr Plugin

Browse [Flickr](https://www.flickr.com) inside an embedded browser window and
import downloaded photos directly into the shared media library (`_media`), with
metadata filled in automatically.

> **Licenses vary.** Unlike a CC0-only source, Flickr photos carry many different
> licenses (All Rights Reserved, the various Creative Commons licenses, CC0,
> Public Domain). The plugin scrapes each photo's license — it never assumes one —
> so you can respect the photographer's terms before using an image.

## How it works

1. A **📷 Flickr** button appears in the sidebar (under *Plugins*). Click it to
   open the embedded browser at `https://www.flickr.com/explore`. The button uses
   the core `pluginButtons` action hook — `{ title, action: 'open-explorer' }` —
   which calls the plugin's `open-explorer` api method directly (no page nav).
2. The browser uses a persistent session partition (`persist:flickr`), so you stay
   logged in between sessions. Authentication via Flickr/SmugMug and the
   **Google / Apple / Facebook** sign-in options runs inside the embedded browser
   (popups included). Any other off-site link opens in your system browser.
3. When you download a photo, the file is captured automatically and imported into
   the media library. A toast confirms the import and shows the detected license.

## Metadata extraction

For a downloaded photo the plugin records:

| Field         | Source                                                            |
|---------------|-------------------------------------------------------------------|
| Title         | JSON-LD `name` / `og:title` / page title                          |
| Attribution   | Photographer — JSON-LD author, owner-name element, or `/photos/<user>/` |
| License       | Creative Commons link on the page (mapped to e.g. `CC BY-SA 2.0`), JSON-LD `license`, or "All Rights Reserved" |
| Description   | JSON-LD `description` / `og:description` / `meta[name=description]` |
| url_direct    | The `staticflickr.com` download URL                               |
| url_origin    | The Flickr photo page URL                                         |

Detection is heuristic. If Flickr's markup changes, you can pin exact CSS
selectors in **Settings → Flickr**:

- `titleSelector`
- `descriptionSelector`
- `attributionSelector`
- `licenseSelector`

Leave them blank to use auto-detection.

## Enabling

Enable **Flickr** in **Settings → Plugins**, then relaunch.
