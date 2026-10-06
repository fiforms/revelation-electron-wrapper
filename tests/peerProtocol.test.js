// Cross-repo contract between the wrapper's follower side (lib/peerAuth.js, also used by peerPairing /
// peerHttp / peerCommandClient) and the submodule's real master (revelation/server/peer-server.js).
// Both sides now load the same signature constructions from revelation/server/peer-protocol.js, so
// this checks that the wrapper really does (nobody re-introduced a copy), and runs the actual
// pair -> signed request -> socket grant flow between them. Revelation's own tests/server/peer.test.cjs
// and tests/unit/peer-protocol.test.cjs cover the master and the constructions in depth.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const auth = require('../lib/peerAuth');
const peerServer = require('../revelation/server/peer-server.js');
const protocol = require('../revelation/server/peer-protocol.js');
const { tmpDir } = require('./helpers/paths');

test('lib/peerAuth.js is the submodule\'s implementation, not a copy', () => {
  // Every export is the very same function object, so there is nothing to drift apart.
  assert.deepStrictEqual(Object.keys(auth).sort(), Object.keys(protocol).sort());
  for (const name of Object.keys(protocol)) assert.strictEqual(auth[name], protocol[name], name);
  assert.strictEqual(peerServer.PEER_PROTOCOL_VERSION, auth.PEER_PROTOCOL_VERSION);
  assert.strictEqual(peerServer.peerFollowerAuthMessage, protocol.peerFollowerAuthMessage);
});

test('peerCommandClient no longer carries its own copy of the socket payload format', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'peerCommandClient.js'), 'utf8');
  assert.ok(!/function buildSocketPayload/.test(src));
  assert.ok(/buildSocketPayload\b[^;]*require\('\.\/peerAuth'\)/.test(src));
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
