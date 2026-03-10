# REVELation Presentations (WordPress Plugin)

First-pass plugin scaffold for importing REVELation ZIP exports and serving them from WordPress routes under `/_revelation/{slug}`.

## Features in this first pass

- Admin upload screen (`WP Admin -> REVELation -> Presentations`)
- Safe ZIP extraction with path traversal protection
- Sanitization during import:
  - Drops `*.html` from uploaded ZIPs
  - Drops most `_resources/*` except `_resources/_media/*`
  - Applies extension allowlist from settings
- Custom rewrite endpoints:
  - `/_revelation/{slug}`
  - `/_revelation/{slug}/embed`
- Dynamic runtime rendering with bundled REVELation assets
- Shortcode support:
  - `[revelation slug="my-slug" md="presentation.md" embed="1"]`
- Settings page for:
  - Reveal Remote URL
  - max ZIP size
  - extension allowlist
  - DB index toggle
  - embed toggle
- Custom DB table for indexing:
  - `{$wpdb->prefix}revelation_presentations`
- Pairing API scaffold for desktop publish clients:
  - `POST /wp-json/revelation/v1/pair/challenge`
  - `POST /wp-json/revelation/v1/pair`
  - `POST /wp-json/revelation/v1/pair/status`
  - `POST /wp-json/revelation/v1/publish/check`
  - `POST /wp-json/revelation/v1/publish/file`
  - `POST /wp-json/revelation/v1/publish/commit`
  - Supports RSA challenge-response mode
  - Requires explicit WordPress admin approval for each pairing request

## Folder layout

- `revelation-presentations.php`: plugin bootstrap
- `includes/`: plugin classes
- `templates/presentation.php`: runtime render template
- `assets/runtime/`: bundled JS/CSS runtime files
- `scripts/`: helper scripts for asset sync/package

## Runtime assets

This plugin currently bundles runtime assets copied from this repo:

- `revelation/dist/js/offline-bundle.js`
- `revelation/dist/css/*`
- `revelation/js/translate.js`
- `revelation/js/translations.json`
- `revelation/node_modules/reveal.js/dist/reveal.css`

To refresh runtime assets after REVELation changes:

```bash
bash WordPress/revelation-presentations/scripts/sync-runtime-assets.sh
```

## Package plugin zip

```bash
bash WordPress/revelation-presentations/scripts/package-plugin.sh
```

Output zip:

- `WordPress/build/revelation-presentations.zip`

## Notes

- This is a rough first pass for feasibility and architecture.
- It does not yet expose a front-end listing page.
- Plugin loader endpoints for REVELation plugins are not implemented yet (runtime tolerates missing plugin list).
- Publish endpoint and actual content push from desktop are not implemented yet; pairing currently stores client records and returns a placeholder publish endpoint.
- Route rules are flushed on plugin activation/deactivation.
