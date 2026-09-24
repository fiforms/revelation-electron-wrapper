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

## Browse and Sync Hosted Presentations

Open `Presentation -> WordPress Sync...` from the main menu to see every presentation hosted on a paired site.

1. Pick the site from the list at the top. `Manage Sites...` opens the pairing window.
2. Each hosted presentation has a status dot:
   - green: **Synced locally**. A local presentation is linked to it, either because you published or imported it, or because exactly one local presentation has the same presentation ID.
   - blue: **Server only**. You have no local copy.
3. Click `Sync` on a green row to run a two-way sync for that presentation. Click `Import` on a blue row to download it into a new local presentation, named after the hosted slug when that name is free.
4. The `...` menu opens the hosted presentation (one entry per Markdown file) or copies its link.

Use the filter box to narrow the list by title or slug.

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
- Main menu: `Presentation -> WordPress Sync...`
- Sync window:
  - list hosted presentations on a paired site, with local sync status
  - sync linked presentations, import server-only ones
  - open or copy links to hosted presentations
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
- `POST /wp-json/revelation/v1/publish/pull`
- `POST /wp-json/revelation/v1/publish/list`
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
- Each presentation manifest carries a persistent `presentationId` (UUID). It is created once, kept across manifest rewrites, and travels with the folder (cloud sync, ZIP, Import from URL).
- A desktop with no mapping yet binds to an existing hosted copy when both the `presentationId` and the local folder name match. This is how the same cloud-synced folder, published from several desktops, shares one hosted copy. A duplicated folder (same ID, different name) gets its own hosted copy, so it can never overwrite the original.
- A desktop that knows a hosted copy from its sync record (for example after Import from URL) requests that slug explicitly with `targetRemoteSlug`, so publishing lands there under any local slug. A target whose `presentationId` differs is refused, not overwritten.
- Binding to a copy another pairing created requires the WordPress setting **Allow Shared Presentation Updates** (on by default). When it is off, each desktop can only update presentations it published itself.
- Hosted manifests record `siteUrl`, `remoteSlug`, and `presentationId`. A WP admin rename updates `remoteSlug` and the publish mappings.

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

## Presentation Sync Peers

The desktop keeps a per-machine record of where each presentation was published to or imported from, in `sync-peers.json` in the app user-data folder (next to `config.json`). Entries are keyed by the presentation folder's resolved path.

- A successful publish records a `wordpress` peer (`siteBaseUrl`, `siteName`, `remoteSlug`, `pairingId`, `presentationUrl`) and, on sync-capable sites, a `base` snapshot (`revision` plus each file's `sha1` and `size` as of the last sync).
- Import from URL records a `url` peer (`sourceUrl`, `baseUrl`, `manifestUrl`). When the source is a presentation hosted by the WordPress plugin, it also records a `wordpress` peer (site and remote slug, with a base snapshot from the hosted manifest), so publishing to a paired copy of that site syncs back into the same hosted presentation.
- Peers are keyed by site + remote slug (or base URL), so re-publishing updates the existing entry.

The record deliberately lives outside the presentation folder. Presentation folders are often cloud-synced, and a base snapshot that reaches another machine before the files it describes would make that machine push stale content. Moving or renaming a presentation folder orphans its entry; the next publish then behaves like a first sync, which is safe.

## Two-Way Sync Flow

When the WordPress plugin reports `syncProtocol >= 1` from `/publish/check`, publishing becomes a sync:

1. Desktop sends `syncProtocol` with `/publish/check`. WordPress returns the remote `revision`, `remoteFiles` (server-computed `sha1`/`size`), and `acceptedFiles`.
2. Desktop compares local, remote, and the peer's `base` for each file:
   - changed only locally: upload
   - changed only remotely: download
   - changed on both sides: conflict
3. Conflicts show one dialog: **Keep my versions**, **Keep server versions**, or **Cancel**. The losing version of each file is saved under `.sync-conflicts/<timestamp>/` in the presentation folder, which is excluded from publish and ZIP export.
4. Downloads go through the authenticated, chunked `/publish/pull`. Each file is verified against the server's size and sha1, then moved into place with the remote modified time.
5. Uploads and `/publish/commit` carry `baseRevision`. WordPress answers `409 revision_mismatch` if another publish committed in the meantime.
6. Commit runs under a per-presentation lock, recomputes hashes from disk, increments `revision`, and returns the committed file list, which becomes the new `base`.

No-base behavior (first sync against a site): newer `modified` wins, and files that exist only on the server are dropped from the manifest instead of downloaded, matching the old publish behavior.

Phase 2 never deletes files. A local deletion drops the file from the hosted manifest (the file stays on the server disk), unless the server changed that file since the base, in which case it is downloaded again. A file missing on the server is uploaded again.

Files the site refuses (for example an extension missing from **Allowed File Extensions**) are listed in a warning after publishing.

Older WordPress plugins without `syncProtocol` get the previous push-only publish.

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
- `allow_shared_presentation_updates`
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

- Sync conflicts are resolved all-or-nothing (keep all local or all server versions), not per file.
- Sync never deletes files; deletions only drop them from the hosted manifest.
- Renaming or duplicating a local presentation folder starts a new hosted copy (the folder name is part of how a copy is matched).
- Shared media sync is one-way from desktop to WordPress.
- Hosted runtime plugin configuration is global on the WordPress side, not per presentation.
