/**
 * Utility to build server URLs with the correct protocol (HTTP or HTTPS).
 * Required by: aboutWindow, createPresentation, exportWindow, handoutWindow, importPresentation, mediaLibrary,
 * otherEventHandlers, pdfExport, peerPairingWindow, pluginDirector, presentationBuilderWindow, presentationWindow,
 * settingsWindow and plugins/wordpress_publish.
 */

function buildServerURL(host, port, httpsEnabled = false) {
  const protocol = httpsEnabled ? 'https' : 'http';
  return `${protocol}://${host}:${port}`;
}

module.exports = { buildServerURL };
