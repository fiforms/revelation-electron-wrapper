// Cross-repo contract: the wrapper's lib/peerAuth.js (follower side, also used by peerPairing /
// peerHttp / peerCommandClient) against the submodule's real revelation/peer-server.js (master
// side). The two files carry hand-copied signature constructions that "must stay byte-identical";
// this checks that they do, and runs the actual pair -> signed request -> socket grant flow
// between them. Revelation's own tests/server/peer.test.cjs covers the master in depth.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const auth = require('../lib/peerAuth');
const peerServer = require('../revelation/peer-server.js');
const { tmpDir } = require('./helpers/paths');

test('protocol version and socket path agree', () => {
  assert.strictEqual(auth.PEER_PROTOCOL_VERSION, peerServer.PEER_PROTOCOL_VERSION);
});

test('follower-auth messages are byte-identical for every field combination', () => {
  const samples = [
    { purpose: 'challenge', masterId: 'm', followerId: 'f', nonce: 'n', extra: 'x' },
    { purpose: 'socket-info', masterId: 'm', followerId: 'f', nonce: 'n' },
    { purpose: 'a\nb', masterId: '', followerId: 'f', nonce: '1.2.3', extra: '' },
    { purpose: 'challenge', masterId: 'm', followerId: 'f', nonce: 'n', extra: 'üñíçødé ✓' },
    { purpose: undefined, masterId: null, followerId: 5, nonce: {}, extra: undefined }
  ];
  for (const fields of samples) {
    assert.strictEqual(auth.peerFollowerAuthMessage(fields), peerServer.peerFollowerAuthMessage(fields), JSON.stringify(fields));
  }
});

test('a wrapper follower can pair with, authenticate to, and get a socket grant from the real master', async (t) => {
  const dir = tmpDir();
  const masterKeys = auth.generateKeyPair();
  const followerKeys = auth.generateKeyPair();
  const configPath = path.join(dir, 'config.json');
  const followersPath = path.join(dir, 'peer-followers.json');
  fs.writeFileSync(configPath, JSON.stringify({
    mdnsPublish: true, mdnsPairingPin: '654321', mdnsInstanceId: 'master-1', mdnsInstanceName: 'Master',
    peerRsaPublicKey: masterKeys.publicKey, peerRsaPrivateKey: masterKeys.privateKey
  }));
  const master = peerServer.createPeerServer({ configPath, followersPath, postToParent() {} });
  const server = http.createServer((req, res) => master.middleware(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (p, body) => (await fetch(`${base}${p}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  })).json();

  // Enrollment: the master's answer must verify with the wrapper's verifier.
  const challenge = auth.generateChallenge();
  const paired = await post('/peer/pair', {
    pin: '654321', followerInstanceId: 'wrapper-follower', followerName: 'Wrapper',
    followerPublicKey: followerKeys.publicKey, challenge
  });
  assert.ok(paired.signature, JSON.stringify(paired));
  assert.ok(auth.verifyPeerChallenge(masterKeys.publicKey, challenge, paired.signature));
  const identity = await (await fetch(`${base}/peer/public-key`)).json();
  assert.strictEqual(identity.publicKeyFingerprint, auth.fingerprintPublicKey(masterKeys.publicKey));

  // Signed follower request, produced by the wrapper's signer.
  const nonce = (await (await fetch(`${base}/peer/auth-nonce`)).json()).nonce;
  const fields = { purpose: 'challenge', masterId: 'master-1', followerId: 'wrapper-follower', nonce, extra: 'check' };
  const reply = await post('/peer/challenge', {
    followerInstanceId: 'wrapper-follower', nonce, challenge: 'check', signature: auth.signPeerFollowerAuth(followerKeys.privateKey, fields)
  });
  assert.ok(auth.verifyPeerChallenge(masterKeys.publicKey, 'check', reply.signature), JSON.stringify(reply));

  // Socket grant: the wrapper must accept the master's signature over it.
  const nonce2 = (await (await fetch(`${base}/peer/auth-nonce`)).json()).nonce;
  const grant = await post('/peer/socket-info', {
    followerInstanceId: 'wrapper-follower', nonce: nonce2,
    signature: auth.signPeerFollowerAuth(followerKeys.privateKey, { purpose: 'socket-info', masterId: 'master-1', followerId: 'wrapper-follower', nonce: nonce2, extra: '' })
  });
  assert.ok(grant.token, JSON.stringify(grant));
  assert.ok(auth.verifyPeerSocketPayload(masterKeys.publicKey, `${grant.token}:${grant.expiresAt}:${grant.socketPath}`, grant.signature));
});
