const crypto = require('crypto');

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

module.exports = {
  generateKeyPair,
  fingerprintPublicKey,
  signChallenge,
  verifyChallenge,
  generateChallenge
};
