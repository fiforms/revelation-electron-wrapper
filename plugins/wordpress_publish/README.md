# WordPress Publish

`wordpress_publish` connects the REVELation desktop app to the `revelation-presentations` WordPress plugin so you can:

- pair a desktop instance with a WordPress site
- publish a presentation directly from the presentation list
- re-publish changes incrementally instead of re-uploading everything
- mirror the desktop shared `_media` library to WordPress for hosted `media:` aliases

This README covers the full workflow from first-time setup through publish, media sync, and server-side behavior. The technical reference is at the end.

## What This Feature Does

After pairing, a presentation can be published from REVELation desktop to a WordPress site that has the matching `revelation-presentations` plugin installed.

The WordPress plugin then:

- stores the presentation under WordPress uploads
- serves it from clean hosted routes
- keeps a per-site pairing trust record
- accepts incremental presentation updates from the paired desktop
- optionally uses a mirrored shared media library for hosted `media:` references

This is meant for a one-way desktop-to-WordPress workflow. WordPress is the hosted destination, not the editing source of truth.

## Requirements

You need all of the following:

1. REVELation desktop with the `wordpress_publish` plugin available and enabled.
2. A WordPress site with the `revelation-presentations` plugin installed and activated.
3. WordPress admin access so you can approve pairing requests.
4. A presentation in your local REVELation presentations folder.

Recommended:

- Use `https://` for the WordPress site.
- Avoid self-signed or mismatched TLS certificates unless you intentionally plan to use plain HTTP.

Important:

- HTTPS is validated normally by the desktop app.
- Invalid/self-signed/mismatched TLS certificates will fail pairing and publish.
- Plain `http://` sites are allowed, but the desktop UI warns because pairing and publish traffic are not transport-protected.

## The Two Pieces

This feature has two parts:

### Desktop side: `wordpress_publish`

This is the REVELation desktop plugin that:

- opens the WordPress publish window from a presentation card
- stores paired site records in desktop config
- signs pairing and publish requests with the desktop RSA key
- uploads changed presentation files only
- syncs shared media files only when needed

### WordPress side: `revelation-presentations`

This is the WordPress plugin that:

- hosts imported and published REVELation presentations
- provides the pairing and publish API
- lets an admin approve or reject pending desktop pairing requests
- stores trusted paired instances
- serves presentations from `/_revelation/{slug}`
- optionally serves hosted `media:` aliases from a mirrored shared library

## First-Time Setup

### 1. Install and activate the WordPress plugin

Install `revelation-presentations` on your WordPress site and activate it.

Then open:

- `WordPress Admin -> REVELation -> Settings`

### 2. Check WordPress settings

At minimum, review these settings:

- `Reveal Remote URL`
- `Max Publish Upload Request (MB)`
- `Use Shared Media Library`
- `Hosted Runtime Plugins`

Notes:

- `Use Shared Media Library` only matters if you plan to sync shared `_media`.
- `Hosted Runtime Plugins` are loaded for every presentation served by the WordPress plugin.
- The settings page also shows the desktop pairing URL and the pairing approval tables.

### 3. Enable the desktop plugin

In REVELation desktop:

1. Open `Settings`.
2. Make sure the `wordpress_publish` plugin is enabled.
3. Save settings if needed.

### 4. Open the publish window

In the presentation list:

1. Right-click a presentation card.
2. Click `WordPress Publish...`.

That opens the pairing/publish window for the selected presentation.

## Pair a WordPress Site

### WordPress side

In `WordPress Admin -> REVELation -> Settings`, copy the value shown under:

- `Desktop Pairing URL`

You can paste either:

- the full pairing URL, such as `https://example.org/wp-json/revelation/v1/pair`
- or the site base URL, such as `https://example.org`

The desktop plugin normalizes either form.

### Desktop side

1. Open the `WordPress Publish...` window from a presentation card.
2. Paste the pairing URL or site base URL into `Pairing URL`.
3. Click `Pair Site`.
4. If the site uses plain HTTP, confirm the warning if you want to continue.
5. Wait for the window to show a pending approval message and one-time code.

### Approve on WordPress

In `WordPress Admin -> REVELation -> Settings`, look under `Pending Pairing Requests`.

You will see:

- request time
- request IP
- claimed hostname
- claimed desktop name
- desktop instance ID
- one-time code

Confirm the request matches the desktop you intend to trust, then click:

- `Approve`

If you do not trust it, click:

- `Reject`

### What happens next

The desktop plugin polls WordPress for approval status. When approval arrives:

- the site appears in the desktop `Destinations` list
- the desktop stores the returned pairing credentials locally
- future publish and media-sync actions can use that pairing

## Publish a Presentation

Once a site is paired:

1. Open `WordPress Publish...` from the presentation you want to publish.
2. In `Destinations`, find the paired site.
3. Click `Publish`.

The desktop plugin will:

1. rebuild the local presentation manifest
2. ask WordPress which files are missing or changed
3. upload only those files
4. commit the publish on the server

When it finishes, the status message includes the final hosted URL when available.

## Re-Publish an Updated Presentation

The normal publish button is also the update button.

If you change a presentation locally and publish again:

- unchanged files are skipped
- changed or missing files are uploaded
- the remote slug mapping is reused for that pairing and local slug

This is incremental publish, not a full ZIP re-import each time.

## Sync the Shared Media Library

Use this when your hosted presentations rely on shared `_media` content and you want WordPress to serve the same shared files.

From the desktop pairing window:

1. Find a paired destination.
2. Click `...`
3. Click `Sync Media Library`

The desktop plugin will:

1. regenerate the local shared `_media/index.json`
2. build a manifest of the shared `_media` library
3. ask WordPress which files are missing or changed
4. upload only those files
5. commit the sync and prune stale server files

This is a one-way mirror from desktop to WordPress.

## Enable Hosted Shared Media on WordPress

If you want hosted `media:` aliases to resolve from the mirrored shared library:

1. Pair the site.
2. Run `Sync Media Library` from the desktop plugin.
3. In WordPress, open `REVELation -> Settings`.
4. Enable `Use Shared Media Library`.
5. Save settings.

When enabled, hosted `media:` aliases resolve from:

- `wp-content/uploads/revelation-presentations/_shared_media`

instead of each presentation's local `_resources/_media` folder.

## Unpair a Site

There are two sides to unpairing.

### Remove it from the desktop app

In the desktop pairing window:

1. Find the paired destination.
2. Click `...`
3. Click `Unpair`

This removes the local stored pairing record from desktop config.

### Remove trust on the WordPress server

In `WordPress Admin -> REVELation -> Settings`, under `Paired Instances`:

1. Find the paired desktop instance.
2. Click `Delete`

This removes the trusted server-side pairing record.

For a full reset, remove the pairing on both sides.

## Help Button

The desktop pairing window includes a top-right `❔` help button. It opens this README in the REVELation handout viewer.

## Troubleshooting

### Pairing says pending but never completes

Check WordPress `REVELation -> Settings` and confirm:

- the request is present under `Pending Pairing Requests`
- you clicked `Approve`
- the one-time code matches the desktop window

If needed:

- reject the old request
- start pairing again

### Pairing disappears after settings changes

Desktop pairings are stored in plugin config. If you previously hit the older settings serialization bug, pair again once on a current build and the pairing should persist correctly.

### HTTPS pairing fails

The desktop client validates TLS certificates. Pairing and publish can fail if the certificate is:

- expired
- self-signed
- issued for the wrong hostname
- missing a valid chain

Fix the certificate, or use plain HTTP only if you accept the security risk.

### Publish fails with request too large / HTTP 413

This usually means the server rejected an upload request because of size limits.

Review:

- WordPress setting `Max Publish Upload Request (MB)`
- nginx `client_max_body_size`
- PHP `post_max_size`
- PHP `upload_max_filesize`

The desktop plugin also has a local pre-upload request size guard and will stop early when a chunk is estimated to exceed the allowed request size.

### Shared media does not appear on the hosted site

Check all of these:

- `Sync Media Library` completed successfully
- `Use Shared Media Library` is enabled in WordPress settings
- the hosted presentation actually references `media:` aliases that should resolve from shared media

### I approved the wrong desktop

In WordPress:

1. Go to `REVELation -> Settings`
2. Delete the paired instance from `Paired Instances`

Then remove the local pairing in the desktop app and pair again with the correct machine.

## Technical Reference

## User-Facing Entry Points

### Desktop UI

- Presentation list context menu: `WordPress Publish...`
- Pairing/publish window:
  - list paired destinations
  - pair a new site
  - publish current presentation
  - sync shared media
  - unpair destination

### WordPress UI

- `WP Admin -> REVELation -> Settings`
  - desktop pairing URL copy helper
  - pending pairing request approval/rejection
  - paired client deletion
  - upload, media, and runtime settings

## Hosted Routes

The WordPress plugin serves presentations from:

- `/_revelation/{slug}`
- `/_revelation/{slug}/embed`

The Markdown file can be chosen with:

- `?p=relative/path/to/file.md`

The WordPress shortcode is:

- `[revelation slug="my-slug" md="presentation.md" embed="1"]`

## REST Endpoints

- `POST /wp-json/revelation/v1/pair/challenge`
- `POST /wp-json/revelation/v1/pair`
- `POST /wp-json/revelation/v1/pair/status`
- `POST /wp-json/revelation/v1/publish/check`
- `POST /wp-json/revelation/v1/publish/file`
- `POST /wp-json/revelation/v1/publish/commit`
- `POST /wp-json/revelation/v1/media-sync/check`
- `POST /wp-json/revelation/v1/media-sync/file`
- `POST /wp-json/revelation/v1/media-sync/commit`

## Pairing Flow

1. Desktop requests a challenge from `/pair/challenge`.
2. WordPress returns a short-lived challenge and site metadata.
3. Desktop signs the challenge with its local RSA private key.
4. Desktop sends the signed pairing request to `/pair`.
5. WordPress verifies the signature and creates a pending request with a one-time code.
6. A WordPress admin approves or rejects the request.
7. Desktop polls `/pair/status`.
8. On approval, WordPress returns pairing credentials and the desktop stores them locally.

Current auth mode:

- RSA challenge-response only

## Publish Flow

1. Desktop regenerates local `manifest.json`.
2. Desktop calls `/publish/check` with the local manifest and pairing credentials.
3. WordPress resolves the remote slug for this pairing and local slug.
4. WordPress returns the changed or missing files only.
5. Desktop uploads required files through `/publish/file`.
6. Desktop calls `/publish/commit`.
7. WordPress updates the hosted presentation manifest/index and returns the hosted URL.

## Shared Media Sync Flow

1. Desktop regenerates local `_media/index.json`.
2. Desktop builds a shared media manifest.
3. Desktop calls `/media-sync/check`.
4. WordPress returns changed or missing shared media files only.
5. Desktop uploads required files through `/media-sync/file`.
6. Desktop calls `/media-sync/commit`.
7. WordPress updates the shared media mirror and prunes stale files.

## Remote Slug Mapping Rules

- WordPress may rename the remote slug to avoid conflicts.
- Mapping is persisted per pairing and local slug.
- The same paired desktop re-publishing the same local slug reuses the same remote slug.
- Different paired desktops can publish the same local slug without overwriting each other.

## Desktop-Stored Pairing Record

Desktop stores pairings in:

- `config.pluginConfigs.wordpress_publish.pairings[]`

Each record includes:

- `siteBaseUrl`
- `siteName`
- `siteUrl`
- `pairingId`
- `publishEndpoint`
- `publishToken`
- `authMode`
- `insecureTransport`
- `pairedAt`
- `localPublicKeyFingerprint`

## Desktop Plugin Config Keys

- `config.pluginConfigs.wordpress_publish.pairings`
- `config.pluginConfigs.wordpress_publish.maxUploadRequestBytes`
- `config.pluginConfigs.wordpress_publish.uploadChunkSizeBytes`

Defaults:

- `maxUploadRequestBytes = 921600`
- `uploadChunkSizeBytes = 8388608`

Notes:

- `maxUploadRequestBytes = 0` disables the local pre-upload guard.
- the desktop may also use the server-advertised limit from `/publish/check`

## WordPress Settings of Interest

- `reveal_remote_url`
- `max_zip_mb`
- `max_publish_request_mb`
- `allow_embed`
- `show_splash_screen`
- `use_db_index`
- `use_shared_media_library`
- `allowed_extensions`
- `enabled_runtime_plugins`

## WordPress Hosted Runtime Plugins

The current built-in hosted runtime catalog includes:

- `highlight`
- `markerboard`
- `slidecontrol`
- `revealchart`
- `credit_ccli`

These are enabled globally for all hosted presentations rendered by the WordPress plugin.

## Security Notes

- Pairing requires explicit WordPress admin approval.
- The desktop RSA private key never leaves the desktop app.
- Pairing and publish requests are signed.
- Publish requests require:
  - `pairingId`
  - `publishToken`
  - RSA request signature
  - timestamp
  - nonce
  - payload hash
- WordPress enforces timestamp/nonce checks to reduce replay risk.
- HTTPS uses normal TLS validation on the desktop client.
- HTTP-only sites are allowed, but transport security is absent.

## Current Limitations

- No desktop conflict-resolution UI beyond the current manifest-based publish behavior.
- Shared media sync is one-way from desktop to WordPress.
- Hosted runtime plugin configuration is global on the WordPress side, not per presentation.
