// plugins/mathjax/mathjax-block.js  (browser ES module, also copied for offline export; pure, no DOM)
// The `:mathjax:` YAML block, in one place:
//   :mathjax:
//     version: 4
//     formula: x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}
//     display: block        # optional: block (default) or inline
// - preprocessMathjaxBlocks(markdown, parseYAML): used by client.js preprocessMarkdown; replaces each
//   block with an empty <div>/<span class="mathjax-formula" data-tex="…"> (see below).
// - parseMathjaxBlock / buildMathjaxBlock: used by builder.js (the Math Formula dialog) to read and
//   write a block. `yaml` is a js-yaml instance (the builder page provides window.jsyaml).
// - MATHJAX_EXAMPLES / MATHJAX_CHEATSHEET: the dialog's example and cheat-sheet lists.
// The formula travels in a data-tex attribute, not as text: the markdown parser still processes
// text between HTML tags (it would turn `\(` into `(` and `\\` into `\`) but never touches an
// attribute. mathjax-loader.js typesetFormulas() puts the delimiters around it in the live DOM.
// `version` is informational: only MathJax 4 is shipped, so any value renders with MathJax 4.
// Gotcha: saving re-dumps the YAML, so key order is normalised and comments are lost; unknown keys
// are kept after the known ones.
// (Same block scanner shape as credit_ccli/revealchart's parseYamlBlock; see REFACTOR_CANDIDATES.md.)

export const MATHJAX_VERSION = 4;
const KNOWN_KEYS = ['version', 'formula', 'display'];

function leadingSpaces(value) {
  return String(value || '').match(/^ */)[0].length;
}

function escapeAttr(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Read the `:mathjax:` block that starts at lines[startIndex]. Returns null when that line is not
// the marker; otherwise { parsed, nextIndex, blockLines } where `parsed` is null for an empty body
// and undefined when the YAML is malformed.
export function findMathjaxBlock(lines, startIndex, parseYAML) {
  const marker = String(lines[startIndex] ?? '').match(/^(\s*):mathjax:\s*$/);
  if (!marker) return null;
  const baseIndent = leadingSpaces(marker[1]);
  const blockLines = [];
  let i = startIndex + 1;
  while (i < lines.length) {
    const current = lines[i];
    if (current.trim() !== '' && leadingSpaces(current) <= baseIndent) break;
    blockLines.push(current);
    i += 1;
  }
  const nonEmpty = blockLines.filter((line) => line.trim() !== '');
  if (!nonEmpty.length) return { parsed: null, nextIndex: i, blockLines };
  const dedent = Math.min(...nonEmpty.map(leadingSpaces));
  const yamlText = blockLines.map((line) => (line.trim() === '' ? '' : line.slice(dedent))).join('\n');
  try {
    return { parsed: parseYAML(yamlText), nextIndex: i, blockLines };
  } catch (err) {
    console.warn('[mathjax] Failed to parse :mathjax: YAML block:', err);
    return { parsed: undefined, nextIndex: i, blockLines };
  }
}

// The slide HTML for a parsed block; '' when there is no formula.
export function renderMathjaxHtml(parsed) {
  const block = parsed && typeof parsed === 'object' ? parsed : {};
  const tex = String(block.formula ?? '').trim().replace(/\s*\n\s*/g, ' ');
  if (!tex) return '';
  const attrs = `class="mathjax-formula mathjax-%DISPLAY%" data-tex="${escapeAttr(tex)}"`;
  if (String(block.display ?? '').trim().toLowerCase() === 'inline') {
    return `<span ${attrs.replace('%DISPLAY%', 'inline')}></span>`;
  }
  return `<div ${attrs.replace('%DISPLAY%', 'block')}></div>`;
}

// Replace every `:mathjax:` block in `markdown` with its HTML. Unparseable blocks are left as written.
export function preprocessMathjaxBlocks(markdown, parseYAML) {
  const source = String(markdown ?? '');
  if (typeof parseYAML !== 'function' || !/^\s*:mathjax:\s*$/m.test(source)) return source;
  const lines = source.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const block = findMathjaxBlock(lines, i, parseYAML);
    if (!block || block.parsed === undefined || block.parsed === null) {
      out.push(lines[i]);
      i += 1;
      continue;
    }
    const html = renderMathjaxHtml(block.parsed);
    if (html) out.push(html);
    // Keep the block's trailing blank lines so slide separators stay where they were.
    let trailing = 0;
    for (let j = block.blockLines.length - 1; j >= 0 && block.blockLines[j].trim() === ''; j -= 1) trailing += 1;
    // A <div> is a markdown HTML block that runs to the next blank line, so it must be followed by
    // one or it would swallow the line after it.
    if (html.startsWith('<div') && trailing === 0 && block.nextIndex < lines.length) trailing = 1;
    for (let j = 0; j < trailing; j += 1) out.push('');
    i = block.nextIndex;
  }
  return out.join('\n');
}

// Parse a raw `:mathjax:` block for the dialog. Returns { values: { formula, display }, extras,
// indent } (display is 'block' or 'inline'; extras holds any other keys), or null if the YAML is
// malformed or not a mapping.
export function parseMathjaxBlock(raw, yaml) {
  const block = findMathjaxBlock(String(raw || '').split('\n'), 0, (text) => yaml.loadAll(text)[0] ?? {});
  if (!block || block.parsed === undefined) return null;
  const parsed = block.parsed ?? {};
  if (typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const extras = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!KNOWN_KEYS.includes(key)) extras[key] = value;
  }
  return {
    values: {
      formula: String(parsed.formula ?? '').trim(),
      display: String(parsed.display ?? '').trim().toLowerCase() === 'inline' ? 'inline' : 'block'
    },
    extras,
    indent: String(raw).match(/^ */)[0]
  };
}

// Build block text from dialog values ({ formula, display }). Returns '' when there is no formula.
export function buildMathjaxBlock(values, yaml, { extras = {}, indent = '' } = {}) {
  const lines = String(values.formula ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return '';
  const out = { version: MATHJAX_VERSION, formula: lines.join('\n') };
  if (values.display === 'inline') out.display = 'inline';
  Object.assign(out, extras);
  const body = yaml.dump(out, { lineWidth: -1 }).trimEnd().split('\n').map((line) => `${indent}  ${line}`);
  return [`${indent}:mathjax:`, ...body].join('\n');
}

// Examples shown in the dialog. `display` is the mode each is meant for.
export const MATHJAX_EXAMPLES = [
  { label: 'Quadratic formula', display: 'block', formula: 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}' },
  { label: 'Pythagorean theorem', display: 'inline', formula: 'a^2 + b^2 = c^2' },
  { label: "Euler's identity", display: 'block', formula: 'e^{i\\pi} + 1 = 0' },
  { label: 'Integral', display: 'block', formula: '\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}' },
  { label: 'Sum', display: 'block', formula: '\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}' },
  { label: 'Limit', display: 'block', formula: '\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1' },
  { label: 'Matrix', display: 'block', formula: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}' },
  { label: 'Piecewise function', display: 'block', formula: 'f(x) = \\begin{cases} x^2 & x \\ge 0 \\\\ -x & x < 0 \\end{cases}' },
  { label: 'Chemical equation', display: 'block', formula: '\\ce{2H2 + O2 -> 2H2O}' },
  { label: 'Energy', display: 'inline', formula: 'E = mc^2' }
];

// [code, description] pairs for the cheat sheet; the code is clickable to add it to the formula.
export const MATHJAX_CHEATSHEET = [
  ['x^2', 'Superscript (use x^{10} for more than one character)'],
  ['x_i', 'Subscript (use x_{ij} for more than one character)'],
  ['\\frac{a}{b}', 'Fraction'],
  ['\\sqrt{x}', 'Square root'],
  ['\\sqrt[3]{x}', 'Cube root'],
  ['\\sum_{i=1}^{n}', 'Sum'],
  ['\\int_a^b', 'Integral'],
  ['\\lim_{x \\to 0}', 'Limit'],
  ['\\alpha \\beta \\pi \\theta', 'Greek letters'],
  ['\\le \\ge \\ne \\approx', 'Comparison symbols'],
  ['\\times \\cdot \\pm \\div', 'Operators'],
  ['\\infty \\partial \\nabla', 'Infinity, partial, nabla'],
  ['\\left( \\frac{a}{b} \\right)', 'Brackets that grow to fit'],
  ['\\text{words}', 'Plain text inside a formula'],
  ['\\cancel{x}', 'Cross out part of a formula'],
  ['\\ce{H2O}', 'Chemical formula'],
  ['\\,', 'Small space (\\; and \\quad are wider)'],
  ['a & b \\\\ c & d', 'Cells and rows inside \\begin{pmatrix} … \\end{pmatrix}']
];
