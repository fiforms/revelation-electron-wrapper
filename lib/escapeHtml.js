// lib/escapeHtml.js
// Purpose: HTML escaper for the main process and plugin main halves. Encodes & < > " ' so the result
//   is safe as element text and inside a single- or double-quoted attribute value.
// Callers: presentationWindow.js, exportPresentation.js, plugins/bibletext-live/plugin.js.
// Twin: revelation/js/escape.js (ESM, browser); tests/escapeHtml.test.js cross-checks them.
const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ENTITIES[char]);
}

module.exports = { escapeHTML };
