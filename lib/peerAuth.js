// Peer-protocol crypto primitives: RSA-2048 key generation, SHA-256 fingerprints, and the
// domain-separated sign/verify helpers used for challenges, socket tokens and follower auth.
// Pure (no Electron); required by configManager (generateKeyPair), peerPairing, peerHttp,
// peerCommandClient, mdnsManager, peerFollowers and plugins/wordpress_publish (signChallenge,
// fingerprintPublicKey). Wire spec: doc/dev/PEERING.md ("Signature Constructions").
//
// There is NO implementation here: it is revelation/server/peer-protocol.js, the same file the master
// (revelation/server/peer-server.js) uses, loaded through lib/revelationModules.js. Change the protocol
// there (and bump PEER_PROTOCOL_VERSION); this file only re-exports it so the rest of lib/ keeps its
// `require('./peerAuth')`. Exports: PEER_PROTOCOL_VERSION, generateKeyPair, fingerprintPublicKey,
// generateChallenge, signChallenge, verifyChallenge, peerChallengeMessage, peerSocketMessage,
// peerFollowerAuthMessage, buildSocketPayload, signPeerFollowerAuth, signPeerChallenge,
// verifyPeerChallenge, signPeerSocketPayload, verifyPeerSocketPayload.
// Note: signChallenge/verifyChallenge sign the RAW message; peer code must use the
// signPeer*/verifyPeer* wrappers so signatures stay domain-separated. verifyChallenge never throws.
const { requireRevelationServerModule } = require('./revelationModules');

module.exports = { ...requireRevelationServerModule('peer-protocol') };
