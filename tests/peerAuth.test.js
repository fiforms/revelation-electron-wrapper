// Peer-protocol signatures: round trips, tamper detection, and domain separation between the
// challenge, socket and follower-auth constructions (doc/dev/PEERING.md). Agreement with the
// submodule's peer-server.js is checked in peerProtocol.test.js.
const test = require('node:test');
const assert = require('node:assert');
const auth = require('../lib/peerAuth');

const a = auth.generateKeyPair();
const b = auth.generateKeyPair();

test('fingerprint is stable sha256 hex and differs per key', () => {
  assert.match(auth.fingerprintPublicKey(a.publicKey), /^[0-9a-f]{64}$/);
  assert.strictEqual(auth.fingerprintPublicKey(a.publicKey), auth.fingerprintPublicKey(a.publicKey));
  assert.notStrictEqual(auth.fingerprintPublicKey(a.publicKey), auth.fingerprintPublicKey(b.publicKey));
});

test('generateChallenge returns fresh random values', () => {
  assert.notStrictEqual(auth.generateChallenge(), auth.generateChallenge());
});

test('peer challenge sign/verify round trip, rejects wrong key and altered challenge', () => {
  const ch = auth.generateChallenge();
  const sig = auth.signPeerChallenge(a.privateKey, ch);
  assert.ok(auth.verifyPeerChallenge(a.publicKey, ch, sig));
  assert.ok(!auth.verifyPeerChallenge(b.publicKey, ch, sig));
  assert.ok(!auth.verifyPeerChallenge(a.publicKey, ch + 'x', sig));
});

test('signatures are domain-separated: challenge sig is not a socket sig and vice versa', () => {
  const text = 'same-bytes';
  const challengeSig = auth.signPeerChallenge(a.privateKey, text);
  const socketSig = auth.signPeerSocketPayload(a.privateKey, text);
  assert.ok(!auth.verifyPeerSocketPayload(a.publicKey, text, challengeSig));
  assert.ok(!auth.verifyPeerChallenge(a.publicKey, text, socketSig));
});

test('raw signChallenge output does not pass as a peer challenge signature', () => {
  const raw = auth.signChallenge(a.privateKey, 'abc');
  assert.ok(!auth.verifyPeerChallenge(a.publicKey, 'abc', raw));
});

test('follower auth binds every field (purpose, master, follower, nonce, extra)', () => {
  const fields = { purpose: 'command', masterId: 'm1', followerId: 'f1', nonce: 'n1', extra: 'e' };
  const sig = auth.signPeerFollowerAuth(a.privateKey, fields);
  const verify = (f) => auth.verifyChallenge(a.publicKey, auth.peerFollowerAuthMessage(f), sig);
  assert.ok(verify(fields));
  for (const key of Object.keys(fields)) {
    assert.ok(!verify({ ...fields, [key]: fields[key] + 'x' }), `changing ${key} must invalidate`);
  }
});

test('follower auth fields cannot be shifted across boundaries', () => {
  const m1 = auth.peerFollowerAuthMessage({ purpose: 'ab', masterId: 'c', followerId: 'd', nonce: 'e' });
  const m2 = auth.peerFollowerAuthMessage({ purpose: 'a', masterId: 'bc', followerId: 'd', nonce: 'e' });
  assert.notStrictEqual(m1, m2);
});
