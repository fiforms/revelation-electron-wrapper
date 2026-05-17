const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const certManager = {
  /**
   * Get or create a self-signed certificate for localhost and private IPs.
   * Returns { certPath, keyPath } on success, or null if cert generation fails.
   */
  ensureCertificate(userDataDir) {
    const certPath = path.join(userDataDir, 'server.crt');
    const keyPath = path.join(userDataDir, 'server.key');

    // If both files exist, return them
    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      return { certPath, keyPath };
    }

    // Generate new self-signed cert
    if (this.generateSelfSignedCert(certPath, keyPath)) {
      return { certPath, keyPath };
    }

    return null;
  },

  generateSelfSignedCert(certPath, keyPath) {
    try {
      // Use OpenSSL to generate a self-signed certificate valid for 10 years
      const cmd = `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 3650 -nodes -subj "/CN=localhost"`;
      execSync(cmd, { stdio: 'pipe' });
      return true;
    } catch (err) {
      console.error('Failed to generate self-signed certificate with OpenSSL:', err.message);
      console.error('HTTPS mode will be disabled. Ensure OpenSSL is installed on your system.');
      return false;
    }
  }
};

module.exports = { certManager };
