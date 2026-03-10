# REVELation Presentations (WordPress Plugin)

Host REVELation presentations inside WordPress, serve them from clean routes, and optionally pair a REVELation desktop client for incremental publishing.

## Major Features

- Import REVELation ZIP exports from `WP Admin -> REVELation -> Presentations`
- Serve presentations from WordPress routes:
  - `/_revelation/{slug}`
  - `/_revelation/{slug}/embed`
- Render directly from Markdown files inside the imported presentation package
- Support multiple Markdown entry files per presentation with a built-in selector on hosted pages
- Embed presentations with shortcode:
  - `[revelation slug="my-slug" md="presentation.md" embed="1"]`
- Store and index imported presentations in a custom table:
  - `{$wpdb->prefix}revelation_presentations`

## Import and Storage Safety

- ZIP extraction includes path traversal protection
- Imported file types are filtered through a configurable extension allowlist
- Uploaded `*.html` files are dropped during import
- `_resources/*` is restricted so only allowed runtime assets and media survive import
- Presentation file access is sanitized for slug and Markdown relative paths before rendering

## Hosted Runtime Features

- Bundled offline runtime assets copied from the REVELation client build
- Optional global splash screen toggle for hosted presentations
- Optional shortcode embed toggle
- Configurable Reveal Remote server URL
- Presenter plugin socket URL is derived automatically from the Reveal Remote server using:
  - `/presenter-plugins-socket`

## Bundled Hosted Plugins

The WordPress plugin can globally enable these hosted runtime plugins from `REVELation -> Settings`:

- `highlight`
- `markerboard`
- `slidecontrol`
- `revealchart`
- `credit_ccli`

When enabled, they are injected into every hosted presentation and embed rendered by this plugin.

## Desktop Pairing and Publish

This plugin includes a desktop publish protocol for the matching REVELation `wordpress_publish` client plugin.

### Pairing Flow

- Desktop requests a one-time challenge from WordPress
- Desktop signs the challenge with its local RSA private key
- WordPress creates a pending pairing request
- A WordPress administrator explicitly approves or rejects the request
- Desktop polls for approval status and stores the resulting pairing credentials locally

### Publish Flow

- Desktop regenerates a presentation manifest before upload
- WordPress compares the local manifest with the hosted copy and asks only for changed or missing files
- Desktop uploads only the required files
- WordPress commits the new manifest, updates the presentation index, and returns the final presentation URL

### Publish Security

- Pairing is RSA challenge-response only
- Publish requests require:
  - `pairingId`
  - `publishToken`
  - RSA request signature from the paired client key
  - timestamp
  - nonce
  - payload hash
- Publish nonces are single-use to reduce replay risk
- Timestamp skew is checked server-side
- Pairing and publish over HTTPS use normal TLS certificate validation on the desktop client
- HTTP-only sites are still allowed, but the desktop client warns because transport security is absent

### Publish Endpoints

- `POST /wp-json/revelation/v1/pair/challenge`
- `POST /wp-json/revelation/v1/pair`
- `POST /wp-json/revelation/v1/pair/status`
- `POST /wp-json/revelation/v1/publish/check`
- `POST /wp-json/revelation/v1/publish/file`
- `POST /wp-json/revelation/v1/publish/commit`

## Settings

Available under `WP Admin -> REVELation -> Settings`:

- Reveal Remote URL
- Max ZIP size
- Max publish upload request size
- Allowed file extensions
- Allow shortcode embeds
- Show splash screen
- Use DB index
- Desktop pairing URL copy helper
- Globally enabled hosted runtime plugins
- Pending pairing request approval/rejection UI
- Paired client management UI

## Folder Layout

- `revelation-presentations.php`: plugin bootstrap
- `includes/`: WordPress plugin classes
- `templates/presentation.php`: hosted presentation template
- `assets/runtime/`: bundled REVELation runtime JS/CSS
- `assets/plugins/`: bundled hosted plugin assets
- `scripts/sync-runtime-assets.sh`: copies runtime and hosted plugin assets into the WordPress plugin
- `scripts/package-plugin.sh`: builds the distributable plugin ZIP

## Refresh Runtime Assets

After changing REVELation runtime or bundled hosted plugin assets:

```bash
bash WordPress/revelation-presentations/scripts/sync-runtime-assets.sh
```

This syncs:

- `assets/runtime/*`
- `assets/plugins/highlight/*`
- `assets/plugins/markerboard/*`
- `assets/plugins/slidecontrol/*`
- `assets/plugins/revealchart/*`
- `assets/plugins/credit_ccli/*`

## Build Plugin ZIP

```bash
bash WordPress/revelation-presentations/scripts/package-plugin.sh
```

Output:

- `WordPress/build/revelation-presentations.zip`

## Current Limitations

- No front-end listing/archive page for all hosted presentations
- Hosted plugin configuration is global, not per presentation
- The bundled hosted plugin list is fixed in code; there is not yet a separate WordPress extension registration system
