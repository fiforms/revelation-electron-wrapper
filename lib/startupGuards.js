/**
 * startupGuards.js -- process-level safety nets installed at the very top of main.js.
 *
 * isDebugEnabled(): true with --enable-debug (argv or Electron switch).
 * silenceOutputUnlessDebug(debugEnabled): without debug, console.* and stdout/stderr become no-ops.
 * installNetworkErrorGuard(): transient mDNS/dgram errors (EHOSTUNREACH etc. from a multicast send on an
 *   interface without multicast support) are logged and toasted instead of crashing; any other uncaught
 *   exception exits as before.
 * trustPrivateNetworkCertificates(): with HTTPS enabled, accepts the app's self-signed certificate for
 *   localhost and private-LAN hosts only; everything else is rejected.
 *
 * Caller: main.js only. Debug output itself is handled by AppContext.log/warn/error (lib/appContext.js).
 */

const { app, BrowserWindow } = require('electron');

const DEBUG_FLAG = '--enable-debug';

// Debug mode: console output, debug.log file and the Help -> Debug menu. Without it the app runs silently.
function isDebugEnabled() {
  return (Array.isArray(process.argv) && process.argv.includes(DEBUG_FLAG))
    || app.commandLine.hasSwitch('enable-debug');
}

function silenceOutputUnlessDebug(debugEnabled) {
  if (debugEnabled) return;
  const noop = () => {};
  for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
    console[method] = noop;
  }
  process.stdout.write = () => true;
  process.stderr.write = () => true;
}

// Without this handler Electron shows a fatal crash dialog for the transient mDNS errors; instead we log the
// error and show a non-blocking toast so the app can keep running.
function installNetworkErrorGuard() {
  process.on('uncaughtException', (err) => {
    const TRANSIENT_CODES = new Set(['EHOSTUNREACH', 'ENETUNREACH', 'ENONET', 'ENETDOWN', 'ENETRESET']);
    const isDgramNetworkError =
      TRANSIENT_CODES.has(err.code) &&
      typeof err.stack === 'string' &&
      err.stack.includes('node:dgram');

    if (isDgramNetworkError) {
      console.error('[mDNS] Transient network error (non-fatal):', err.message);
      try {
        const wins = BrowserWindow.getAllWindows();
        if (wins.length > 0 && !wins[0].isDestroyed()) {
          wins[0].webContents.send('show-toast', `Peer network error: ${err.message}`);
        }
      } catch (_) { /* window may not be ready yet */ }
      return;
    }

    // All other uncaught exceptions are fatal — restore default crash behaviour.
    console.error('Uncaught exception:', err);
    process.exit(1);
  });
}

// Disable cert validation for localhost and private IPs when HTTPS is enabled.
function trustPrivateNetworkCertificates() {
  app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
    try {
      const parsedUrl = new URL(url);
      const host = parsedUrl.hostname;

      const isPrivateIP =
        /^(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|\[::1\]|\[::ffff:127\.)/.test(host);

      if (isPrivateIP) {
        event.preventDefault();
        callback(true); // Trust the certificate
      } else {
        callback(false); // Reject for non-private IPs
      }
    } catch {
      callback(false);
    }
  });
}

module.exports = {
  isDebugEnabled,
  silenceOutputUnlessDebug,
  installNetworkErrorGuard,
  trustPrivateNetworkCertificates
};
