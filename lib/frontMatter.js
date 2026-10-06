// lib/frontMatter.js
// Purpose: the one place the main process and plugin main halves split a markdown file into its
//   YAML front matter and body. Replaces the per-file `/^---\n…\n---/` regexes (see
//   doc/dev/REFACTOR_CANDIDATES.md section 2).
// API:
//   splitFrontMatter(text) -> { hasFrontMatter, yamlText, block, body }
//       `block` is the exact text consumed (opening fence through closing fence and one newline), so
//       `text === block + body`. No front matter: block '', body === text.
//   parseFrontMatter(text) -> { data, body, hasFrontMatter, malformed, error }
//       `data` is always a plain object ({} when absent, malformed, empty, or not a mapping).
//       Malformed YAML sets `malformed` and `error` instead of throwing; callers choose the recovery.
// Rules: CRLF or LF; the opening fence must be the first line; the closing fence is the first later
//   line that starts with `---`. Parsing goes through parseYamlOrEmpty (js-yaml 5 empty-document safe).
// Not covered: the browser-side copies in revelation/ and http_admin/ (they can't require CommonJS).
const { parseYamlOrEmpty } = require('./yamlParse');

const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function splitFrontMatter(text) {
  const raw = String(text ?? '');
  const match = raw.match(FRONT_MATTER_RE);
  if (!match) return { hasFrontMatter: false, yamlText: '', block: '', body: raw };
  return { hasFrontMatter: true, yamlText: match[1], block: match[0], body: raw.slice(match[0].length) };
}

function parseFrontMatter(text) {
  const { hasFrontMatter, yamlText, body } = splitFrontMatter(text);
  const result = { data: {}, body, hasFrontMatter, malformed: false, error: null };
  if (!hasFrontMatter) return result;
  try {
    const parsed = parseYamlOrEmpty(yamlText);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) result.data = parsed;
  } catch (err) {
    result.malformed = true;
    result.error = err;
  }
  return result;
}

module.exports = { splitFrontMatter, parseFrontMatter, FRONT_MATTER_RE };
