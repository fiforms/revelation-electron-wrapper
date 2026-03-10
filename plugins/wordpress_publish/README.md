# wordpress_publish Plugin

`wordpress_publish` is the REVELation desktop plugin scaffold for pairing with a WordPress site so presentations can be published later.

Current scope: pairing, incremental publish, and one-way shared media library sync.

## User Pairing Guide (Step by Step)

1. Install and activate the WordPress plugin `revelation-presentations` on your WordPress site.
2. In WordPress Admin, open `REVELation -> Settings`.
3. Copy the Desktop Pairing URL shown there (example: `https://your-site.com/wp-json/revelation/v1/pair`) or note the site base URL.
4. In REVELation desktop, open your Presentation List.
5. Right-click any presentation card.
6. Click `WordPress Publish: Pair Site…`.
7. In the pairing window, paste the WordPress URL.
8. Click `Pair Site`.
9. REVELation shows a one-time code and enters pending state.
10. In WordPress Admin `REVELation -> Settings`, review the pending request details:
   - Request IP
   - Claimed hostname
   - Claimed app name / instance ID
   - One-time code
11. Click `Approve` to trust that instance (or `Reject` to deny).
12. REVELation completes pairing after approval and the site appears in `Paired Sites`.
13. Click `Publish` next to a paired destination to send the currently selected presentation.
14. Open `...` next to a paired destination and click `Sync Media Library` to mirror the local desktop `_media` library to WordPress shared storage.

To unpair:
- In REVELation: open `...` and click `Unpair` in the plugin pairing window (local removal).
- In WordPress: delete the paired instance from the `Paired Instances` table (server-side trust removal).

## Protocol Overview

Pairing is RSA challenge-response only.

### Endpoints

- `POST /wp-json/revelation/v1/pair/challenge`
- `POST /wp-json/revelation/v1/pair`
- `POST /wp-json/revelation/v1/pair/status`
- `POST /wp-json/revelation/v1/publish/check`
- `POST /wp-json/revelation/v1/publish/file`
- `POST /wp-json/revelation/v1/publish/commit`
- `POST /wp-json/revelation/v1/media-sync/check`
- `POST /wp-json/revelation/v1/media-sync/file`
- `POST /wp-json/revelation/v1/media-sync/commit`

### Flow

1. Desktop requests a one-time challenge from WordPress (`/pair/challenge`).
2. WordPress returns:
   - `challenge`
   - `expiresInSeconds`
   - `siteName`
   - `siteUrl`
3. Desktop signs `challenge` with its existing local RSA private key (`config.rsaPrivateKey`).
4. Desktop sends `/pair` payload:
   - `auth.method = "rsa"`
   - `auth.challenge`
   - `auth.signature` (base64)
   - `auth.publicKey` (desktop RSA public key PEM)
   - `client` identity metadata (`appName`, `appInstanceId`, `appVersion`, `appPublicKey`)
5. WordPress verifies signature using OpenSSL and the provided public key.
6. If valid, WordPress creates a **pending** pair request with a one-time code.
7. A WordPress admin approves or rejects the request in settings UI.
8. Desktop polls `/pair/status` (signed with RSA key) until approved/rejected.
9. When approved, WordPress returns:
   - `pairingId`
   - `publishToken`
   - `publishEndpoint` (placeholder for future publish implementation)
   - `siteName`, `siteUrl`

### Local Data Stored by Desktop

Desktop stores pairings in plugin config at:

- `config.pluginConfigs.wordpress_publish.pairings[]`

Each pairing record includes:

- `siteBaseUrl`
- `siteName`
- `siteUrl`
- `pairingId`
- `publishEndpoint`
- `publishToken`
- `authMode` (`rsa`)
- `pairedAt`
- `localPublicKeyFingerprint`

### Security Notes

- No pre-shared key mode is enabled.
- Challenges are single-use and short-lived (WordPress transient).
- Pairing requires explicit WordPress admin approval before trust is granted.
- Private key never leaves desktop.
- Signature verification happens on WordPress server side.
- Publish requests now require both the long-lived publish token and an RSA signature from the paired desktop key, with timestamp and nonce checks to reduce replay risk.
- Desktop HTTPS requests rely on TLS certificate validation; invalid/self-signed/mismatched certificates fail pairing/publish unless the site is accessed over plain HTTP.
- HTTP-only WordPress sites are allowed but the desktop UI warns before pairing or publishing because transport security is absent.

## Publish Flow

1. Desktop regenerates local `manifest.json` before publish.
2. Desktop calls `/publish/check` with:
   - `pairingId`
   - `publishToken`
   - `localSlug`
   - full local manifest
3. WordPress resolves peer-scoped slug mapping (`pairing + localSlug -> remoteSlug`) and returns only changed/missing files.
4. Desktop uploads only required files via `/publish/file` in sequential chunks.
5. Desktop calls `/publish/commit` to finalize manifest/index updates.

## Shared Media Sync Flow

1. Desktop regenerates local `_media/index.json` from metadata sidecars.
2. Desktop builds a shared media manifest from the local `_media` folder.
3. Desktop calls `/media-sync/check` with the manifest.
4. WordPress returns only changed or missing shared media files.
5. Desktop uploads only required files via `/media-sync/file` in sequential chunks, including the regenerated `index.json`.
6. Desktop calls `/media-sync/commit` to finalize the shared media mirror manifest and prune stale server files.

When `Use Shared Media Library` is enabled in WordPress settings, hosted `media:` aliases resolve against the mirrored shared media library instead of each presentation's local `_resources/_media` folder.

### Slug Mapping Rules

- WordPress may silently rename remote slug to avoid conflicts.
- Mapping is persisted per pairing and local slug.
- Same peer + same local slug publishes to the same remote slug.
- Different peers can publish identical local slugs without overwriting each other.

## Not Yet Implemented

- Conflict/merge UX in desktop UI (currently automatic per manifest timestamps only).

## Upload Size Guard

- Desktop checks each upload chunk before sending it using an estimated JSON request size.
- Desktop first uses server-advertised limit from `/publish/check` (`serverMaxUploadRequestBytes`) when provided.
- If server does not provide a limit, desktop falls back to default `921600` bytes (about `900 KB`) per upload request.
- Config key: `config.pluginConfigs.wordpress_publish.maxUploadRequestBytes`
- Set `maxUploadRequestBytes` to `0` to disable the pre-upload guard.
- Config key: `config.pluginConfigs.wordpress_publish.uploadChunkSizeBytes`
- Default chunk size: `8388608` bytes (`8 MB`)
- If a chunk exceeds the limit, desktop shows a friendly error before upload and suggests raising:
  - nginx `client_max_body_size`
  - PHP `post_max_size`
  - PHP `upload_max_filesize`
