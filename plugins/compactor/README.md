# Compactor Plugin

Adds a Presentation List context-menu action:

- `Compact Presentation...`

## What it does

1. Prompts for compaction settings when launched.
2. Copies the selected presentation folder into a new `<slug>_compacted` folder (or `<slug>_compacted_2`, etc. if needed).
3. Recursively compacts image assets in the copied folder to a fixed maximum width/height and quality.
4. Optionally converts PNG files to `webp` or `avif`.
5. Optionally converts JPG/JPEG files to `webp` or `avif`.
6. Optionally compacts video assets with the same max dimensions and a configurable quality level.
7. Rewrites relative media references in copied `.md` files when converted image filenames/extensions change.
8. Shows live status in the Presentation List page, including progress text like:
   - `Compacting 3 of 29 assets...`

## Implementation Notes

- Compaction is performed with `ffmpeg` for both images and videos.

## Defaults

- Max dimensions: `1920x1080`
- Image quality: `85%`
- Compact video: disabled by default
- Video quality (if enabled): `85%`
- PNG conversion target: `none` (no conversion)
- JPG/JPEG conversion target: `none` (no conversion)
