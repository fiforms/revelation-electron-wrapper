# Peering and Discovery

Peering is a powerful mechanism that allows one "master" instance to push a presentation 
simultaneously to multiple "follower" instances. The other instances could mirror the 
primary presenter screen, show notes or lower-thirds versions, allow different aspect
ratios for streaming, or show the presentation in different languages. 

Peering must first be enabled under "Settings" on both master and follower instances, and
"network" mode must be enabled at least on the master instance.

The peering screen shows available instances on the local network. For peering to work,
all instances must be connected to the same local network. It likely will not work on
public WiFi or other setups that "isolate clients."

Pairing is always initiated from the "follower" to the "master." You must know the master
Pairing PIN (available from the info dialog on the main screen). The PIN is only needed
to pair: afterwards the follower identifies itself with its own key, so changing the PIN
on the master does not disconnect followers that are already paired. To revoke a follower,
use **Forget** in the master's **Settings → Peer Pairing → Paired Followers** list.

Below is a more technical reference on how the protocol works.

---

## Table of Contents
* [Changes Since Protocol 1.0 (Migration Guide)](#dev-peering-migration)
* [Plain-English Overview](#dev-peering-overview)
* [Roles and Transport](#dev-peering-roles)
* [Discovery (mDNS)](#dev-peering-discovery)
* [Pairing Protocol](#dev-peering-pairing)
* [Follower-Authenticated Requests](#dev-peering-follower-auth)
* [Peer Command Channel](#dev-peering-commands)
* [Signature Constructions](#dev-peering-signatures)
* [Persistence and Data Model](#dev-peering-persistence)
* [Compatibility Checklist](#dev-peering-compatibility)
* [Security Model and Assumptions](#dev-peering-security)
* [Hardening Recommendations](#dev-peering-hardening)
* [Troubleshooting](#dev-peering-troubleshooting)

Related: [Running a Public Relay](PUBLIC_RELAY.md) — hosting the socket relay on a public server.

---

<a id="dev-peering-migration"></a>

## Changes Since Protocol 1.0 (Migration Guide)

"Protocol 1.0" means the unversioned protocol shipped up to app version 1.0.10. App 1.0.12 introduces **protocol v2**. (An intermediate "v1" existed only during 1.0.11 development and was never released, so you can skip it.) The two versions don't interoperate, and **every existing pairing must be made again once**.

**Master (server) side:**

| Change | What to do | Details |
|---|---|---|
| Version is advertised | Add `"peerProtocol": 2` to `GET /peer/public-key`. | [Fetch identity](#dev-peering-pairing) |
| Separate peer key pair | Sign with a key pair used only for peering. `publicKey` in `/peer/public-key` and `pubKeyFingerprint` in mDNS TXT must be that key. Don't reuse the WordPress key. | [Overview](#dev-peering-overview) |
| Domain-separated signatures | Stop signing challenges and socket payloads raw. Sign `prefix + hex(sha256(...))` instead. | [Signature Constructions](#dev-peering-signatures) |
| New: `POST /peer/pair` | This is now the only endpoint that checks the PIN (with the lockout). Store the follower's `followerInstanceId` and `followerPublicKey`. | [Enroll with the PIN](#dev-peering-pairing) |
| New: `GET /peer/auth-nonce` | Issue single-use nonces that expire in 60 seconds. | [Follower-Authenticated Requests](#dev-peering-follower-auth) |
| `POST /peer/challenge` changed | No PIN. Require a follower signature (`purpose` `challenge`). | [Identity check](#dev-peering-follower-auth) |
| `/peer/socket-info` changed | `GET ?pin=` becomes `POST` with a follower signature (`purpose` `socket-info`). Record which follower each token was issued to. | [Bootstrap](#dev-peering-commands) |
| Socket handshake | Accept only tokens you issued. Take the follower's identity from the token, not from `auth.instanceId`. Reject followers that are no longer paired. | [Socket.IO connect](#dev-peering-commands) |
| Error codes | Return `{ error, code }` using the codes in the table. | [Pairing Protocol](#dev-peering-pairing) |
| Revocation | Provide a way to forget a follower, and disconnect its sockets when you do. Changing the PIN must not affect paired followers. | [Security Model](#dev-peering-security) |

**Follower (client) side:**

| Change | What to do | Details |
|---|---|---|
| Version check | Refuse to pair unless `peerProtocol` is `2`. | [Fetch identity](#dev-peering-pairing) |
| Own key pair | Have a stable `instanceId` and an RSA key pair (at least 2048 bits) for peering. | [Enroll with the PIN](#dev-peering-pairing) |
| Pair with `POST /peer/pair` | Replaces pairing through `/peer/challenge` with a PIN. Send your public key, and verify the master's signature under the challenge domain. | [Enroll with the PIN](#dev-peering-pairing) |
| Don't store the PIN | Forget it once pairing succeeds. | [Persistence](#dev-peering-persistence) |
| Sign every later request | Get a nonce, then sign `purpose`, `masterId`, `followerId`, `nonce` and `extra` under the follower-auth domain. | [Follower-Authenticated Requests](#dev-peering-follower-auth) |
| Verify under the new domains | Master signatures on challenges and on socket info are domain-separated. | [Signature Constructions](#dev-peering-signatures) |
| Stop retrying on rejection | On `not-paired`, `invalid-signature`, `invalid-pin` or `pin-lockout`, stop and ask the user to pair again. In 1.0 a stale PIN was retried every 10 seconds and kept locking the follower's IP out. | [Pairing Protocol](#dev-peering-pairing) |
| Re-pair existing pairings | A master's `publicKey` changed along with its key pair, so a key pinned under 1.0 no longer verifies. | [Persistence](#dev-peering-persistence) |

**Removed:** `GET /peer/socket-info`, the `pin` field on `/peer/challenge`, and `POST /peer/command`. The last one was only this wrapper's local dispatch, never part of the wire protocol, so other implementations don't need to replace it.

**Unchanged:**
- the mDNS service type and TXT fields;
- the Socket.IO path `/peer-commands`;
- the `peer-command` event and its payloads;
- the `token:expiresAt:socketPath` tuple (though it's now signed under the socket domain);
- the challenge format (base64 of 32 random bytes).

---

<a id="dev-peering-overview"></a>

## Overview

Peering lets one REVELation wrapper instance (the "master") remotely open/close a presentation on another instance (the "follower").

At runtime, the system uses:
- mDNS (`bonjour-service`) for LAN discovery.
- Plain HTTP (not HTTPS) on the wrapper's Vite port for pairing and command bootstrap endpoints.
- Socket.IO for ongoing peer commands.
- RSA-2048 signatures (SHA-256) for challenge-response identity checks and short-lived socket auth payload signing.
- A shared pairing PIN, used once per follower to authorize enrollment.
- Follower keys: after enrollment the master knows each follower's public key, and the follower signs every request with it.

Current peer protocol version: **2** (advertised as `peerProtocol` by `/peer/public-key`).

---

Protocol Direction Overview:
- Master nodes advertise via mDNS and expose peering points via an HTTP protocol.
- Pairing is initiated from the "follower" to the "master" The "follower" acts as the client and calls the candidate peer's HTTP (vite server) endpoints (running on `viteServerPort` port, typically 8000).
- Command direction: followers keep outbound Socket.IO connections to each paired master and receive peer-command events via the Vite server Socket.IO endpoint (/peer-commands, also `viteServerPort`).

---

> **Implementation-specific note:** In this Electron wrapper, advertising and endpoint availability are gated by local config (`mdnsPublish`) and startup mode (`network`).

---

Ports:
- Discovery advertisement includes `pairingPort`, currently the same as `viteServerPort`.
- Pairing endpoints (`/peer/*`) are served over HTTP.

---

> **Implementation-specific note:** In this Electron wrapper, `/peer/*` is hosted on the Vite server (`viteServerPort`, typically 8000), hard-disabled unless `mdnsPublish === true`. Reveal Remote runs on the same Vite server (no separate port).

---

Key and secret storage:
- Every instance has a peer RSA key pair (`peerRsaPublicKey` / `peerRsaPrivateKey`), separate from the WordPress key pair (`rsaPublicKey` / `rsaPrivateKey`). As a master it proves its identity to followers with it; as a follower it proves its identity to masters with it.
- Masters keep the PIN (`mdnsPairingPin`) in Electron config and the enrolled followers in `peer-followers.json`. Followers keep their paired masters (`pairedMasters`) in Electron config. Followers do **not** store the PIN.
- Private keys are long-lived and reused across runs unless config is replaced. The follower refuses to connect if the master can't sign with the key pinned at pairing. The master refuses a follower whose key isn't in its list.

---

<a id="dev-peering-roles"></a>

## Roles and Transport

Terminology used by implementation:
- `master`: a paired node a follower listens to for peer commands.
- `follower`: local node executing commands from paired masters.
- `instanceId`: stable per-install random hex identifier (16 hex chars; 8 random bytes).

---

Transport summary:
- mDNS service type: `revelation`
- Pairing/auth endpoints: HTTP JSON
- Realtime command channel: Socket.IO on path `/peer-commands`

---

<a id="dev-peering-discovery"></a>

## Discovery (mDNS)

Protocol behavior:
- Peers are discovered via mDNS service type `revelation`.
- Instances may advertise metadata using mDNS TXT fields listed below.

---

> **Implementation-specific note:** In this Electron wrapper, browse/publish are controlled by `mdnsBrowse`/`mdnsPublish`, browser refreshes every 15 seconds, and self-advertisements are ignored by `instanceId`.

---

Service publication details:
- Service type: `revelation`
- Service name: `mdnsInstanceName` (default `${username}@${hostname}`)
- Host: `${os.hostname()}.local` (unless already `.local`)
- Port: `viteServerPort`
- `disableIPv6: true`

---

Published TXT payload:
- `instanceId`
- `mode`
- `version`
- `hostname`
- `pairingPort`
- `pubKeyFingerprint` (`sha256(publicKeyPem)` hex, of the peer public key)
- `httpsEnabled` (`"true"` / `"false"`)

---

> **Implementation-specific note:** Host selection prefers first discovered IPv4 address and falls back to `service.host`. Previously paired instance IDs are re-verified on mDNS `up` via `/peer/challenge` (follower-authenticated, see below) before being accepted as online.

---

<a id="dev-peering-pairing"></a>

## Pairing Protocol

Pairing is HTTP JSON over `http://<peerHost>:<pairingPort>` (or `https://` when the master advertises `httpsEnabled=true`).

> **Implementation-specific note:** In this Electron wrapper, pairing endpoints are available only when target peer `mdnsPublish === true`.

---

Error responses are JSON `{ "error": "<message>", "code": "<code>" }`. The `code` values a follower must handle:

| HTTP | `code` | Meaning | Follower should |
|---|---|---|---|
| 403 | `invalid-pin` | Wrong PIN at enrollment. Includes `remainingAttempts`. | Ask the user again. |
| 429 | `pin-lockout` | Too many wrong PINs from this IP. Includes `retryAfterSec`. | Wait, then ask the user again. |
| 503 | `pairing-unavailable` | The master has no PIN configured. | Tell the user. |
| 403 | `not-paired` | The master has no record of this follower (forgotten, or never paired). | **Stop retrying.** Mark the pairing as needing re-pair. |
| 403 | `invalid-signature` | The follower's signature doesn't match the key the master has for it. | **Stop retrying.** Mark the pairing as needing re-pair. |
| 401 | `invalid-nonce` | Nonce expired, reused or forged. | Fetch a new nonce and retry. |
| 403 | `master-disabled` | Master mode is off on that machine. | Retry later. |

Followers must not retry automatically on `invalid-pin`, `pin-lockout`, `not-paired` or `invalid-signature`. Retrying can't succeed, and retrying a PIN locks the IP out.

---

### 1) Fetch identity

`GET /peer/public-key`

Response:
```json
{
  "instanceId": "<string>",
  "instanceName": "<string>",
  "hostname": "<string>",
  "peerProtocol": 2,
  "publicKey": "-----BEGIN PUBLIC KEY-----...",
  "publicKeyFingerprint": "<sha256 hex>"
}
```

---

Validation rules:
- Verify that response fields needed for trust selection are present and consistent.
- Refuse to pair unless `peerProtocol` is `2`.

> **Implementation-specific note:** This wrapper enforces discovered TXT hostname match (when present), then chooses master ID by priority: response `instanceId`, discovered `peer.instanceId`, then discovered `peer.txt.instanceId`.

---

### 2) Enroll with the PIN

This is the only request that carries the PIN. The follower sends its own peer public key, and the master stores it. The follower also sends a challenge so it can confirm that the master holds the private key for the `publicKey` from step 1.

Client generates challenge as base64 of 32 random bytes.

`POST /peer/pair`

Request:
```json
{
  "pin": "<pairing pin>",
  "challenge": "<base64 random>",
  "followerInstanceId": "<follower instanceId>",
  "followerName": "<display name>",
  "followerPublicKey": "-----BEGIN PUBLIC KEY-----..."
}
```

Response:
```json
{
  "signature": "<base64 RSA-SHA256 signature, challenge domain>",
  "peerProtocol": 2,
  "instanceId": "<master instanceId>",
  "instanceName": "<master name>"
}
```

---

Server-side rules:
- If no PIN is configured, refuse with `503 pairing-unavailable`. The check fails closed.
- `pin` must match exactly. A wrong PIN returns `403 invalid-pin`. Three failures from one IP block that IP for 60 seconds (`429 pin-lockout`).
- `followerInstanceId` must match `^[A-Za-z0-9_-]{1,128}$`.
- `followerPublicKey` must be an RSA public key (SPKI PEM) of at least 2048 bits.
- The follower is stored by `followerInstanceId`. Pairing again replaces the stored key and disconnects any sessions made with the old one.

---

Verification rule on client:
- Verify `signature` over `challenge` using the challenge domain (see [Signature constructions](#dev-peering-signatures)).
- Public key used for verification is:
1. existing stored `pairedMasters[n].peerPublicKey` for same `instanceId`, else
2. `/peer/public-key` response `publicKey`.
- Don't store the PIN.

---

### 3) Persist paired master

> **Implementation-specific note:** This wrapper persists paired masters in local config (`pairedMasters`) with fields such as `instanceId`, `peerPublicKey`, `peerProtocol`, `name`, `pairedAt`, `hostHint`, `pairingPortHint`, `httpsEnabled` and `natCompatibility`. It also maintains a runtime cache (`pairedPeerCache`) and removes both entries on unpair.

---

<a id="dev-peering-follower-auth"></a>

## Follower-Authenticated Requests

After enrollment, every request from the follower is signed with the follower's peer private key over a nonce the master issued. No PIN is sent.

### Get a nonce

`GET /peer/auth-nonce` (no authentication)

Response:
```json
{ "nonce": "<opaque string>", "expiresAt": 1700000000000 }
```

Treat `nonce` as opaque. It is valid for 60 seconds, measured by the master's clock, and can be used once. Only the master's clock matters, so follower clock skew doesn't cause failures.

---

### Sign the request

The follower signs these fields with its peer private key:
- `purpose`: `socket-info` or `challenge`
- `masterId`: the master's `instanceId`, so a signature made for one master is useless at another
- `followerId`: the follower's `instanceId`
- `nonce`: from `/peer/auth-nonce`
- `extra`: the challenge for `challenge`, empty string for `socket-info`

The exact byte construction is in [Signature constructions](#dev-peering-signatures). The request body then carries:
```json
{
  "followerInstanceId": "<follower instanceId>",
  "nonce": "<nonce>",
  "signature": "<base64>"
}
```
plus any endpoint-specific fields.

---

Server-side rules, checked in this order:
1. `followerInstanceId` is a known follower, else `403 not-paired`.
2. `nonce` is authentic, unexpired and unused, else `401 invalid-nonce`.
3. `signature` verifies against the stored follower key, else `403 invalid-signature`.
4. The nonce is marked as used.

These failures don't count toward the PIN lockout, because nothing is being guessed.

---

### Identity check: `POST /peer/challenge`

Used by followers to re-verify a paired master when mDNS rediscovers it.

Request (follower-authenticated, `purpose` `challenge`, `extra` = `challenge`):
```json
{
  "challenge": "<base64 random>",
  "followerInstanceId": "...",
  "nonce": "...",
  "signature": "..."
}
```

Response:
```json
{ "signature": "<base64 RSA-SHA256 signature, challenge domain>", "peerProtocol": 2 }
```

The follower verifies `signature` with the pinned `peerPublicKey`.

---

<a id="dev-peering-commands"></a>

## Peer Command Channel

Followers connect outbound to paired masters and receive `peer-command` events.

> **Implementation-specific note:** This wrapper refreshes follower connections every 10 seconds and requires target `mdnsPublish === true` for bootstrap/fan-out endpoints. Pairings marked as needing re-pair are skipped entirely: no requests are made to that master until the user pairs again.

---

### Bootstrap: signed socket info

Follower requests (follower-authenticated, `purpose` `socket-info`, `extra` empty):

`POST /peer/socket-info`

```json
{
  "followerInstanceId": "...",
  "nonce": "...",
  "signature": "..."
}
```

---

Response:
```json
{
  "socketUrl": "http://<host>:<port>",
  "socketPath": "/peer-commands",
  "token": "<hex 16 random bytes>",
  "expiresAt": 1700000000000,
  "signature": "<base64 RSA-SHA256 signature>"
}
```

---

Signed payload format:
- `"${token}:${expiresAt}:${socketPath}"`, signed under the socket domain

Follower verifies `signature` with stored master public key before connecting.

The master records which follower each token was issued to. A token can be reused until it expires (60 seconds), so Socket.IO's automatic reconnection works across brief network drops.

---

### Socket.IO connect

Follower connects to `socketUrl` with path `/peer-commands` and auth payload:
```json
{
  "token": "...",
  "expiresAt": 1700000000000,
  "signature": "...",
  "instanceId": "<followerInstanceId>",
  "instanceName": "<display name>",
  "hostname": "<display label>"
}
```

---

Server handshake validation:
- Requires `token`, `expiresAt`, `signature`.
- `token` must have been issued by `/peer/socket-info`, with the same `expiresAt`, and must not have expired.
- Verifies signature over `"${token}:${expiresAt}:/peer-commands"` using local configured public key.
- The follower the token was issued to must still be paired.
- The follower's identity comes from the token, not from `instanceId` in the auth payload. `instanceName` and `hostname` are display labels only.

Handshake errors carry `err.data.code`, with the same codes as the HTTP endpoints plus `expired` and `missing-auth`. On `not-paired`, stop and mark the pairing as needing re-pair.

When a follower is forgotten on the master, the master disconnects its sockets. The follower's next `socket-info` request gets `not-paired`.

---

### Command fan-out

The master emits a `peer-command` event to every connected follower socket. Only enrolled followers can connect, so that means every paired follower. How a master's own UI hands a command to its socket server is up to each implementation and isn't part of the wire protocol.

> **Implementation-specific note:** In this wrapper, the Electron main process sends `{ type: "peer-command", command }` to the Vite utility process over `parentPort` (`sendPeerCommand()` in `lib/peerCommandClient.js`), and the reply carries any error. There is deliberately **no HTTP endpoint** for this. Before 1.0.11 it was `POST /peer/command`, restricted to loopback callers. But a loopback check can't stop a web page open in a browser on the same machine from POSTing to `127.0.0.1`, so any site could push presentations to every follower. A compatible implementation that keeps an HTTP endpoint for this should require a secret the browser can't know, not just a loopback address.

---

Command payloads:
```json
{
  "command": {
    "type": "open-presentation",
    "payload": {
      "url": "<share URL>"
    }
  }
}
```

---

or

```json
{
  "command": {
    "type": "close-presentation",
    "payload": {}
  }
}
```

---

Rules:
- Refused unless master mode is on (`mdnsPublish === true`).
- `command.type` must be a non-empty string.
- Emits `peer-command` event to all connected peer sockets.

> **Implementation-specific note:** This wrapper handles `open-presentation` by opening the URL in presentation windows (including additional screens), handles `close-presentation` by closing them, and logs/ignores unknown command types.

---

<a id="dev-peering-signatures"></a>

## Signature Constructions

All signatures are RSA-SHA256 (PKCS#1 v1.5), base64-encoded. What gets signed is never the caller's bytes: it's an ASCII string made of a domain prefix and a hex SHA-256 digest. So a signature made for one purpose is meaningless for any other purpose or protocol.

| Use | Signer | Message signed |
|---|---|---|
| Challenge (`/peer/pair`, `/peer/challenge`) | master | `"revelation-peer-challenge:v1:" + hex(sha256(utf8(challenge)))` |
| Socket bootstrap (`/peer/socket-info`) | master | `"revelation-peer-socket:v1:" + hex(sha256(utf8(token + ":" + expiresAt + ":" + socketPath)))` |
| Follower auth | follower | `"revelation-peer-follower-auth:v2:" + hex(sha256(utf8(purpose + "\n" + masterId + "\n" + followerId + "\n" + nonce + "\n" + extra)))` |

The follower-auth domain matters because one instance can be both master and follower with a single peer key pair. Without it, its challenge signatures could be passed off as follower auth.

---

<a id="dev-peering-persistence"></a>

## Persistence and Data Model

> **Implementation-specific section:** The following keys and schemas describe this Electron wrapper's local storage model, not protocol-required on-wire fields.

---

Config keys relevant to peering:
- `mode`: `network` enables LAN server binding; `localhost` does not publish.
- `mdnsBrowse`: controls whether this node browses for peers and whether follower-side pairing/peer command behavior is allowed.
- `mdnsPublish`: controls whether this node advertises itself in `network` mode and whether local `/peer/*` endpoints are enabled.
- `mdnsInstanceName`: advertised name.
- `mdnsInstanceId`: stable unique node id.
- `mdnsPairingPin`: shared secret checked by `/peer/pair` only.
- `peerRsaPublicKey` / `peerRsaPrivateKey`: RSA-2048 PEM keypair for peering (both roles).
- `rsaPublicKey` / `rsaPrivateKey`: RSA-2048 PEM keypair for WordPress publishing, never used for peering.
- `pairedMasters`: persisted trust records (follower side).

---

`pairedMasters[]` persisted schema:
- `instanceId: string` (required)
- `name: string`
- `publicKey: string` (PEM)
- `pairedAt: string` (ISO datetime)
- `hostHint: string`
- `pairingPortHint: number`
- `peerPublicKey: string` (PEM, the master's peer key, pinned at first pairing)
- `peerProtocol: number` (`2`; any other value is treated as needing re-pair)
- `httpsEnabled: boolean`
- `natCompatibility: boolean`
- `needsRepair: boolean` (optional; set when the master rejects this device or the pairing is outdated)
- `needsRepairReason: "revoked" | "outdated"` (optional)

`pairingPin` was stored before protocol v2 and is now dropped on save.

---

Master side: `peer-followers.json` in the Electron `userData` directory. Only the Vite server process writes it. The Electron main process reads it for Settings and asks the Vite process to forget followers.
```json
{
  "version": 1,
  "followers": [
    {
      "instanceId": "<follower instanceId>",
      "name": "<display name given at pairing>",
      "publicKey": "-----BEGIN PUBLIC KEY-----...",
      "pairedAt": "<ISO datetime>",
      "lastSeenAt": "<ISO datetime of last socket connection>",
      "lastAddress": "<IP>"
    }
  ]
}
```

---

Runtime-only cache (`pairedPeerCache`) entries:
- `host`, `port`, `addresses[]`, `hostname`, `lastSeen`

---

<a id="dev-peering-compatibility"></a>

## Compatibility Checklist

A parallel implementation is wire-compatible if it does all of the following:
- Publishes and browses mDNS service type `revelation` with matching TXT fields.
- Uses the same HTTP endpoints and JSON payloads:
  - `GET /peer/public-key`
  - `POST /peer/pair`
  - `GET /peer/auth-nonce`
  - `POST /peer/challenge`
  - `POST /peer/socket-info`

---

- Uses RSA-SHA256 signatures with base64 signatures and PEM keys, with the exact [signature constructions](#dev-peering-signatures).
- Uses challenge format as base64 random bytes.
- Uses socket signed payload format exactly: `token:expiresAt:socketPath`.
- Sends the PIN only to `/peer/pair`, and doesn't store it.
- Stops retrying on `not-paired` / `invalid-signature` / `invalid-pin` / `pin-lockout` instead of looping.
- Uses Socket.IO path `/peer-commands` and `peer-command` event name.
- Persists trusted peers by `instanceId` + pinned `publicKey`.
- Re-verifies known peers when rediscovered by mDNS before accepting them as online.

---

> **Implementation-specific note:** This wrapper's local command dispatch doesn't use HTTP (see [Command fan-out](#dev-peering-commands)), so a compatible implementation doesn't need any local endpoint.

---

<a id="dev-peering-security"></a>

## Security Model and Assumptions

Current trust model:
- Identity is cryptographic in both directions. Followers pin the master's peer key at pairing, and masters store each follower's peer key at enrollment.
- The PIN authorizes enrollment only. Access is revoked per follower on the master, not by changing the PIN.
- Transport is plaintext HTTP on LAN, unless HTTPS is enabled.

---

Assumptions required for safe operation:
- LAN is semi-trusted and not actively MITM'd.
- Pairing PIN is kept private and reasonably strong.
- Initial key fetch during first pair is not tampered with.
- Device compromise implies peer trust compromise (that device's peer private key).

---

Known limitations:
- No TLS by default; metadata, tokens, and commands are observable on LAN. The PIN is observable during enrollment only.
- Error responses aren't signed. An active attacker on the LAN could fake `not-paired` and force a re-pair, but that same attacker can already block the connection.
- Commands are broadcast to every connected follower. Since only paired followers can connect, that's everyone the master has paired.

> **Implementation-specific note:** In this wrapper, `mdnsAuthToken` exists in config but is unused by the current protocol, and PIN throttling is in-memory per source IP (3 failures -> 60s block), so counters reset on app restart and are not shared across multiple instances. Nonces are HMAC-authenticated with a per-process secret, so all outstanding nonces become invalid when the server restarts, and followers simply fetch new ones.

---

<a id="dev-peering-hardening"></a>

## Hardening Recommendations

Done in protocol v2:
- The static PIN is used only for enrollment. After that, each follower authenticates with its own key.
- `/peer/socket-info` is issued only to an enrolled follower, with nonce-based replay protection and an audience (`masterId`) binding.
- Per-follower revocation, with no need to change the PIN.

High-impact improvements:
1. Add HTTPS for all `/peer/*` endpoints and Socket.IO transport (TLS), with certificate pinning or TOFU pinning.
2. Replace the static PIN with short-lived pairing codes shown on the master when a follower asks to pair.
3. Sign and verify richer claims (issuer, subject instanceId, issued-at, expiry, audience) instead of raw tuple strings.
4. Encrypt at-rest sensitive values (`peerRsaPrivateKey`, `rsaPrivateKey`) with OS keychain/secure enclave integration.

---

Medium-impact improvements:
1. Add key rotation and explicit trust reset workflows.
2. Extend PIN abuse protections with persistent/distributed lockout and telemetry.
3. Let masters target commands at particular followers instead of broadcasting to all of them.
4. Validate mDNS fingerprint (`pubKeyFingerprint`) against persisted key before any active challenge requests.
5. Add persistent audit logging for pair/forget, socket-info issuance, and command sender identity. Today these are only in the in-memory event log.

---

<a id="dev-peering-troubleshooting"></a>

## Troubleshooting

For operator-focused troubleshooting steps (including manual pairing when mDNS discovery is blocked), see:
- [doc/TROUBLESHOOTING.md](../TROUBLESHOOTING.md)
