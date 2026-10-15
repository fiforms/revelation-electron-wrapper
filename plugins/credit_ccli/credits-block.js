// plugins/credit_ccli/credits-block.js  (browser ES module; pure, no DOM)
// Read and write a `:credits:` YAML block as a plain object. Used by builder.js (the credits
// dialog) for both the Rich Builder's card edit and the Animation menu's "CCLI Credits…" entry.
// Block parsing reuses parseYamlBlock() from markdown-preprocessor.js; `yaml` is a js-yaml
// instance (the builder page provides window.jsyaml).
// Gotcha: saving re-dumps the YAML, so key order is normalised and comments are lost;
// unknown keys are kept after the known ones.
import { parseYamlBlock } from './markdown-preprocessor.js';

// Known keys, in the order they are written.
export const CREDIT_KEYS = ['title', 'words', 'music', 'year', 'copyright', 'cclisong', 'license', 'source', 'sourceurl', 'attrib'];
const NUMERIC_KEYS = new Set(['year', 'cclisong']);
const TRUTHY_ATTRIB = new Set(['true', 'yes', '1']);

// Parse a raw `:credits:` block. Returns { values, extras, indent } where `values` holds the
// known keys as strings (attrib as a boolean) and `extras` any other keys; null if the YAML
// is malformed or not a mapping.
export function parseCreditsBlock(raw, yaml) {
  const parseYAML = (text) => yaml.loadAll(text)[0] ?? {};
  const block = parseYamlBlock(String(raw || '').split('\n'), 0, 'credits', parseYAML);
  if (!block || block.parsed === undefined) return null;
  const parsed = block.parsed ?? {};
  if (typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const values = {};
  const extras = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!CREDIT_KEYS.includes(key)) extras[key] = value;
    else if (key === 'attrib') values.attrib = TRUTHY_ATTRIB.has(String(value).trim().toLowerCase());
    else values[key] = String(value ?? '').trim();
  }
  return { values, extras, indent: String(raw).match(/^ */)[0] };
}

// Build block text from dialog values; empty fields are left out.
export function buildCreditsBlock(values, yaml, { extras = {}, indent = '' } = {}) {
  const out = {};
  for (const key of CREDIT_KEYS) {
    const value = values[key];
    if (key === 'attrib') {
      if (value) out.attrib = true;
      continue;
    }
    const text = String(value ?? '').trim();
    if (!text) continue;
    out[key] = NUMERIC_KEYS.has(key) && /^\d+$/.test(text) ? Number(text) : text;
  }
  Object.assign(out, extras);
  const body = Object.keys(out).length
    ? yaml.dump(out, { lineWidth: -1 }).trimEnd().split('\n').map((line) => `${indent}  ${line}`)
    : [];
  return [`${indent}:credits:`, ...body].join('\n');
}
