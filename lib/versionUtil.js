// lib/versionUtil.js
// Purpose: `major.minor.patch` tuple helpers and the note-separator version rule for the main process,
//   in one place instead of private copies in createPresentation, presentationBuilderWindow and
//   exportPresentation (doc/dev/REFACTOR_CANDIDATES.md sections 2 and 8).
// Callers: createPresentation.js, presentationBuilderWindow.js, exportPresentation.js.
// Twin: revelation/js/compiler/compiler-utils.js (ESM; the browser and the builder use it). A deck
//   written by an app version above NOTE_VERSION_BREAKPOINT uses `:note:`; older or unversioned decks
//   use `Note:`. tests/versionUtil.test.js cross-checks this file against the ESM one.
// Not covered: pluginDirector/revelFormat/updateChecker compare versions with different semantics
//   (suffixes, strict parsing); see section 8.
const NOTE_VERSION_BREAKPOINT = [0, 2, 6];

function parseSemverTuple(version) {
  const raw = String(version || '').trim();
  const match = raw.match(/^v?(\d+)\.(\d+)\.(\d+)/i);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersionTuples(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return 0;
  for (let i = 0; i < 3; i += 1) {
    const av = Number(a[i] || 0);
    const bv = Number(b[i] || 0);
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

function isNewNoteVersion(version) {
  const tuple = parseSemverTuple(version);
  if (!tuple) return false;
  return compareVersionTuples(tuple, NOTE_VERSION_BREAKPOINT) > 0;
}

function isLegacyNoteVersion(version) {
  const tuple = parseSemverTuple(version);
  if (!tuple) return true;
  return compareVersionTuples(tuple, NOTE_VERSION_BREAKPOINT) <= 0;
}

// Rewrite whole-line legacy `Note:` separators to `:note:`.
function normalizeNoteSeparators(markdown = '') {
  return String(markdown)
    .split(/\r?\n/)
    .map((line) => (line.trim() === 'Note:' ? ':note:' : line))
    .join('\n');
}

module.exports = {
  NOTE_VERSION_BREAKPOINT,
  parseSemverTuple,
  compareVersionTuples,
  isNewNoteVersion,
  isLegacyNoteVersion,
  normalizeNoteSeparators
};
