/*
 * Style Editor model for the Create / Edit Metadata form: read and write one generated block in a
 * presentation's stylesheet (style.css). Pure string logic, no DOM, so Node tests can import it.
 *
 * The editor owns only the text between START_MARK and END_MARK. Everything outside the block is
 * left exactly as the user wrote it. Hand edits inside the block are overwritten on the next save.
 *
 *   STYLE_ELEMENTS        the rows the editor offers (key, label, CSS selector)
 *   SYSTEM_FONTS          the universal font choices (generic sans/serif/mono) ({ key, label, stack })
 *   bundledFonts(manifest) font choices from revelation/css/fonts/fonts.json ({ key, label, stack, importUrl })
 *   FONT_WEIGHTS          the weight choices
 *   FONT_STYLES, TEXT_TRANSFORMS  the italic (italic / normal) and case (uppercase / none) choices
 *   parseStyleBlock(css, fonts)    -> { [elementKey]: { fontFamily?, fontSize?, color?, fontWeight?, fontStyle?, textTransform? } }
 *   buildStyleBlock(s, fonts)      -> block text ('' when nothing is set)
 *   mergeStyleBlock(css, s, fonts) -> css with the block replaced or removed, new block placed first
 *
 * `fonts` is the list the caller offers: SYSTEM_FONTS plus bundledFonts(manifest); it defaults to SYSTEM_FONTS.
 * Settings values: fontFamily is a font key, fontSize a number of em (FONT_SIZE_MIN..MAX), color '#rrggbb',
 * fontWeight a FONT_WEIGHTS value ('300'..'900'), fontStyle 'italic' | 'normal', textTransform 'uppercase' | 'none'
 * (the 'normal'/'none' values switch off what a theme turns on). Anything that does not validate is dropped on both
 * read and write, so a value can never close the rule or inject other CSS.
 * A bundled font is pulled in with `@import url(/css/fonts/<folder>/<folder>.css);` at the top of the block.
 * CSS only honours @import before any rule, so the block is always written at the very top of the file
 * (after an @charset, if any). exportPresentation.js rewrites these URLs to the font CDN for standalone exports.
 * Caller: tab-style.js. Selectors use `.reveal .slides` so they beat the theme's `.reveal h1` rules.
 */

export const START_MARK = '/* >>> REVELation Style Editor (generated: edit in Presentation Properties > Style) >>> */';
export const END_MARK = '/* <<< REVELation Style Editor <<< */';

const SCOPE = '.reveal .slides';

export const STYLE_ELEMENTS = [
  { key: 'h1', label: 'Heading 1', selector: `${SCOPE} h1` },
  { key: 'h2', label: 'Heading 2', selector: `${SCOPE} h2` },
  { key: 'h3', label: 'Heading 3', selector: `${SCOPE} h3` },
  { key: 'h4', label: 'Heading 4', selector: `${SCOPE} h4` },
  { key: 'h5', label: 'Heading 5', selector: `${SCOPE} h5` },
  { key: 'h6', label: 'Heading 6', selector: `${SCOPE} h6` },
  { key: 'p', label: 'Paragraph', selector: `${SCOPE} p` },
  { key: 'li', label: 'List item', selector: `${SCOPE} li` },
  { key: 'blockquote', label: 'Quote', selector: `${SCOPE} blockquote` },
  { key: 'a', label: 'Link', selector: `${SCOPE} a` },
  { key: 'code', label: 'Code', selector: `${SCOPE} code` }
];

// Only fonts present, or metric-compatible (Liberation), on Windows, macOS and Linux: the three generic
// families with their classic names first. Anything else may be missing on the presenting machine, which is
// what the bundled fonts are for.
export const SYSTEM_FONTS = [
  { key: 'sans', label: 'Sans-serif', stack: 'Arial, Helvetica, sans-serif' },
  { key: 'serif', label: 'Serif', stack: '"Times New Roman", Times, serif' },
  { key: 'mono', label: 'Monospace', stack: '"Courier New", Courier, monospace' }
];

export const FONT_WEIGHTS = [
  { value: '300', label: 'Light' },
  { value: '400', label: 'Normal' },
  { value: '500', label: 'Medium' },
  { value: '600', label: 'Semi-bold' },
  { value: '700', label: 'Bold' },
  { value: '800', label: 'Extra bold' },
  { value: '900', label: 'Black' }
];

export const FONT_STYLES = [
  { value: 'italic', label: 'Italic' },
  { value: 'normal', label: 'Upright' }
];

export const TEXT_TRANSFORMS = [
  { value: 'uppercase', label: 'UPPERCASE' },
  { value: 'none', label: 'Normal case' }
];

export const FONT_SIZE_MIN = 0.8;
export const FONT_SIZE_MAX = 3;
export const FONT_SIZE_STEP = 0.05;

const FONT_IMPORT_ROOT = '/css/fonts/';
const GENERIC_FAMILIES = new Set(['serif', 'sans-serif', 'monospace', 'cursive']);

// Turn the fonts.json manifest into font choices, skipping any entry whose fields are not plain
// (they end up in CSS). Sorted by label; ids that clash with a system font key are dropped.
export function bundledFonts(manifest) {
  const taken = new Set(SYSTEM_FONTS.map((f) => f.key));
  const out = [];
  for (const e of Array.isArray(manifest && manifest.fonts) ? manifest.fonts : []) {
    if (!e || !/^[a-z0-9_-]+$/.test(e.id) || taken.has(e.id)) continue;
    if (!/^[A-Za-z0-9 ]+$/.test(e.family) || !GENERIC_FAMILIES.has(e.fallback)) continue;
    if (!/^[a-z0-9_-]+\/[a-z0-9_.-]+\.css$/.test(e.css)) continue;
    taken.add(e.id);
    out.push({
      key: e.id,
      label: String(e.label || e.family),
      stack: `'${e.family}', ${e.fallback}`,
      importUrl: `${FONT_IMPORT_ROOT}${e.css}`
    });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

const weights = new Set(FONT_WEIGHTS.map((w) => w.value));
const styles = new Set(FONT_STYLES.map((o) => o.value));
const transforms = new Set(TEXT_TRANSFORMS.map((o) => o.value));
const elementBySelector = new Map(STYLE_ELEMENTS.map((e) => [e.selector, e.key]));

// Return a clean copy of one element's settings, keeping only valid values. `byKey` maps font key -> font.
function cleanEntry(entry, byKey) {
  const out = {};
  if (!entry || typeof entry !== 'object') return out;
  if (byKey.has(entry.fontFamily)) out.fontFamily = entry.fontFamily;
  const size = Number(entry.fontSize);
  if (entry.fontSize !== '' && entry.fontSize != null && Number.isFinite(size) && size >= FONT_SIZE_MIN && size <= FONT_SIZE_MAX) {
    out.fontSize = Math.round(size * 100) / 100;
  }
  if (typeof entry.color === 'string' && /^#[0-9a-f]{6}$/i.test(entry.color)) out.color = entry.color.toLowerCase();
  if (weights.has(String(entry.fontWeight))) out.fontWeight = String(entry.fontWeight);
  if (styles.has(entry.fontStyle)) out.fontStyle = entry.fontStyle;
  if (transforms.has(entry.textTransform)) out.textTransform = entry.textTransform;
  return out;
}

// Build the generated block from settings. Returns '' when no element has any valid value.
export function buildStyleBlock(settings, fonts = SYSTEM_FONTS) {
  const byKey = new Map(fonts.map((f) => [f.key, f]));
  const imports = [];
  const lines = [];
  const needsNestedReset = [];
  for (const el of STYLE_ELEMENTS) {
    const s = cleanEntry(settings && settings[el.key], byKey);
    const decls = [];
    if (s.fontFamily) {
      const font = byKey.get(s.fontFamily);
      decls.push(`font-family: ${font.stack};`);
      const imp = font.importUrl ? `@import url(${font.importUrl});` : '';
      if (imp && !imports.includes(imp)) imports.push(imp);
    }
    if (s.fontSize != null) decls.push(`font-size: ${s.fontSize}em;`);
    if (s.color) decls.push(`color: ${s.color};`);
    if (s.fontWeight) decls.push(`font-weight: ${s.fontWeight};`);
    if (s.fontStyle) decls.push(`font-style: ${s.fontStyle};`);
    if (s.textTransform) decls.push(`text-transform: ${s.textTransform};`);
    if (!decls.length) continue;
    lines.push(`${el.selector} { ${decls.join(' ')} }`);
    // An em size on a nested element compounds with its parent's (li inside li), so nested ones just match the parent.
    if (el.key === 'li' && s.fontSize != null) needsNestedReset.push(`${SCOPE} li li { font-size: 1em; }`);
  }
  if (!lines.length) return '';
  return [START_MARK, ...imports, ...lines, ...needsNestedReset, END_MARK].join('\n');
}

// Read the settings out of the generated block in `css`. Unknown selectors and values are ignored.
export function parseStyleBlock(css, fonts = SYSTEM_FONTS) {
  const byKey = new Map(fonts.map((f) => [f.key, f]));
  const familyByStack = new Map(fonts.map((f) => [f.stack, f.key]));
  const text = String(css || '');
  const start = text.indexOf(START_MARK);
  if (start === -1) return {};
  const bodyStart = start + START_MARK.length;
  const end = text.indexOf(END_MARK, bodyStart);
  const body = text.slice(bodyStart, end === -1 ? undefined : end).replace(/@import[^;]*;/g, '');
  const settings = {};
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = ruleRe.exec(body))) {
    const key = elementBySelector.get(m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim());
    if (!key) continue;
    const raw = {};
    for (const decl of m[2].split(';')) {
      const idx = decl.indexOf(':');
      if (idx === -1) continue;
      const prop = decl.slice(0, idx).trim().toLowerCase();
      const value = decl.slice(idx + 1).trim();
      if (prop === 'font-family') raw.fontFamily = familyByStack.get(value);
      else if (prop === 'font-size') raw.fontSize = /^[0-9.]+em$/.test(value) ? parseFloat(value) : undefined;
      else if (prop === 'color') raw.color = value;
      else if (prop === 'font-weight') raw.fontWeight = value;
      else if (prop === 'font-style') raw.fontStyle = value;
      else if (prop === 'text-transform') raw.textTransform = value;
    }
    const clean = cleanEntry(raw, byKey);
    if (Object.keys(clean).length) settings[key] = clean;
  }
  return settings;
}

// Replace the generated block in `css` with one built from `settings`: any existing block is removed and
// the new one is placed at the top (after a leading @charset), where its @imports are honoured. Removes the
// block when `settings` has nothing set. Text outside the block is preserved.
export function mergeStyleBlock(css, settings, fonts = SYSTEM_FONTS) {
  let text = String(css || '');
  const start = text.indexOf(START_MARK);
  const endIdx = start === -1 ? -1 : text.indexOf(END_MARK, start + START_MARK.length);
  if (start !== -1 && endIdx !== -1) {
    text = (text.slice(0, start).replace(/\s+$/, '') + '\n' + text.slice(endIdx + END_MARK.length).replace(/^\s+/, '')).replace(/^\s+/, '');
    if (text) text = text.replace(/\s*$/, '\n');
  }
  const block = buildStyleBlock(settings, fonts);
  if (!block) return text;
  const charset = /^\s*@charset\s+[^;]*;\s*/i.exec(text);
  const head = charset ? charset[0].trimEnd() + '\n\n' : '';
  const rest = text.slice(charset ? charset[0].length : 0);
  return `${head}${block}\n${rest ? `\n${rest}` : ''}`;
}
