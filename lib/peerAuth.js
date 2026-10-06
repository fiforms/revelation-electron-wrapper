// Peer-protocol crypto primitives: RSA-2048 key generation, SHA-256 fingerprints, and the
// domain-separated sign/verify helpers used for challenges, socket tokens and follower auth.
// Pure (no Electron); required by configManager (generateKeyPair), peerPairing, peerHttp,
// peerCommandClient, mdnsManager, peerFollowers and plugins/wordpress_publish (signChallenge,
// fingerprintPublicKey). Wire spec: doc/dev/PEERING.md ("Signature Constructions").
// Note: signChallenge/verifyChallenge sign the RAW message; peer code must use the
// signPeer*/verifyPeer* wrappers below so signatures stay domain-separated.
const crypto = require('crypto');

// Peer wire protocol version. Matches PEER_PROTOCOL_VERSION in
// revelation/peer-server.js; followers refuse masters advertising another.
const PEER_PROTOCOL_VERSION = 2;

function generateKeyPair() {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
}

function fingerprintPublicKey(publicKeyPem) {
  return crypto.createHash('sha256').update(publicKeyPem).digest('hex');
}

function signChallenge(privateKeyPem, challenge) {
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(challenge);
  signer.end();
  return signer.sign(privateKeyPem).toString('base64');
}

function verifyChallenge(publicKeyPem, challenge, signatureBase64) {
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(challenge);
  verifier.end();
  return verifier.verify(publicKeyPem, Buffer.from(signatureBase64, 'base64'));
}

function generateChallenge() {
  return crypto.randomBytes(32).toString('base64');
}

// --- Domain-separated peer signatures -------------------------------------
//
// The peer keypair must never produce a signature that another protocol will
// accept. /peer/challenge signs caller-supplied bytes by design (that is how a
// follower proves the master holds the key), so if the raw challenge were
// signed directly the endpoint would be an oracle: a caller could submit a
// message belonging to some other protocol and get it signed. See
// revelation/doc/SECURITY.md (F2).
//
// Every peer signature therefore covers a constant-length, prefixed digest
// rather than the caller's bytes. The prefix names the protocol and the
// operation, so a challenge signature is not a valid socket signature and
// neither is valid anywhere outside the peer protocol.
//
// Follower auth (protocol v2) has its own domain for the same reason in the
// other direction: one instance can be both master and follower with a single
// peer keypair, so its challenge signatures must never pass as follower auth.
//
// ⚠ revelation/peer-server.js carries byte-identical copies of these
// constructions (it runs in the Vite utility process and cannot require this
// module). Any change here must be mirrored there, and both sides must ship
// together — the constructions are part of the wire protocol.

const PEER_CHALLENGE_DOMAIN = 'revelation-peer-challenge:v1:';
const PEER_SOCKET_DOMAIN = 'revelation-peer-socket:v1:';
const PEER_FOLLOWER_AUTH_DOMAIN = 'revelation-peer-follower-auth:v2:';

function peerChallengeMessage(challenge) {
  const digest = crypto.createHash('sha256').update(String(challenge ?? ''), 'utf8').digest('hex');
  return `${PEER_CHALLENGE_DOMAIN}${digest}`;
}

function peerSocketMessage(payload) {
  const digest = crypto.createHash('sha256').update(String(payload ?? ''), 'utf8').digest('hex');
  return `${PEER_SOCKET_DOMAIN}${digest}`;
}

// Signed by a paired follower on every request after enrollment. `nonce` is
// issued by the master (GET /peer/auth-nonce); `masterId` is the audience, so
// a signature made for one master is useless at another.
function peerFollowerAuthMessage({ purpose, masterId, followerId, nonce, extra = '' }) {
  const fields = [purpose, masterId, followerId, nonce, extra].map((v) => String(v ?? ''));
  const digest = crypto.createHash('sha256').update(fields.join('\n'), 'utf8').digest('hex');
  return `${PEER_FOLLOWER_AUTH_DOMAIN}${digest}`;
}

function signPeerFollowerAuth(privateKeyPem, fields) {
  return signChallenge(privateKeyPem, peerFollowerAuthMessage(fields));
}

function signPeerChallenge(privateKeyPem, challenge) {
  return signChallenge(privateKeyPem, peerChallengeMessage(challenge));
}

function verifyPeerChallenge(publicKeyPem, challenge, signatureBase64) {
  return verifyChallenge(publicKeyPem, peerChallengeMessage(challenge), signatureBase64);
}

function signPeerSocketPayload(privateKeyPem, payload) {
  return signChallenge(privateKeyPem, peerSocketMessage(payload));
}

function verifyPeerSocketPayload(publicKeyPem, payload, signatureBase64) {
  return verifyChallenge(publicKeyPem, peerSocketMessage(payload), signatureBase64);
}

module.exports = {
  PEER_PROTOCOL_VERSION,
  generateKeyPair,
  fingerprintPublicKey,
  signChallenge,
  verifyChallenge,
  generateChallenge,
  peerChallengeMessage,
  peerSocketMessage,
  peerFollowerAuthMessage,
  signPeerFollowerAuth,
  signPeerChallenge,
  verifyPeerChallenge,
  signPeerSocketPayload,
  verifyPeerSocketPayload
};
