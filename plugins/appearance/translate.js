// plugins/appearance/translate.js  (browser + Node tests)
// Translation helpers: t(key) looks the English string up via window.tr (from /js/translate.js)
// and falls back to the key itself (English, or no window under Node). tf(key, vars) translates
// first, then replaces {name} placeholders. Catalog: locales/translations.json (see client.js init).
export function t(key) {
  return typeof window !== 'undefined' && typeof window.tr === 'function' ? window.tr(key) : key;
}

export function tf(key, vars = {}) {
  return t(key).replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
}
