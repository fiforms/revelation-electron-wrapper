# Peering and Discovery

Peering is a powerful mechanism that allows one "master" instance to push a presentation 
simultaneously to multiple "follower" instances. The other instances could mirror the 
primary presenter screen, show notes or lower-thirds versions, allow different aspect
ratios for streaming, or show the presentation in different languages. 

Peering must first be enabled under "Settings" on both master and follower instances.

The peering screen shows available instances on the local network. For peering to work,
all instances must be connected to the same local network. It likely will not work on
public WiFi or other setups that "isolate clients."

Pairing is always initiated from the "follower" to the "master." You must know the master
Pairing Pin (available from the info dialog on the main screen). 

Below is a more technical reference on how the protocol works.

---

## Table of Contents
* [Plain-English Overview](#dev-peering-overview)
* [Roles and Transport](#dev-peering-roles)
* [Discovery (mDNS)](#dev-peering-discovery)
* [Pairing Protocol](#dev-peering-pairing)
* [Peer Command Channel](#dev-peering-commands)
* [Persistence and Data Model](#dev-peering-persistence)
* [Compatibility Checklist](#dev-peering-compatibility)
* [Security Model and Assumptions](#dev-peering-security)
* [Hardening Recommendations](#dev-peering-hardening)
* [Troubleshooting](#dev-peering-troubleshooting)

---

<a id="dev-peering-overview"></a>

## Overview

Peering lets one REVELation wrapper instance (the "master") remotely open/close a presentation on another instance (the "follower").

At runtime, the system uses:
- mDNS (`bonjour-service`) for LAN discovery.
- Plain HTTP (not HTTPS) on the wrapper's Vite port for pairing and command bootstrap endpoints.
- Socket.IO for ongoing peer commands.
- RSA-2048 signatures (SHA-256) for challenge-response identity checks and short-lived socket auth payload signing.
- A shared pairing PIN for authorization.

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

> **Implementation-specific note:** In this Electron wrapper, `/peer/*` is hosted on the Vite server (`viteServerPort`, typically 8000), hard-disabled unless `mdnsPublish === true`, and separate from Reveal Remote (`revealRemoteServerPort`, often 1947).

---

Key and secret storage:
- "Masters" maintain an RSA key pair used to prove their identity to repeat connections from "followers."
- `rsaPublicKey`, `rsaPrivateKey`, `mdnsPairingPin`, and `pairedMasters` are persisted in Electron config and automatically managed.
- Private keys are long-lived and reused across runs unless config is replaced. Paired followers are treated as unverified and command connection fails if the master is unable to authenticate to followers with its private key.

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
- `pubKeyFingerprint` (`sha256(publicKeyPem)` hex)

---

> **Implementation-specific note:** Host selection prefers first discovered IPv4 address and falls back to `service.host`. Previously paired instance IDs are re-verified on mDNS `up` via `/peer/challenge` before being accepted as online.

---

<a id="dev-peering-pairing"></a>

## Pairing Protocol

Pairing is HTTP JSON over `http://<peerHost>:<pairingPort>`.

> **Implementation-specific note:** In this Electron wrapper, pairing endpoints are available only when target peer `mdnsPublish === true`.

---

### 1) Fetch identity

`GET /peer/public-key`

Response:
```json
{
  "instanceId": "<string>",
  "instanceName": "<string>",
  "hostname": "<string>",
  "publicKey": "-----BEGIN PUBLIC KEY-----...",
  "publicKeyFingerprint": "<sha256 hex>"
}
```

---

Validation rules:
- Verify that response fields needed for trust selection are present and consistent.

> **Implementation-specific note:** This wrapper enforces discovered TXT hostname match (when present), then chooses master ID by priority: response `instanceId`, discovered `peer.instanceId`, then discovered `peer.txt.instanceId`.

---

### 2) Challenge-response with PIN

Client generates challenge as base64 of 32 random bytes.

`POST /peer/challenge`

Request:
```json
{
  "challenge": "<base64 random>",
  "pin": "<pairing pin>"
}
```

Response:
```json
{
  "signature": "<base64 RSA-SHA256 signature of challenge>"
}
```

---

Server-side pin rule:
- If `mdnsPairingPin` is set/non-empty, provided `pin` must match exactly or server returns `403`.
- If no PIN is configured, PIN is not enforced.

---

Verification rule on client:
- Verify signature over `challenge` with RSA-SHA256.
- Public key used for verification is:
1. existing stored `pairedMasters[n].publicKey` for same `instanceId`, else
2. `/peer/public-key` response `publicKey`.

---

### 3) Persist paired master

> **Implementation-specific note:** This wrapper persists paired masters in local config (`pairedMasters`) with fields such as `instanceId`, `publicKey`, `name`, `pairedAt`, `hostHint`, `pairingPortHint`, and `pairingPin`. It also maintains a runtime cache (`pairedPeerCache`) and removes both entries on unpair.

---

<a id="dev-peering-commands"></a>

## Peer Command Channel

Followers connect outbound to paired masters and receive `peer-command` events.

> **Implementation-specific note:** This wrapper refreshes follower connections every 10 seconds and requires target `mdnsPublish === true` for bootstrap/fan-out endpoints.

---

### Bootstrap: signed socket info

Follower requests:

`GET /peer/socket-info?instanceId=<followerInstanceId>&pin=<pairingPin>`

---

> **Implementation-specific note:** This wrapper validates PIN exactly as `/peer/challenge` and currently does not authorize based on `instanceId` query parameter.

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
- `"${token}:${expiresAt}:${socketPath}"`

Follower verifies `signature` with stored master public key before connecting.

---

### Socket.IO connect

Follower connects to `socketUrl` with path `/peer-commands` and auth payload:
```json
{
  "token": "...",
  "expiresAt": 1700000000000,
  "signature": "...",
  "instanceId": "<followerInstanceId>"
}
```

---

Server handshake validation:
- Requires `token`, `expiresAt`, `signature`.
- Requires `expiresAt >= Date.now()`.
- Verifies signature over `"${token}:${expiresAt}:/peer-commands"` using local configured public key.

---

### Command fan-out

Implementation-specific note (not core protocol): this loopback `POST /peer/command` endpoint is an Electron-wrapper convenience for local UI-to-socket fan-out. A compatible implementation may use a different local dispatch mechanism.

Local master-side UI posts commands to loopback only:

`POST /peer/command` to `http://127.0.0.1:<vitePort>/peer/command`

---

Request:
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

Server rules:
- Rejects non-loopback callers with `403`.
- Emits `peer-command` event to all connected peer sockets.

> **Implementation-specific note:** This wrapper handles `open-presentation` by opening the URL in presentation windows (including additional screens), handles `close-presentation` by closing them, and logs/ignores unknown command types.

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
- `mdnsPairingPin`: shared secret checked by `/peer/challenge` and `/peer/socket-info`.
- `rsaPublicKey` / `rsaPrivateKey`: RSA-2048 PEM keypair.
- `pairedMasters`: persisted trust records.

---

`pairedMasters[]` persisted schema:
- `instanceId: string` (required)
- `name: string`
- `publicKey: string` (PEM)
- `pairedAt: string` (ISO datetime)
- `hostHint: string`
- `pairingPortHint: number`
- `pairingPin: string`

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
  - `POST /peer/challenge`
  - `GET /peer/socket-info`

---

- Uses RSA-SHA256 signatures with base64 signatures and PEM keys.
- Uses challenge format as base64 random bytes.
- Uses socket signed payload format exactly: `token:expiresAt:socketPath`.
- Uses Socket.IO path `/peer-commands` and `peer-command` event name.
- Persists trusted peers by `instanceId` + pinned `publicKey`.
- Re-verifies known peers when rediscovered by mDNS before accepting them as online.

---

> **Implementation-specific note:** This wrapper also exposes loopback `POST /peer/command` for local UI fan-out, but that endpoint is not required by the core peer wire protocol.

---

<a id="dev-peering-security"></a>

## Security Model and Assumptions

Current trust model:
- Identity is cryptographic (RSA keypair).
- Authorization is mostly PIN-based for pairing and socket bootstrap.
- Transport is plaintext HTTP on LAN.

---

Assumptions required for safe operation:
- LAN is semi-trusted and not actively MITM'd.
- Pairing PIN is kept private and reasonably strong.
- Initial key fetch during first pair is not tampered with.
- Device compromise implies peer trust compromise (private key + stored PIN).

---

Known limitations:
- No TLS; metadata, tokens, and commands are observable on LAN.
- No mutual identity binding in socket handshake beyond signed bootstrap tuple.
- `/peer/socket-info` does not currently enforce caller `instanceId` authorization.

> **Implementation-specific note:** In this wrapper, `mdnsAuthToken` exists in config but is unused by the current protocol, and PIN throttling is in-memory per source IP (3 failures -> 60s block), so counters reset on app restart and are not shared across multiple instances.

---

<a id="dev-peering-hardening"></a>

## Hardening Recommendations

High-impact improvements:
1. Add HTTPS for all `/peer/*` endpoints and Socket.IO transport (TLS), with certificate pinning or TOFU pinning.
2. Replace static/shared PIN with per-device enrollment secrets or short-lived pairing codes.
3. Bind `/peer/socket-info` issuance to an authorized `instanceId` and require nonce-based replay protection.
4. Sign and verify richer claims (issuer, subject instanceId, issued-at, expiry, audience) instead of raw tuple strings.
5. Encrypt at-rest sensitive values (`rsaPrivateKey`, stored pairing secrets) with OS keychain/secure enclave integration.

---

Medium-impact improvements:
1. Add key rotation and explicit trust reset workflows.
2. Extend PIN abuse protections with persistent/distributed lockout and telemetry.
3. Restrict Socket.IO command recipients by explicit pair mapping instead of broadcast-to-all connected peers.
4. Validate mDNS fingerprint (`pubKeyFingerprint`) against persisted key before any active challenge requests.
5. Add audit logging for pair/unpair, socket-info issuance, and command sender identity.

---

<a id="dev-peering-troubleshooting"></a>

## Troubleshooting

For operator-focused troubleshooting steps (including manual pairing when mDNS discovery is blocked), see:
- [doc/TROUBLESHOOTING.md](../TROUBLESHOOTING.md)
