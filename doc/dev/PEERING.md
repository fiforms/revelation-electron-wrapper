# Peering and Discovery

---

## Table of Contents
* [Overview](#dev-peering-overview)
* [Discovery](#dev-peering-discovery)
* [Pairing Flow](#dev-peering-pairing)
* [Security Model](#dev-peering-security)

---

<a id="dev-peering-overview"></a>

## Overview

The wrapper supports peer discovery and pairing in network mode.

---

<a id="dev-peering-discovery"></a>

## Discovery

Discovery uses mDNS (`bonjour-service`) with service type `revelation`.

Published TXT metadata includes values such as:
- `instanceId`
- `mode`
- `version`
- `hostname`
- `pairingPort`
- `pubKeyFingerprint`

Implementation files:
- `lib/mdnsManager.js`

---

<a id="dev-peering-pairing"></a>

## Pairing Flow

Pairing uses a PIN and challenge-response flow:
1. Query peer public key (`/peer/public-key`).
2. Generate challenge bytes.
3. Send challenge plus PIN to peer (`/peer/challenge`).
4. Verify returned signature.
5. Save paired master details in config.

Implementation files:
- `lib/peerPairing.js`

---

<a id="dev-peering-security"></a>

## Security Model

Peer authentication uses RSA signatures over random challenges.

Implementation files:
- `lib/peerAuth.js`
