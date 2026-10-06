/**
 * Utility to build server URLs with the correct protocol (HTTP or HTTPS).
 * Required by: aboutWindow, createPresentation, exportWindow, handoutWindow, importPresentation, mediaLibrary,
 * otherEventHandlers, pdfExport, peerPairingWindow, pluginDirector, presentationBuilderWindow, presentationWindow,
 * settingsWindow and plugins/wordpress_publish. NOTE: main.js keeps its own 2-argument copy of buildServerURL().
 */

function buildServerURL(host, port, httpsEnabled = false) {
  const protocol = httpsEnabled ? 'https' : 'http';
  return `${protocol}://${host}:${port}`;
}

module.exports = { buildServerURL };
