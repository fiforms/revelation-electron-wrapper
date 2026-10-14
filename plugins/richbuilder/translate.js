// plugins/richbuilder/translate.js
//
// Tiny translation helper shared by the richbuilder browser modules. Keys are
// the English strings; window.tr() (from /js/translate.js) looks them up in the
// catalogs registered by client.js (locales/translations.json). Without a
// window (Node unit tests) every key passes through unchanged.

export function t(key) {
  return typeof window !== 'undefined' && typeof window.tr === 'function' ? window.tr(key) : key;
}

// Translate `key`, then replace {name} placeholders with vars.name.
export function tf(key, vars = {}) {
  return t(key).replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
}
