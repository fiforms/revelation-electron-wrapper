// plugins/bibletext/bibleGroups.js  (pure Node, no Electron)
//
// The language groups the Bible collection is offered in ("English", "Spanish", "Ancient Languages", "Other
// Languages"). The manifest on the CDN tags every file with a group id (bibles/make-manifest.js computes it with
// groupForLanguage); the app only shows the groups that appear in the manifest, so a new group (say "portuguese")
// needs no app release: it is listed after the known ones with a title-cased label.
//   GROUPS                    [{ id, label }] in display order (labels are English UI strings, translated by the page)
//   groupForLanguage(code)    group id for a <language> value: ISO 639-1/3 or BCP-47, any case ("ENG", "en-GB", "grc")
//   labelForGroup(id)         the label, or the id title-cased for a group the app does not know
//   orderGroups(ids)          ids sorted known-first (GROUPS order), then the rest alphabetically
//   defaultGroups(uiLanguage) the groups to tick first: English, plus Spanish first for a Spanish interface
// Callers: bibleDownloader.js, bibles/make-manifest.js.
// Gotcha: "heb" (the Hebrew Bible, ancient) and "he" (modern Hebrew) are different groups on purpose; so are
// "grc" and "el".

const GROUPS = [
  { id: 'english', label: 'English' },
  { id: 'spanish', label: 'Spanish' },
  { id: 'ancient', label: 'Ancient Languages' },
  { id: 'other', label: 'Other Languages' }
];

const ANCIENT = new Set(['grc', 'heb', 'lat', 'arc', 'syc', 'cop', 'got']);

function baseLanguage(code) {
  return String(code || '').trim().toLowerCase().split(/[-_]/)[0];
}

function groupForLanguage(code) {
  const base = baseLanguage(code);
  if (base === 'en' || base === 'eng') return 'english';
  if (base === 'es' || base === 'spa') return 'spanish';
  if (ANCIENT.has(base)) return 'ancient';
  return 'other';
}

function labelForGroup(id) {
  const known = GROUPS.find((g) => g.id === id);
  if (known) return known.label;
  const text = String(id || '').replace(/[-_]+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function orderGroups(ids) {
  const order = GROUPS.map((g) => g.id);
  return [...new Set(ids)].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return a.localeCompare(b);
  });
}

function defaultGroups(uiLanguage) {
  return baseLanguage(uiLanguage) === 'es' ? ['spanish', 'english'] : ['english'];
}

module.exports = { GROUPS, groupForLanguage, labelForGroup, orderGroups, defaultGroups };
