/**
 * Utility to build server URLs with the correct protocol (HTTP or HTTPS)
 */

function buildServerURL(host, port, httpsEnabled = false) {
  const protocol = httpsEnabled ? 'https' : 'http';
  return `${protocol}://${host}:${port}`;
}

module.exports = { buildServerURL };
