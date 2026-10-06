// lib/yamlParse.js
// Purpose: single tolerant YAML parser for the main process and plugin main halves. js-yaml 5
//   `load()` throws on empty or comment-only input; this uses `loadAll()` (yields [] there) and
//   returns {} for "no document". Mirrors revelation/js/yaml-parse.js (browser side) — see R1.
// Callers: front-matter / macros readers in lib/ and plugins/ (grep parseYamlOrEmpty).
// Gotcha: genuinely malformed YAML still throws; callers decide how to recover.
const yaml = require('js-yaml');

function parseYamlOrEmpty(text) {
  const [data] = yaml.loadAll(String(text ?? ''));
  return data ?? {};
}

module.exports = { parseYamlOrEmpty };
