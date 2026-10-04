function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function normalizeSlide(slide) {
  const top = String(slide?.top || '');
  const body = String(slide?.body || '');
  const notes = String(slide?.notes || '');
  return { top, body, notes };
}

function normalizeStacks(stacks) {
  if (!Array.isArray(stacks)) return [[{ top: '', body: '', notes: '' }]];
  const normalized = stacks
    .map((column) => (Array.isArray(column) ? column.map(normalizeSlide) : []))
    .filter((column) => column.length > 0);
  return normalized.length ? normalized : [[{ top: '', body: '', notes: '' }]];
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function createNewSlide() {
  return {
    top: '',
    body: '',
    notes: ''
  };
}

function moveSlideInStacks(stacks, from, to) {
  const working = normalizeStacks(clone(stacks));
  const fromH = Number(from?.h);
  const fromV = Number(from?.v);
  let toH = Number(to?.h);
  let toV = Number(to?.v);
  const place = to?.place === 'after' ? 'after' : 'before';

  if (![fromH, fromV, toH, toV].every(Number.isInteger)) return null;
  if (!working[fromH] || !working[toH]) return null;
  if (fromV < 0 || fromV >= working[fromH].length) return null;
  if (toV < 0) toV = 0;

  const sourceColumn = working[fromH];
  const [slide] = sourceColumn.splice(fromV, 1);
  if (!slide) return null;

  if (sourceColumn.length === 0) {
    if (working.length > 1) {
      working.splice(fromH, 1);
      if (fromH < toH) {
        toH -= 1;
      }
    } else {
      sourceColumn.push({ top: '', body: '', notes: '' });
    }
  }

  const targetColumn = working[toH];
  if (!targetColumn) return null;
  const insertOffset = place === 'after' ? 1 : 0;
  const rawIndex = toV + insertOffset;
  let insertIndex = clamp(rawIndex, 0, targetColumn.length);

  if (fromH === toH && fromV < toV) {
    insertIndex = Math.max(0, insertIndex - 1);
  }

  targetColumn.splice(insertIndex, 0, slide);
  return normalizeStacks(working);
}

const slideKey = (h, v) => `${h}:${v}`;

function slideIsHidden(slide) {
  return String(slide?.body || '').split('\n').some((line) => line.trim() === ':hide:');
}

// Subtle closed-eye badge centered over a hidden slide's tile.
function createHiddenBadge() {
  const badge = document.createElement('div');
  badge.title = 'Hidden slide (:hide:)';
  badge.style.cssText = [
    'position:absolute',
    'inset:0',
    'z-index:4',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'pointer-events:none'
  ].join(';');
  badge.innerHTML = '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#e8eefc" '
    + 'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" '
    + 'style="opacity:.8;filter:drop-shadow(0 1px 3px rgba(0,0,0,.7))">'
    + '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>'
    + '<path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>'
    + '<path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>'
    + '<line x1="1" y1="1" x2="23" y2="23"/></svg>';
  return badge;
}

function setSlidesHiddenInStacks(stacks, keys, hidden) {
  const working = normalizeStacks(clone(stacks));
  keys.forEach((key) => {
    const [h, v] = String(key).split(':').map(Number);
    const slide = working[h]?.[v];
    if (!slide) return;
    const lines = slide.body.split('\n');
    const has = lines.some((line) => line.trim() === ':hide:');
    if (hidden && !has) {
      const trimmed = slide.body.trimEnd();
      slide.body = trimmed ? `${trimmed}\n:hide:` : ':hide:';
    } else if (!hidden && has) {
      slide.body = lines.filter((line) => line.trim() !== ':hide:').join('\n');
    }
  });
  return working;
}

// Moves several slides (keys "h:v") next to the slide at `to`, keeping their
// relative order. Returns { stacks, keys } with the moved slides' new keys.
function moveSlidesInStacks(stacks, keys, to) {
  const working = normalizeStacks(clone(stacks));
  const toH = Number(to?.h);
  const toV = Number(to?.v);
  const place = to?.place === 'after' ? 'after' : 'before';
  const targetColumn = working[toH];
  if (!targetColumn || !Number.isInteger(toV)) return null;

  const picked = [...new Set(keys)]
    .map((key) => key.split(':').map(Number))
    .filter(([h, v]) => working[h]?.[v])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .map(([h, v]) => working[h][v]);
  if (!picked.length) return null;
  const pickedSet = new Set(picked);

  // Insert position = number of unmoved slides that stay ahead of the target.
  const limit = place === 'after' ? toV + 1 : toV;
  const insertIndex = targetColumn.slice(0, Math.max(limit, 0)).filter((slide) => !pickedSet.has(slide)).length;

  working.forEach((column) => {
    for (let i = column.length - 1; i >= 0; i -= 1) {
      if (pickedSet.has(column[i])) column.splice(i, 1);
    }
  });
  targetColumn.splice(insertIndex, 0, ...picked);
  const result = working.filter((column) => column.length > 0);
  const newKeys = [];
  result.forEach((column, h) => column.forEach((slide, v) => {
    if (pickedSet.has(slide)) newKeys.push(slideKey(h, v));
  }));
  return { stacks: result, keys: newKeys };
}

function insertSlideAfterInStacks(stacks, h, v, slide = createNewSlide()) {
  const working = normalizeStacks(clone(stacks));
  if (!working[h]) return null;
  const insertAt = clamp(Number(v) + 1, 0, working[h].length);
  working[h].splice(insertAt, 0, normalizeSlide(slide));
  return normalizeStacks(working);
}

function duplicateSlideInStacks(stacks, h, v) {
  const working = normalizeStacks(clone(stacks));
  if (!working[h] || !working[h][v]) return null;
  const source = normalizeSlide(working[h][v]);
  const insertAt = clamp(Number(v) + 1, 0, working[h].length);
  working[h].splice(insertAt, 0, source);
  return normalizeStacks(working);
}

function deleteSlideInStacks(stacks, h, v) {
  const working = normalizeStacks(clone(stacks));
  if (!working[h] || !working[h][v]) return null;
  working[h].splice(v, 1);
  if (working[h].length === 0) {
    if (working.length === 1) {
      working[h].push(createNewSlide());
    } else {
      working.splice(h, 1);
    }
  }
  return normalizeStacks(working);
}

// Deletes every slide in keys ("h:v"). Empty columns are dropped; if nothing
// is left a single blank slide remains.
function deleteSlidesInStacks(stacks, keys) {
  const working = normalizeStacks(clone(stacks));
  const doomed = new Set();
  keys.forEach((key) => {
    const [h, v] = String(key).split(':').map(Number);
    if (working[h]?.[v]) doomed.add(working[h][v]);
  });
  if (!doomed.size) return null;
  const remaining = working
    .map((column) => column.filter((slide) => !doomed.has(slide)))
    .filter((column) => column.length > 0);
  return remaining.length ? remaining : [[createNewSlide()]];
}

function insertColumnAfterInStacks(stacks, h) {
  const working = normalizeStacks(clone(stacks));
  const insertAt = clamp(Number(h) + 1, 0, working.length);
  working.splice(insertAt, 0, [createNewSlide()]);
  return normalizeStacks(working);
}

function deleteColumnInStacks(stacks, h) {
  const working = normalizeStacks(clone(stacks));
  if (!working[h]) return null;
  if (working.length === 1) {
    working[0] = [createNewSlide()];
    return normalizeStacks(working);
  }
  working.splice(h, 1);
  return normalizeStacks(working);
}

function moveColumnInStacks(stacks, fromH, toH, place = 'before') {
  const working = normalizeStacks(clone(stacks));
  const sourceH = Number(fromH);
  const targetH = Number(toH);
  const dropPlace = place === 'after' ? 'after' : 'before';
  if (!Number.isInteger(sourceH) || !Number.isInteger(targetH)) return null;
  if (!working[sourceH] || !working[targetH]) return null;
  if (sourceH === targetH) return normalizeStacks(working);

  let insertIndex = targetH + (dropPlace === 'after' ? 1 : 0);
  insertIndex = clamp(insertIndex, 0, working.length);

  const [column] = working.splice(sourceH, 1);
  if (!column) return null;
  if (sourceH < insertIndex) insertIndex -= 1;
  insertIndex = clamp(insertIndex, 0, working.length);
  working.splice(insertIndex, 0, column);
  return normalizeStacks(working);
}

function plainText(text) {
  return String(text || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*:ATTRIB:.*$/gim, '')
    .replace(/^\s*:AI:\s*$/gim, '')
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/!\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/\{\{[^}]+\}\}/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const slideSorterMediaRuntime = {
  slug: '',
  dir: '',
  mediaByTag: {},
  macros: {},
  lastFrontmatter: null
};
let slideSorterInitialized = false;
const SLIDE_SORTER_MODE_ID = 'slide-sorter';

function encodePathSafely(pathValue) {
  const raw = String(pathValue || '');
  if (!raw) return '';
  return raw
    .split('/')
    .map((segment) => {
      if (!segment) return segment;
      let decoded = segment;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        decoded = segment;
      }
      return encodeURIComponent(decoded);
    })
    .join('/');
}

function normalizeFrontmatterYaml(frontmatter) {
  const text = String(frontmatter || '').trim();
  if (!text) return '';
  const wrapped = text.match(/^---\r?\n([\s\S]*?)\r?\n---\s*$/);
  if (wrapped) return wrapped[1];
  return text.replace(/^---\r?\n/, '').replace(/\r?\n---\s*$/, '');
}

function updateMediaRuntime(host, context = {}) {
  const ctxSlug = String(context?.slug || '').trim();
  const ctxDir = String(context?.dir || '').trim();
  if (ctxSlug) slideSorterMediaRuntime.slug = ctxSlug;
  if (ctxDir) slideSorterMediaRuntime.dir = ctxDir;

  if (!host || typeof host.getDocument !== 'function') return;
  const yaml = window.jsyaml;
  if (!yaml || typeof yaml.load !== 'function') return;

  try {
    const doc = host.getDocument();
    const frontmatter = String(doc?.frontmatter || '');
    if (frontmatter === slideSorterMediaRuntime.lastFrontmatter) return;
    slideSorterMediaRuntime.lastFrontmatter = frontmatter;
    slideSorterMediaRuntime.mediaByTag = {};
    slideSorterMediaRuntime.macros = {};

    // Use host.getMetadata() if available (includes merged imports), fallback to manual parse
    let parsed = {};
    if (typeof host.getMetadata === 'function') {
      parsed = host.getMetadata() || {};
    } else {
      const yamlText = normalizeFrontmatterYaml(frontmatter);
      if (!yamlText) return;
      parsed = yaml.load(yamlText) || {};
    }
    const media = parsed?.media && typeof parsed.media === 'object' ? parsed.media : {};
    Object.entries(media).forEach(([tag, entry]) => {
      const key = String(tag || '').trim();
      if (!key) return;
      slideSorterMediaRuntime.mediaByTag[key] = entry || {};
    });
    const macros = parsed?.macros;
    slideSorterMediaRuntime.macros = macros && typeof macros === 'object' && !Array.isArray(macros) ? macros : {};
  } catch {
    slideSorterMediaRuntime.mediaByTag = {};
    slideSorterMediaRuntime.macros = {};
  }
}

function resolveMediaDisplaySrc(rawSrc, host, context = {}) {
  const src = String(rawSrc || '');
  if (!src.trim()) return '';
  if (
    src.startsWith('http://') ||
    src.startsWith('https://') ||
    src.startsWith('data:') ||
    src.startsWith('blob:') ||
    src.startsWith('file:') ||
    src.startsWith('/')
  ) {
    return src;
  }

  updateMediaRuntime(host, context);

  if (src.startsWith('media:')) {
    const tag = src.slice('media:'.length).trim();
    const mediaEntry = slideSorterMediaRuntime.mediaByTag[tag];
    const filename = String(mediaEntry?.filename || '').trim();
    if (!filename) return '';
    const { dir } = slideSorterMediaRuntime;
    if (!dir) return filename;
    return encodePathSafely(`/${dir}/_media/${filename}`);
  }

  const { dir, slug } = slideSorterMediaRuntime;
  if (!dir || !slug) return src;
  return encodePathSafely(`/${dir}/${slug}/${src}`);
}

function parseMarkdownDestination(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (value.startsWith('<')) {
    const close = value.indexOf('>');
    if (close > 1) return value.slice(1, close);
  }
  // Strip quoted title attribute (e.g. `url "title"` or `url 'title'`) if present
  const titleMatch = value.match(/^(.*?)\s+["'].*["']\s*$/);
  if (titleMatch) return titleMatch[1];
  return value;
}

function cleanMediaSrc(raw) {
  let value = String(raw || '').trim();
  if (!value) return '';
  value = parseMarkdownDestination(value);
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1).trim();
  }
  return value;
}

function isBackgroundAlt(alt) {
  return /^background(?::|$)/i.test(String(alt || '').trim());
}

function toThumbnailUrl(displayUrl) {
  if (!displayUrl) return '';
  if (displayUrl.startsWith('data:') || displayUrl.startsWith('blob:')) return '';
  if (/^https?:\/\//.test(displayUrl) && !displayUrl.includes('localhost')) return '';
  // Media library files already have a cached thumbnail at <url>.thumbnail.jpg
  if (displayUrl.includes('/_media/')) return displayUrl + '.thumbnail.jpg';
  // Presentation-local files go through the on-demand thumbs service
  return displayUrl.replace(/\/presentations_([^/]+)\//, '/thumbs_$1/');
}

function isVideoSrc(src) {
  const value = String(src || '').trim();
  if (!value) return false;
  if (/^data:video\//i.test(value)) return true;
  const core = value.split('#')[0].split('?')[0].toLowerCase();
  return /\.(mp4|m4v|mov|webm|ogv|ogg|mkv|avi|wmv|flv|m3u8)$/i.test(core);
}

function extractMediaCandidates(markdown) {
  const body = String(markdown || '');
  const media = [];
  const seen = new Set();
  const pushMedia = (src, type) => {
    const key = `${type}:${src}`;
    if (!src || seen.has(key)) return;
    seen.add(key);
    media.push({ src, type });
  };
  const mdPattern = /!\[([^\]]*)\]\((<[^>]*>|[^)]+)\)/g;
  let match;
  while ((match = mdPattern.exec(body)) !== null) {
    const alt = String(match[1] || '').trim();
    if (isBackgroundAlt(alt)) continue;
    const src = cleanMediaSrc(match[2] || '');
    if (!src) continue;
    pushMedia(src, isVideoSrc(src) ? 'video' : 'image');
    if (media.length >= 6) break;
  }
  if (media.length < 6) {
    const htmlPattern = /<(img|video)\b[^>]*\bsrc\s*=\s*(['"])(.*?)\2[^>]*>/gi;
    while ((match = htmlPattern.exec(body)) !== null) {
      const tag = String(match[1] || '').toLowerCase();
      const src = cleanMediaSrc(match[3] || '');
      if (!src) continue;
      pushMedia(src, tag === 'video' || isVideoSrc(src) ? 'video' : 'image');
      if (media.length >= 6) break;
    }
  }
  return media;
}

function createSquareMediaThumb(preview, size = 56, host = null, context = {}) {
  const media = preview?.primaryMedia;
  if (!media?.src) return null;
  const resolvedSrc = resolveMediaDisplaySrc(media.src, host, context) || media.src;
  const thumbSrc = toThumbnailUrl(resolvedSrc) || resolvedSrc;
  const frame = document.createElement('div');
  frame.style.cssText = [
    'flex:0 0 auto',
    `width:${size}px`,
    `height:${size}px`,
    'overflow:hidden',
    'border-radius:8px',
    'background:rgba(255,255,255,0.08)',
    'align-self:flex-start'
  ].join(';');
  const node = document.createElement('img');
  node.src = thumbSrc;
  node.alt = '';
  node.style.cssText = 'display:block; width:100%; height:100%; object-fit:cover; object-position:center; pointer-events:none;';
  frame.appendChild(node);
  return frame;
}

function parseTwoColumnSegments(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  const segments = [];
  let current = [];
  let sawMarker = false;
  for (const line of lines) {
    if (line.trim() === '||') {
      sawMarker = true;
      segments.push(current.join('\n').trim());
      current = [];
      continue;
    }
    current.push(line);
  }
  if (current.length) segments.push(current.join('\n').trim());
  if (!sawMarker || segments.length < 2) return null;
  return segments.slice(0, 2);
}

function createBackgroundLayer(src, host, context) {
  const resolvedSrc = resolveMediaDisplaySrc(src, host, context) || src;
  if (!resolvedSrc) return null;
  const thumbSrc = toThumbnailUrl(resolvedSrc) || resolvedSrc;
  const layer = document.createElement('div');
  layer.style.cssText = 'position:absolute; inset:0; z-index:0; overflow:hidden; border-radius:10px; pointer-events:none;';
  const img = document.createElement('img');
  img.src = thumbSrc;
  img.alt = '';
  img.style.cssText = 'width:100%; height:100%; object-fit:cover; display:block;';
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:absolute; inset:0; background:rgba(0,0,0,0.7);';
  layer.appendChild(img);
  layer.appendChild(overlay);
  return layer;
}

const AUDIO_PLAY_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" width="18" height="18"><path d="M3 6.5h3.5L11 3v12L6.5 11.5H3z" fill="#6fb2ff"/><path d="M12.5 6a3.5 3.5 0 0 1 0 6" stroke="#6fb2ff" stroke-width="1.5" fill="none" stroke-linecap="round"/><path d="M14 4a6.5 6.5 0 0 1 0 10" stroke="#6fb2ff" stroke-width="1.2" fill="none" stroke-linecap="round" opacity="0.55"/></svg>';
const AUDIO_STOP_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" width="18" height="18"><path d="M3 6.5h3.5L11 3v12L6.5 11.5H3z" fill="#8899aa"/><line x1="12" y1="6" x2="16" y2="12" stroke="#cc4444" stroke-width="1.5" stroke-linecap="round"/><line x1="16" y1="6" x2="12" y2="12" stroke="#cc4444" stroke-width="1.5" stroke-linecap="round"/></svg>';

function createAudioBadge(mode) {
  const badge = document.createElement('div');
  badge.style.cssText = 'position:absolute; top:6px; right:6px; z-index:2; line-height:0; pointer-events:none;';
  badge.innerHTML = mode === 'stop' ? AUDIO_STOP_SVG : AUDIO_PLAY_SVG;
  return badge;
}

// --- Sticky background tracking ---
const cleanBackgroundSrc = (raw) => cleanMediaSrc(raw || '');

// Mirrors the markdown compiler's sticky state (revelation/js/compiler/
// slide-compiler.js finalizeSlide + markdown-line-parsers.js). An identical
// copy lives in the richbuilder (builder-media.js) plugin; keep the two in sync.
//
// Compiler rules modelled here:
// - `![background:sticky](src)` persists across vertical AND horizontal breaks.
// - Any slide that emits a sticky macro (`{{transition:x}}`, `{{lowerthird}}`,
//   `{{attrib:...}}`, `{{ai}}`, user macros, ...) replaces the inherited sticky
//   set, so an inherited background is dropped on that slide and after it —
//   unless the macro itself expands to a `![background:sticky](...)` line.
// - `:clearbg:` hides the inherited background on that slide only.
// - `{{}}` drops sticky inheritance from that slide on.
const STICKY_MACRO_USE_RE = /^\{\{([A-Za-z0-9_]+)(?::([^}]+))?\}\}$/;
const STICKY_BG_TEMPLATE_RE = /^!\[background:sticky\]\(([^)]+)\)\s*$/;
const BG_IMAGE_LINE_RE = /^!\[([^\]]*)\]\((<[^>]*>|[^)]+)\)/;
// Keys of the compiler's defaultMacros (markdown-compiler.js).
const BUILTIN_STICKY_MACROS = new Set([
  'darkbg', 'lightbg', 'darktext', 'lighttext', 'shiftright', 'shiftleft',
  'lowerthird', 'upperthird', 'info', 'infofull', 'columnstart', 'columnbreak',
  'columnend', 'bgtint', 'autoslide', 'audiostart', 'audioloop', 'audiostop'
]);

// Expand a user macro (following nested user macros, like the compiler's
// expandStickyMacroWithNesting) and return the last sticky background it emits.
function stickyBgFromUserMacro(key, paramString, macros, depth = 0, visited = new Set()) {
  if (depth > 10 || visited.has(key)) return '';
  const template = macros[key];
  if (typeof template !== 'string') return '';
  const params = paramString ? paramString.split(':') : [];
  const seen = new Set(visited).add(key);
  let src = '';
  for (const line of template.replace(/\$(\d+)/g, (_, n) => params[+n - 1] ?? '').split('\n')) {
    const nested = line.match(STICKY_MACRO_USE_RE);
    const nestedKey = nested ? nested[1].trim().toLowerCase() : '';
    if (nested && typeof macros[nestedKey] === 'string') {
      src = stickyBgFromUserMacro(nestedKey, nested[2], macros, depth + 1, seen) || src;
      continue;
    }
    const bg = line.match(STICKY_BG_TEMPLATE_RE);
    if (bg) src = bg[1].trim();
  }
  return src;
}

// If `line` is a macro the compiler treats as sticky, return { bg } (the
// sticky background it sets, usually ''); otherwise null.
function classifyStickyMacroLine(line, macros) {
  if (/^\{\{ai\}\}\s*$/i.test(line) || /^\{\{attrib:.*\}\}\s*$/i.test(line)) return { bg: '' };
  const m = line.match(STICKY_MACRO_USE_RE);
  if (!m) return null;
  const key = m[1].trim();
  const lower = key.toLowerCase();
  const params = m[2] ? m[2].split(':') : [];
  if (lower === 'transition') return params[0]?.trim() ? { bg: '' } : null;
  if (lower === 'animate') {
    const mode = String(params[0] || '').trim().toLowerCase();
    return !mode || mode === 'restart' ? { bg: '' } : null;
  }
  if (lower === 'audio') {
    const command = String(params[0] || '').toLowerCase();
    const hasSrc = !!params.slice(1).join(':');
    return ['play', 'playloop', 'loop'].includes(command) && hasSrc ? { bg: '' } : null;
  }
  if (typeof macros[key] === 'string') return { bg: stickyBgFromUserMacro(key, m[2], macros) };
  if (BUILTIN_STICKY_MACROS.has(key)) return { bg: '' };
  return null; // unknown macro: the compiler leaves it as plain text
}

// Background-related directives for one slide. Top matter wins; the body is
// only checked for a background image when the top matter has none.
function parseSlideBackground(slide, macros = {}) {
  const result = {
    backgroundSrc: '',
    backgroundIsSticky: false,
    clearBg: false,
    resetSticky: false,
    emitsSticky: false,
    macroStickyBg: ''
  };
  const topLines = String(slide?.top || '').split(/\r?\n/);
  const bodyLines = String(slide?.body || '').split(/\r?\n/);
  [...topLines, ...bodyLines].forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    if (/^:clearbg:/i.test(line)) { result.clearBg = true; return; }
    if (line === '{{}}') { result.resetSticky = true; return; }
    const macro = classifyStickyMacroLine(line, macros);
    if (macro) {
      result.emitsSticky = true;
      if (macro.bg) result.macroStickyBg = macro.bg;
      return;
    }
    const inBody = index >= topLines.length;
    if (inBody && result.backgroundSrc) return;
    if (!line.startsWith('![')) return;
    const bgMatch = line.match(BG_IMAGE_LINE_RE);
    if (!bgMatch || !/^background(?::|$)/i.test(bgMatch[1].trim())) return;
    result.backgroundSrc = cleanBackgroundSrc(bgMatch[2]);
    result.backgroundIsSticky = /\bsticky\b/i.test(bgMatch[1]);
    if (result.backgroundIsSticky) result.emitsSticky = true;
  });
  return result;
}

// Advance sticky-background state by one slide.
function stepBackground(bg, stickyBg) {
  const inherited = bg.resetSticky ? '' : stickyBg;
  // A slide that emits its own sticky macros replaces the inherited set
  // instead of replaying it.
  const replayed = bg.emitsSticky ? '' : inherited;
  const ownSticky = bg.backgroundIsSticky ? bg.backgroundSrc : '';
  return {
    effectiveBg: bg.backgroundSrc || bg.macroStickyBg || (bg.clearBg ? '' : replayed),
    stickyBg: bg.emitsSticky ? (ownSticky || bg.macroStickyBg) : inherited
  };
}

// Effective background for every slide in the deck, as [h][v].
function computeEffectiveBackgrounds(stacks, macros = {}) {
  let stickyBg = '';
  return (Array.isArray(stacks) ? stacks : []).map((column) =>
    (Array.isArray(column) ? column : []).map((slide) => {
      const step = stepBackground(parseSlideBackground(slide, macros), stickyBg);
      stickyBg = step.stickyBg;
      return step.effectiveBg;
    }));
}

function parseSlidePreview(slide) {
  const body = String(slide?.body || '');
  const notes = String(slide?.notes || '');
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  let heading = '';
  let audioMode = null;
  const textLines = [];
  const citeLines = [];
  const takeCite = (raw) => {
    const matches = String(raw || '').match(/<cite\b[^>]*>([\s\S]*?)<\/cite>/gi) || [];
    matches.forEach((entry) => {
      const inner = entry.replace(/^<cite\b[^>]*>/i, '').replace(/<\/cite>$/i, '');
      const cleaned = plainText(inner);
      if (cleaned) citeLines.push(cleaned);
    });
  };

  lines.forEach((line) => {
    if (/^:audio:(play|loop):/i.test(line)) { audioMode = 'play'; return; }
    if (/^:audio:stop:/i.test(line)) { audioMode = 'stop'; return; }
    if (/^:clearbg:/i.test(line)) return;
    if (/^:ATTRIB:/i.test(line)) {
      const attrib = plainText(line.replace(/^:ATTRIB:/i, ''));
      if (attrib) citeLines.push(attrib);
      return;
    }
    takeCite(line);
    if (!heading && line.startsWith('#')) {
      heading = plainText(line.replace(/^#+\s*/, ''));
      return;
    }
    if (line.startsWith('![')) return;
    if (line === '||') return;
    const cleaned = plainText(String(line).replace(/<cite\b[^>]*>[\s\S]*?<\/cite>/gi, ' '));
    if (cleaned) textLines.push(cleaned);
  });

  const columns = parseTwoColumnSegments(body);
  const media = extractMediaCandidates(body);
  const images = media.filter((item) => item.type === 'image').map((item) => item.src).slice(0, 4);
  const hasMedia = media.length > 0;
  const isBlank = !heading && textLines.length === 0 && citeLines.length === 0 && !hasMedia;
  const imageOnly = hasMedia && !heading && textLines.length === 0 && citeLines.length === 0;
  return {
    heading,
    bodyLines: textLines.slice(0, 4),
    citeLines: citeLines.slice(0, 2),
    images,
    media,
    primaryMedia: media[0] || null,
    twoCol: columns,
    isBlank,
    imageOnly,
    audioMode,
    notesHeading: extractNotesHeading(notes)
  };
}

function extractNotesHeading(notes) {
  const lines = String(notes || '').split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^#{1,3}\s+(.+)/);
    if (match) return match[1].trim();
  }
  return '';
}

const ANIMATE_GROUP_COLOR = '#f59e0b';

function slideHasAnimate(slide) {
  const lines = `${slide?.top || ''}\n${slide?.body || ''}`.split(/\r?\n/);
  return lines.some((line) => /^(:animate(:restart)?:|\{\{\s*animate(\s*:?\s*restart)?\s*\}\})\s*$/i.test(line.trim()));
}

function slideRestartsAnimate(slide) {
  return `${slide?.top || ''}\n${slide?.body || ''}`
    .split(/\r?\n/)
    .some((line) => /^(:animate:restart:|\{\{\s*animate\s*:?\s*restart\s*\}\})\s*$/i.test(line.trim()));
}

// Runs of consecutive slides in a column containing :animate:. A restart
// macro begins a new run. Returns { index, size } for slide v, or null when
// the slide is not part of a run of two or more.
function getAnimateGroupInfo(column, v) {
  if (!Array.isArray(column) || !slideHasAnimate(column[v])) return null;
  let start = v;
  while (start > 0 && slideHasAnimate(column[start - 1]) && !slideRestartsAnimate(column[start])) start -= 1;
  let end = v;
  while (end < column.length - 1 && slideHasAnimate(column[end + 1]) && !slideRestartsAnimate(column[end + 1])) end += 1;
  const size = end - start + 1;
  return size > 1 ? { index: v - start, size } : null;
}

// Decorates a tile as part of an animate run: amber border, faint tint, an
// "n/total" badge, and a connector band painted across the gap to the next
// member. `host` is the element that owns the border box (the connector is
// positioned against it); bridge (px) is the gap to span.
function applyAnimateGroupStyle(el, info, bridge = 0, host = el) {
  if (!info) return;
  const last = info.index === info.size - 1;
  el.dataset.animateGroup = `${info.index + 1}/${info.size}`;
  host.style.position = 'relative';
  host.style.borderColor = ANIMATE_GROUP_COLOR;
  el.style.boxShadow = 'inset 0 0 0 100px rgba(245,158,11,0.10)';
  if (bridge > 0 && !last) {
    const connector = document.createElement('div');
    connector.title = `Auto-animate sequence (${info.index + 1} of ${info.size})`;
    connector.style.cssText = [
      'position:absolute',
      'left:14px',
      'right:14px',
      'top:calc(100% + 1px)',
      `height:${bridge + 1}px`,
      'z-index:3',
      'pointer-events:none',
      `background:${ANIMATE_GROUP_COLOR}`
    ].join(';');
    host.appendChild(connector);
  }
  const badge = document.createElement('div');
  badge.textContent = `▶ ${info.index + 1}/${info.size}`;
  badge.style.cssText = [
    'position:absolute',
    'right:6px',
    'top:6px',
    'z-index:3',
    'pointer-events:none',
    'padding:1px 6px',
    'border-radius:999px',
    'font:700 10px/1.4 sans-serif',
    'color:#1b1304',
    `background:${ANIMATE_GROUP_COLOR}`
  ].join(';');
  el.appendChild(badge);
}

function createNavigatorTileRenderer(rendererCtx = {}) {
  let menuEl = null;
  const closeMenu = () => {
    if (!menuEl) return;
    document.removeEventListener('mousedown', handleOutside, true);
    document.removeEventListener('keydown', handleKeydown, true);
    menuEl.remove();
    menuEl = null;
  };
  const handleOutside = (event) => {
    if (!menuEl) return;
    if (menuEl.contains(event.target)) return;
    closeMenu();
  };
  const handleKeydown = (event) => {
    if (event.key === 'Escape') {
      closeMenu();
    }
  };
  const openMenu = (x, y, items = []) => {
    closeMenu();
    if (!items.length) return;
    const menu = document.createElement('div');
    menu.style.cssText = [
      'position:fixed',
      'left:0',
      'top:0',
      'z-index:24000',
      'min-width:180px',
      'padding:6px',
      'border-radius:10px',
      'border:1px solid rgba(255,255,255,0.16)',
      'background:rgba(19,27,40,0.98)',
      'box-shadow:0 12px 28px rgba(0,0,0,0.45)',
      'display:flex',
      'flex-direction:column',
      'gap:4px'
    ].join(';');
    items.forEach((item) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'panel-button';
      btn.textContent = item.label;
      btn.style.cssText = [
        'text-align:left',
        'font:12px/1.2 sans-serif',
        'padding:8px 10px'
      ].join(';');
      btn.addEventListener('click', () => {
        closeMenu();
        item.action?.();
      });
      menu.appendChild(btn);
    });
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    const left = Math.min(Math.max(8, x), window.innerWidth - rect.width - 8);
    const top = Math.min(Math.max(8, y), window.innerHeight - rect.height - 8);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menuEl = menu;
    document.addEventListener('mousedown', handleOutside, true);
    document.addEventListener('keydown', handleKeydown, true);
  };

  return ({ host, slide, h, v, hasTopMatter, selectedVs = [], clearMultiSelection }) => {
    const preview = parseSlidePreview(slide);

    // Effective background, inheriting sticky bg from any earlier slide in the deck.
    const stacks = host?.getDocument?.()?.stacks || [];
    updateMediaRuntime(host);
    const macros = slideSorterMediaRuntime.macros;
    const effectiveBg = computeEffectiveBackgrounds(stacks, macros)[h]?.[v]
      ?? parseSlideBackground(slide, macros).backgroundSrc;

    const shell = document.createElement('div');
    shell.style.cssText = [
      'position:relative',
      'display:flex',
      'flex-direction:column',
      'min-height:110px'
    ].join(';');

    if (effectiveBg) {
      const bgLayer = createBackgroundLayer(effectiveBg, host || null, rendererCtx);
      if (bgLayer) shell.appendChild(bgLayer);
    }
    if (hasTopMatter) {
      const topBar = document.createElement('div');
      topBar.style.cssText = [
        'position:absolute',
        'left:0',
        'top:0',
        'width:100%',
        'height:4px',
        'z-index:2',
        'background:#ef4444'
      ].join(';');
      shell.appendChild(topBar);
    }
    if (preview.audioMode) shell.appendChild(createAudioBadge(preview.audioMode));

    const contentWrap = document.createElement('div');
    contentWrap.style.cssText = 'position:relative; z-index:1; flex:1; display:flex; flex-direction:column; gap:6px; padding:10px;';

    const id = document.createElement('div');
    id.textContent = `V${Number(v) + 1}`;
    id.style.cssText = 'font:10px/1.2 sans-serif; color:#a7b4cf; text-transform:uppercase; letter-spacing:.04em;';
    contentWrap.appendChild(id);

    const titleText = preview.heading || (preview.imageOnly ? '🖼️' : (preview.isBlank ? '' : ''));
    if (titleText) {
      const title = document.createElement('div');
      title.textContent = titleText;
      title.style.cssText = 'font:700 14px/1.25 sans-serif; color:#eef3ff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;';
      contentWrap.appendChild(title);
    }

    const bodyWrap = document.createElement('div');
    bodyWrap.style.cssText = 'display:flex; gap:8px; min-height:34px; align-items:flex-start;';
    const textCol = document.createElement('div');
    textCol.style.cssText = 'min-width:0; flex:1 1 auto;';

    if (preview.twoCol) {
      const twoCol = document.createElement('div');
      twoCol.style.cssText = 'display:grid; grid-template-columns:1fr 1fr; gap:6px;';
      preview.twoCol.forEach((segment, index) => {
        const block = document.createElement('div');
        block.textContent = plainText(segment) || `(column ${index + 1})`;
        block.style.cssText = [
          'min-height:38px',
          'padding:4px 5px',
          'border-radius:6px',
          'font:10px/1.2 sans-serif',
          'background:rgba(255,255,255,0.08)',
          'overflow:hidden'
        ].join(';');
        twoCol.appendChild(block);
      });
      textCol.appendChild(twoCol);
    } else {
      const body = document.createElement('div');
      body.style.cssText = 'font:11px/1.3 sans-serif; color:#bcc8de; min-height:34px;';
      if (preview.bodyLines.length) {
        preview.bodyLines.slice(0, 3).forEach((line) => {
          const textLine = document.createElement('div');
          textLine.textContent = line;
          body.appendChild(textLine);
        });
      } else if (preview.citeLines.length) {
        preview.citeLines.forEach((line) => {
          const citeLine = document.createElement('div');
          citeLine.textContent = line;
          citeLine.style.cssText = 'font-style:italic; color:#a9b8d5;';
          body.appendChild(citeLine);
        });
      } else if (preview.isBlank) {
        body.textContent = '(blank slide)';
        body.style.fontStyle = 'italic';
        body.style.color = '#7f8aa3';
      }
      textCol.appendChild(body);
    }
    bodyWrap.appendChild(textCol);
    const navThumb = createSquareMediaThumb(preview, 52, host || null, rendererCtx);
    if (navThumb) {
      bodyWrap.appendChild(navThumb);
    }
    contentWrap.appendChild(bodyWrap);
    if (preview.notesHeading) {
      const noteLabel = document.createElement('div');
      noteLabel.textContent = preview.notesHeading;
      noteLabel.style.cssText = [
        'margin-top:4px',
        'padding:2px 5px',
        'border-radius:4px',
        'font:bold 10px/1.3 sans-serif',
        'background:rgba(111,178,255,0.12)',
        'color:#8ec5ff',
        'border:1px solid rgba(111,178,255,0.25)',
        'white-space:nowrap',
        'overflow:hidden',
        'text-overflow:ellipsis',
        'text-transform:uppercase'
      ].join(';');
      contentWrap.appendChild(noteLabel);
    }
    shell.appendChild(contentWrap);

    if (slideIsHidden(slide)) {
      shell.style.opacity = '.55';
      shell.appendChild(createHiddenBadge());
    }

    const animateInfo = getAnimateGroupInfo(stacks[h], v);
    if (animateInfo) {
      // The sidebar item clips overflow; let it show the connector and clip the tile itself instead.
      shell.style.borderRadius = '9px';
      shell.style.overflow = 'hidden';
      queueMicrotask(() => {
        const item = shell.parentElement;
        if (!item) return;
        item.style.overflow = 'visible';
        applyAnimateGroupStyle(shell, animateInfo, 10, item);
        if (selectedVs.includes(v)) item.style.borderColor = '';
      });
    }

    shell.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const activeHost = host || window.RevelationBuilderHost;
      if (!activeHost) return;
      const inGroup = selectedVs.includes(v);
      const targetVs = inGroup ? selectedVs : [v];
      const keys = targetVs.map((tv) => slideKey(h, tv));
      const currentStacks = activeHost.getDocument()?.stacks || [];
      const hiddenStates = targetVs.map((tv) => slideIsHidden(currentStacks[h]?.[tv]));
      const setHidden = (hidden) => {
        activeHost.transact(hidden ? 'Sidebar hide slides' : 'Sidebar unhide slides', (tx) => {
          tx.replaceStacks(setSlidesHiddenInStacks(currentStacks, keys, hidden));
        });
      };
      const visibilityItems = [];
      if (hiddenStates.some((state) => !state)) {
        visibilityItems.push({
          label: keys.length > 1 ? `Hide ${keys.length} Slides` : 'Hide Slide',
          action: () => setHidden(true)
        });
      }
      if (hiddenStates.some(Boolean)) {
        visibilityItems.push({
          label: keys.length > 1 ? `Unhide ${keys.length} Slides` : 'Unhide Slide',
          action: () => setHidden(false)
        });
      }
      if (inGroup) {
        openMenu(event.clientX, event.clientY, [
          ...visibilityItems,
          {
            label: `Delete ${keys.length} Slides`,
            action: () => {
              const next = deleteSlidesInStacks(currentStacks, keys);
              if (!next) return;
              clearMultiSelection?.();
              const nextH = clamp(h, 0, Math.max(next.length - 1, 0));
              const nextV = clamp(Math.min(...targetVs), 0, Math.max((next[nextH] || []).length - 1, 0));
              activeHost.transact('Sidebar delete slides', (tx) => {
                tx.replaceStacks(next);
                tx.setSelection({ h: nextH, v: nextV });
              });
            }
          },
          { label: 'Clear Selection', action: () => clearMultiSelection?.() }
        ]);
        return;
      }
      openMenu(event.clientX, event.clientY, [
        {
          label: 'Insert Slide After',
          action: () => {
            const doc = activeHost.getDocument();
            const moved = insertSlideAfterInStacks(doc?.stacks || [], h, v, createNewSlide());
            if (!moved) return;
            const nextColumn = moved[h] || [];
            const nextV = Math.min(v + 1, Math.max(nextColumn.length - 1, 0));
            activeHost.transact('Sidebar insert slide', (tx) => {
              tx.replaceStacks(moved);
              tx.setSelection({ h, v: nextV });
            });
          }
        },
        {
          label: 'Duplicate Slide',
          action: () => {
            const doc = activeHost.getDocument();
            const moved = duplicateSlideInStacks(doc?.stacks || [], h, v);
            if (!moved) return;
            const nextColumn = moved[h] || [];
            const nextV = Math.min(v + 1, Math.max(nextColumn.length - 1, 0));
            activeHost.transact('Sidebar duplicate slide', (tx) => {
              tx.replaceStacks(moved);
              tx.setSelection({ h, v: nextV });
            });
          }
        },
        ...visibilityItems,
        {
          label: 'Delete Slide',
          action: () => {
            const doc = activeHost.getDocument();
            const moved = deleteSlideInStacks(doc?.stacks || [], h, v);
            if (!moved) return;
            const nextH = clamp(h, 0, Math.max(moved.length - 1, 0));
            const nextColumn = moved[nextH] || [];
            const nextV = clamp(v, 0, Math.max(nextColumn.length - 1, 0));
            activeHost.transact('Sidebar delete slide', (tx) => {
              tx.replaceStacks(moved);
              tx.setSelection({ h: nextH, v: nextV });
            });
          }
        },
        {
          label: 'Open Slide Sorter',
          action: () => {
            activateSlideSorterMode(activeHost);
          }
        }
      ]);
    });

    return shell;
  };
}

function deactivateSlideSorterMode(host) {
  if (!host || typeof host.getActiveModeId !== 'function') return;
  if (host.getActiveModeId() === SLIDE_SORTER_MODE_ID) host.setActiveMode('');
}

function activateSlideSorterMode(host) {
  if (!host || typeof host.setActiveMode !== 'function') return;
  host.setActiveMode(SLIDE_SORTER_MODE_ID);
}

class SlideSorterView {
  constructor(host, modeCtx = {}) {
    this.host = host;
    this.modeCtx = modeCtx;
    this.root = null;
    this.viewport = null;
    this.board = null;
    this.matrix = null;
    this.dragSource = null;
    this.dragGroup = null;
    this.multiSel = new Set();
    this.anchor = null;
    this.columnDragSource = null;
    this.stacks = [];
    this.contextMenuEl = null;
    this.contextMenuBackdropHandler = (event) => {
      if (!this.contextMenuEl) return;
      if (this.contextMenuEl.contains(event.target)) return;
      this.closeContextMenu();
    };
    this.contextMenuKeyHandler = (event) => {
      if (event.key === 'Escape') {
        this.closeContextMenu();
      }
    };
    this.keyHandler = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (this.multiSel.size) {
          this.multiSel.clear();
          this.refresh();
          return;
        }
        deactivateSlideSorterMode(this.host);
        return;
      }

      const navKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'];
      if (!navKeys.includes(event.key)) return;
      const target = event.target;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

      event.preventDefault();
      const sel = this.host.getSelection();
      const h = sel.h;
      const v = sel.v;
      const maxH = Math.max(this.stacks.length - 1, 0);
      const colLen = (col) => Math.max((this.stacks[col] || []).length - 1, 0);
      let nextH = h;
      let nextV = v;

      switch (event.key) {
        case 'ArrowLeft':
          nextH = Math.max(h - 1, 0);
          nextV = Math.min(v, colLen(nextH));
          break;
        case 'ArrowRight':
          nextH = Math.min(h + 1, maxH);
          nextV = Math.min(v, colLen(nextH));
          break;
        case 'ArrowUp':
          nextV = Math.max(v - 1, 0);
          break;
        case 'ArrowDown':
          nextV = Math.min(v + 1, colLen(h));
          break;
        case 'Home':
          nextH = 0; nextV = 0;
          break;
        case 'End':
          nextH = maxH; nextV = colLen(nextH);
          break;
        case 'PageUp':
          nextV = 0;
          break;
        case 'PageDown':
          nextV = colLen(h);
          break;
      }

      if (this.multiSel.size) this.multiSel.clear();
      if (nextH === h && nextV === v) { this.refresh(); return; }
      this.host.transact('Slide sorter navigate', (tx) => {
        tx.setSelection({ h: nextH, v: nextV });
      });
      this.refresh();
    };
  }

  // Renders into the host's workspace root for this view tab.
  mount(container) {
    if (this.root || !container) return;
    const root = document.createElement('div');
    root.style.cssText = [
      'position:absolute',
      'inset:0',
      'display:flex',
      'flex-direction:column',
      'background:#0d111a',
      'color:#f2f4f8'
    ].join(';');

    const header = document.createElement('div');
    header.style.cssText = [
      'display:flex',
      'align-items:center',
      'justify-content:space-between',
      'padding:10px 14px',
      'border-bottom:1px solid rgba(255,255,255,0.12)',
      'background:#121a29'
    ].join(';');
    const title = document.createElement('div');
    title.textContent = 'Slide Sorter';
    title.style.cssText = 'font:600 15px/1.2 sans-serif;';
    header.appendChild(title);

    const help = document.createElement('div');
    help.textContent = 'Drag tiles to reorder. Ctrl/Cmd-click or Shift-click to select several. Right-click for hide/unhide. Double-click opens a slide.';
    help.style.cssText = 'font:12px/1.2 sans-serif;opacity:.8;';
    header.appendChild(help);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = 'Done';
    closeBtn.className = 'panel-button';
    closeBtn.addEventListener('click', () => deactivateSlideSorterMode(this.host));
    header.appendChild(closeBtn);

    const viewport = document.createElement('div');
    viewport.style.cssText = [
      'flex:1',
      'overflow:auto',
      'padding:16px',
      'background:linear-gradient(180deg,#0b1320 0%, #0e1624 100%)'
    ].join(';');

    const board = document.createElement('div');
    board.style.cssText = 'min-height:100%;';
    viewport.appendChild(board);

    root.appendChild(header);
    root.appendChild(viewport);
    container.appendChild(root);
    document.addEventListener('keydown', this.keyHandler);
    document.addEventListener('mousedown', this.contextMenuBackdropHandler);
    document.addEventListener('keydown', this.contextMenuKeyHandler);

    this.root = root;
    this.viewport = viewport;
    this.board = board;
    this.refresh();
  }

  dispose() {
    document.removeEventListener('keydown', this.keyHandler);
    document.removeEventListener('mousedown', this.contextMenuBackdropHandler);
    document.removeEventListener('keydown', this.contextMenuKeyHandler);
    this.closeContextMenu();
    if (this.root) this.root.remove();
    this.root = null;
    this.viewport = null;
    this.board = null;
    this.matrix = null;
    this.dragSource = null;
    this.dragGroup = null;
    this.multiSel.clear();
    this.anchor = null;
    this.columnDragSource = null;
  }

  refresh() {
    if (!this.board) return;
    const doc = this.host.getDocument();
    this.stacks = normalizeStacks(doc?.stacks || []);
    this.multiSel.forEach((key) => {
      const [h, v] = key.split(':').map(Number);
      if (!this.stacks[h]?.[v]) this.multiSel.delete(key);
    });
    if (this.multiSel.size < 2) this.multiSel.clear();
    this.closeContextMenu();
    this.renderBoard();
  }

  commit(newStacks, reason = 'Slide sorter move') {
    const payload = normalizeStacks(newStacks);
    this.host.transact(reason, (tx) => {
      tx.replaceStacks(payload);
    });
    this.refresh();
  }

  setHidden(keys, hidden) {
    const next = setSlidesHiddenInStacks(this.stacks, keys, hidden);
    this.commit(next, hidden ? 'Slide sorter hide slides' : 'Slide sorter unhide slides');
  }

  moveByDropTarget(target) {
    if (!this.dragSource || !target) return;
    const from = this.dragSource;
    const to = {
      h: Number(target.dataset.h),
      v: Number(target.dataset.v),
      place: target.dataset.place || 'before'
    };
    if (this.dragGroup && this.dragGroup.length > 1) {
      const result = moveSlidesInStacks(this.stacks, this.dragGroup, to);
      this.dragGroup = null;
      if (!result) return;
      this.multiSel = new Set(result.keys);
      const [first] = result.keys[0].split(':').map(Number);
      const firstV = Number(result.keys[0].split(':')[1]);
      this.host.transact('Slide sorter move slides', (tx) => {
        tx.replaceStacks(normalizeStacks(result.stacks));
        tx.setSelection({ h: first, v: firstV });
      });
      this.refresh();
      return;
    }
    const moved = moveSlideInStacks(this.stacks, from, to);
    if (!moved) return;
    this.commit(moved);
  }

  moveColumnByDropTarget(toH, place = 'before') {
    if (!Number.isInteger(this.columnDragSource)) return;
    const fromH = this.columnDragSource;
    const moved = moveColumnInStacks(this.stacks, fromH, toH, place);
    this.columnDragSource = null;
    if (!moved) return;
    this.commit(moved, 'Slide sorter move column');
  }

  clearColumnDropIndicators() {
    if (!(this.matrix instanceof HTMLElement)) return;
    this.matrix.querySelectorAll('[data-column-index]').forEach((columnEl) => {
      if (!(columnEl instanceof HTMLElement)) return;
      columnEl.style.boxShadow = '';
    });
  }

  setColumnDropIndicator(targetH, place = 'before') {
    this.clearColumnDropIndicators();
    if (!(this.matrix instanceof HTMLElement)) return;
    const columnEl = this.matrix.querySelector(`[data-column-index="${targetH}"]`);
    if (!(columnEl instanceof HTMLElement)) return;
    columnEl.style.boxShadow = place === 'after'
      ? 'inset -6px 0 0 #3b9cff'
      : 'inset 6px 0 0 #3b9cff';
  }

  scrollSelectedIntoView() {
    const selection = this.host.getSelection();
    const tile = this.board.querySelector(`[data-h="${selection.h}"][data-v="${selection.v}"]`);
    if (tile instanceof HTMLElement) {
      tile.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  renderBoard() {
    const selection = this.host.getSelection();
    this.board.innerHTML = '';
    this.matrix = null;
    const oneColumn = this.stacks.length <= 1;

    if (oneColumn) {
      this.board.appendChild(this.renderColumnStrip({ oneColumn: true }));
      const grid = document.createElement('div');
      grid.style.cssText = [
        'display:grid',
        'grid-template-columns:repeat(auto-fill,minmax(200px,1fr))',
        'gap:12px',
        'align-items:start'
      ].join(';');
      const slides = this.stacks[0] || [];
      updateMediaRuntime(this.host);
      const backgrounds = computeEffectiveBackgrounds(this.stacks, slideSorterMediaRuntime.macros);
      slides.forEach((slide, v) => {
        const tile = this.createTile(slide, 0, v, selection, backgrounds[0][v]);
        grid.appendChild(tile);
      });
      const endZone = this.createDropZone(0, slides.length - 1, 'after');
      endZone.style.minHeight = '46px';
      endZone.textContent = 'Drop here to place at end';
      grid.appendChild(endZone);
      this.board.appendChild(grid);
      this.scrollSelectedIntoView();
      return;
    }

    const canvas = document.createElement('div');
    canvas.style.cssText = [
      'display:flex',
      'flex-direction:column',
      'gap:10px',
      'width:max-content',
      'min-width:100%'
    ].join(';');
    canvas.appendChild(this.renderColumnStrip({ oneColumn: false }));

    const matrix = document.createElement('div');
    matrix.style.cssText = [
      'display:grid',
      'grid-auto-flow:column',
      'grid-auto-columns:240px',
      'gap:16px',
      'align-items:start',
      'width:max-content',
      'min-height:100%'
    ].join(';');

    updateMediaRuntime(this.host);
    const backgrounds = computeEffectiveBackgrounds(this.stacks, slideSorterMediaRuntime.macros);
    this.stacks.forEach((column, h) => {
      const columnEl = document.createElement('div');
      columnEl.dataset.columnIndex = String(h);
      columnEl.style.cssText = [
        'display:flex',
        'flex-direction:column',
        'gap:10px',
        'padding:10px',
        'background:rgba(255,255,255,0.04)',
        'border:1px solid rgba(255,255,255,0.1)',
        'border-radius:10px',
        'min-height:90px'
      ].join(';');
      const heading = document.createElement('div');
      heading.textContent = `Column ${h + 1}`;
      heading.style.cssText = 'font:600 12px/1.2 sans-serif; opacity:.8;';
      columnEl.appendChild(heading);

      column.forEach((slide, v) => {
        const tile = this.createTile(slide, h, v, selection, backgrounds[h][v]);
        columnEl.appendChild(tile);
      });

      const endZone = this.createDropZone(h, column.length - 1, 'after');
      endZone.textContent = 'Drop to append';
      endZone.style.minHeight = '30px';
      columnEl.appendChild(endZone);
      matrix.appendChild(columnEl);
    });

    this.matrix = matrix;
    canvas.appendChild(matrix);
    this.board.appendChild(canvas);
    this.scrollSelectedIntoView();
  }

  renderColumnStrip({ oneColumn = false } = {}) {
    const strip = document.createElement('div');
    if (oneColumn) {
      strip.style.cssText = [
        'display:flex',
        'align-items:center',
        'gap:8px',
        'padding:6px 4px 12px'
      ].join(';');
    } else {
      strip.style.cssText = [
        'display:grid',
        'grid-auto-flow:column',
        'grid-auto-columns:240px',
        'gap:16px',
        'align-items:stretch',
        'width:max-content',
        'padding:6px 0'
      ].join(';');
    }
    this.stacks.forEach((column, h) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.textContent = `Column ${h + 1} (${column.length})`;
      chip.className = 'panel-button';
      chip.draggable = this.stacks.length > 1;
      const clearDropIndicator = () => {
        chip.style.borderColor = '';
        chip.style.background = '';
        chip.style.boxShadow = '';
      };
      const setDropIndicator = (place) => {
        chip.style.background = 'rgba(122,168,255,0.12)';
        chip.style.borderColor = '#7aa8ff';
        chip.style.boxShadow = place === 'after'
          ? 'inset -4px 0 0 #7aa8ff'
          : 'inset 4px 0 0 #7aa8ff';
        this.setColumnDropIndicator(h, place);
      };
      chip.style.cssText = oneColumn
        ? 'white-space:nowrap;'
        : 'white-space:nowrap; width:100%; text-align:left; justify-content:flex-start;';
      chip.addEventListener('dragstart', (event) => {
        if (this.stacks.length <= 1) return;
        this.columnDragSource = h;
        chip.style.opacity = '0.55';
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', String(h));
        }
      });
      chip.addEventListener('dragend', () => {
        this.columnDragSource = null;
        chip.style.opacity = '';
        clearDropIndicator();
        this.clearColumnDropIndicators();
      });
      chip.addEventListener('dragover', (event) => {
        if (!Number.isInteger(this.columnDragSource)) return;
        event.preventDefault();
        const rect = chip.getBoundingClientRect();
        const place = event.clientX >= rect.left + rect.width / 2 ? 'after' : 'before';
        setDropIndicator(place);
      });
      chip.addEventListener('dragleave', () => {
        clearDropIndicator();
        this.clearColumnDropIndicators();
      });
      chip.addEventListener('drop', (event) => {
        if (!Number.isInteger(this.columnDragSource)) return;
        event.preventDefault();
        const rect = chip.getBoundingClientRect();
        const place = event.clientX >= rect.left + rect.width / 2 ? 'after' : 'before';
        clearDropIndicator();
        this.clearColumnDropIndicators();
        this.moveColumnByDropTarget(h, place);
      });
      chip.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        this.openContextMenu(event.clientX, event.clientY, [
          {
            label: 'Insert Column After',
            action: () => {
              const moved = insertColumnAfterInStacks(this.stacks, h);
              if (moved) this.commit(moved, 'Slide sorter insert column');
            }
          },
          {
            label: 'Delete Column',
            action: () => {
              const moved = deleteColumnInStacks(this.stacks, h);
              if (moved) this.commit(moved, 'Slide sorter delete column');
            }
          }
        ]);
      });
      strip.appendChild(chip);
    });
    return strip;
  }

  closeContextMenu() {
    if (this.contextMenuEl) {
      this.contextMenuEl.remove();
      this.contextMenuEl = null;
    }
  }

  openContextMenu(x, y, items) {
    this.closeContextMenu();
    if (!Array.isArray(items) || !items.length) return;
    const menu = document.createElement('div');
    menu.style.cssText = [
      'position:fixed',
      'left:0',
      'top:0',
      'z-index:22000',
      'min-width:190px',
      'max-width:260px',
      'padding:6px',
      'border-radius:10px',
      'border:1px solid rgba(255,255,255,0.14)',
      'background:rgba(19,27,40,0.98)',
      'box-shadow:0 12px 30px rgba(0,0,0,0.5)',
      'display:flex',
      'flex-direction:column',
      'gap:4px'
    ].join(';');
    items.forEach((item) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = String(item.label || '');
      btn.className = 'panel-button';
      btn.style.cssText = [
        'text-align:left',
        'font:12px/1.2 sans-serif',
        'padding:8px 10px',
        'background:rgba(255,255,255,0.03)',
        'border-color:rgba(255,255,255,0.12)'
      ].join(';');
      btn.disabled = !!item.disabled;
      btn.addEventListener('click', () => {
        this.closeContextMenu();
        if (!item.disabled && typeof item.action === 'function') {
          item.action();
        }
      });
      menu.appendChild(btn);
    });
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    const left = Math.min(Math.max(8, x), window.innerWidth - rect.width - 8);
    const top = Math.min(Math.max(8, y), window.innerHeight - rect.height - 8);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    this.contextMenuEl = menu;
  }

  createDropZone(h, v, place = 'before') {
    const zone = document.createElement('div');
    zone.dataset.h = String(h);
    zone.dataset.v = String(Math.max(v, 0));
    zone.dataset.place = place;
    zone.style.cssText = [
      'border:1px dashed rgba(120,170,255,0.45)',
      'background:rgba(120,170,255,0.1)',
      'color:#b9d2ff',
      'border-radius:8px',
      'font:11px/1.2 sans-serif',
      'padding:8px',
      'text-align:center'
    ].join(';');
    zone.addEventListener('dragover', (event) => {
      event.preventDefault();
      zone.style.background = 'rgba(120,170,255,0.22)';
    });
    zone.addEventListener('dragleave', () => {
      zone.style.background = 'rgba(120,170,255,0.1)';
    });
    zone.addEventListener('drop', (event) => {
      event.preventDefault();
      zone.style.background = 'rgba(120,170,255,0.1)';
      this.moveByDropTarget(zone);
    });
    return zone;
  }

  createTile(slide, h, v, selection, effectiveBg = '') {
    const preview = parseSlidePreview(slide);
    const isHidden = slideIsHidden(slide);
    const isMulti = this.multiSel.size > 1 && this.multiSel.has(slideKey(h, v));
    const tile = document.createElement('div');
    tile.draggable = true;
    tile.dataset.h = String(h);
    tile.dataset.v = String(v);
    tile.style.cssText = [
      'position:relative',
      'display:flex',
      'flex-direction:column',
      'border-radius:10px',
      isHidden ? 'border:1px solid rgba(255,255,255,0.09)' : 'border:1px solid rgba(255,255,255,0.18)',
      isHidden ? 'background:#232325' : 'background:#1a2334',
      'min-height:132px',
      'cursor:grab',
      'user-select:none',
      isHidden ? 'opacity:.55' : ''
    ].filter(Boolean).join(';');
    if (isMulti) {
      tile.dataset.multi = '1';
      tile.style.outline = '3px solid #2f7bff';
      tile.style.outlineOffset = '1px';
      tile.style.background = '#1f3a66';
    } else if (selection.h === h && selection.v === v) {
      tile.style.outline = '2px solid #6fb2ff';
    }
    // Column layouts stack tiles vertically with a 10px gap; the single-column grid wraps, so no bridging.
    applyAnimateGroupStyle(
      tile,
      getAnimateGroupInfo(this.stacks[h], v),
      this.stacks.length > 1 ? 10 : 0
    );

    if (effectiveBg) {
      const bgLayer = createBackgroundLayer(effectiveBg, this.host, this.modeCtx);
      if (bgLayer) tile.appendChild(bgLayer);
    }
    if (String(slide?.top || '').trim()) {
      const topBar = document.createElement('div');
      topBar.style.cssText = [
        'position:absolute',
        'left:0',
        'top:0',
        'width:100%',
        'height:5px',
        'z-index:2',
        'border-radius:10px 10px 0 0',
        'background:#ef4444'
      ].join(';');
      tile.appendChild(topBar);
    }
    if (preview.audioMode) tile.appendChild(createAudioBadge(preview.audioMode));

    const contentWrap = document.createElement('div');
    contentWrap.style.cssText = 'position:relative; z-index:1; flex:1; display:flex; flex-direction:column; gap:8px; padding:10px;';

    const titleText = preview.heading || (preview.imageOnly ? '🖼️' : (preview.isBlank ? '' : ''));
    if (titleText) {
      const title = document.createElement('div');
      title.textContent = titleText;
      title.style.cssText = 'font:700 16px/1.25 sans-serif; padding-top:4px;';
      contentWrap.appendChild(title);
    }

    const bodyWrap = document.createElement('div');
    bodyWrap.style.cssText = 'display:flex; gap:8px; align-items:flex-start; min-height:46px;';
    const textCol = document.createElement('div');
    textCol.style.cssText = 'min-width:0; flex:1 1 auto;';

    if (preview.twoCol) {
      const twoCol = document.createElement('div');
      twoCol.style.cssText = 'display:grid; grid-template-columns:1fr 1fr; gap:6px;';
      preview.twoCol.forEach((segment, index) => {
        const block = document.createElement('div');
        block.textContent = plainText(segment) || `(column ${index + 1})`;
        block.style.cssText = [
          'min-height:46px',
          'padding:4px 5px',
          'border-radius:6px',
          'font:11px/1.25 sans-serif',
          'background:rgba(255,255,255,0.08)',
          'overflow:hidden'
        ].join(';');
        twoCol.appendChild(block);
      });
      textCol.appendChild(twoCol);
    } else if (preview.bodyLines.length || preview.citeLines.length || preview.isBlank) {
      const body = document.createElement('div');
      body.style.cssText = 'font:11px/1.3 sans-serif; opacity:.9;';
      if (preview.bodyLines.length) {
        preview.bodyLines.forEach((line) => {
          const textLine = document.createElement('div');
          textLine.textContent = line;
          body.appendChild(textLine);
        });
      } else if (preview.citeLines.length) {
        preview.citeLines.forEach((line) => {
          const citeLine = document.createElement('div');
          citeLine.textContent = line;
          citeLine.style.cssText = 'font-style:italic; color:#a9b8d5;';
          body.appendChild(citeLine);
        });
      } else if (preview.isBlank) {
        const blank = document.createElement('div');
        blank.textContent = '(blank slide)';
        blank.style.cssText = 'font-style:italic; color:#7f8aa3;';
        body.appendChild(blank);
      }
      textCol.appendChild(body);
    }
    bodyWrap.appendChild(textCol);
    const sorterThumb = createSquareMediaThumb(preview, 64, this.host, this.modeCtx);
    if (sorterThumb) {
      bodyWrap.appendChild(sorterThumb);
    }
    contentWrap.appendChild(bodyWrap);

    const footer = document.createElement('div');
    footer.textContent = `H${h + 1} / V${v + 1}`;
    footer.style.cssText = 'margin-top:auto; font:10px/1.2 monospace; opacity:.6;';
    contentWrap.appendChild(footer);
    if (preview.notesHeading) {
      const noteLabel = document.createElement('div');
      noteLabel.textContent = preview.notesHeading;
      noteLabel.style.cssText = [
        'margin-top:6px',
        'padding:3px 6px',
        'border-radius:4px',
        'font:bold 10px/1.3 sans-serif',
        'background:rgba(111,178,255,0.12)',
        'color:#8ec5ff',
        'border:1px solid rgba(111,178,255,0.25)',
        'white-space:nowrap',
        'overflow:hidden',
        'text-overflow:ellipsis',
        'text-transform:uppercase'
      ].join(';');
      contentWrap.appendChild(noteLabel);
    }
    tile.appendChild(contentWrap);
    if (isHidden) tile.appendChild(createHiddenBadge());

    const baseOpacity = tile.style.opacity;
    const dimGroup = (on) => {
      if (!this.dragGroup || !this.board) return;
      this.board.querySelectorAll('[data-multi="1"]').forEach((el) => {
        el.style.opacity = on ? '0.45' : (el === tile ? baseOpacity : '');
      });
    };
    tile.addEventListener('dragstart', () => {
      this.dragSource = { h, v };
      this.dragGroup = isMulti ? [...this.multiSel] : null;
      tile.style.opacity = '0.45';
      dimGroup(true);
    });
    tile.addEventListener('dragend', () => {
      this.dragSource = null;
      dimGroup(false);
      this.dragGroup = null;
      tile.style.opacity = baseOpacity;
    });
    // Animated drop bar on the edge of this tile where the dragged slide(s) will land.
    // Columns stack vertically (bar above/below); the single-column grid wraps (bar left/right).
    const horizontalFlow = this.stacks.length <= 1;
    let dropBar = null;
    const hideDropBar = () => {
      if (dropBar) dropBar.style.display = 'none';
    };
    const showDropBar = (place) => {
      if (!dropBar) {
        dropBar = document.createElement('div');
        dropBar.style.cssText = [
          'position:absolute',
          'z-index:6',
          'pointer-events:none',
          'border-radius:3px',
          'background:#6fb2ff',
          'box-shadow:0 0 8px 2px rgba(111,178,255,0.8)'
        ].join(';');
        dropBar.animate([{ opacity: 1 }, { opacity: 0.35 }], { duration: 550, iterations: Infinity, direction: 'alternate' });
        tile.appendChild(dropBar);
      }
      const edge = place === 'after' ? 'after' : 'before';
      dropBar.style.cssText += horizontalFlow
        ? `;top:0;bottom:0;width:5px;${edge === 'after' ? 'right:-9px;left:auto' : 'left:-9px;right:auto'};height:auto`
        : `;left:0;right:0;height:5px;${edge === 'after' ? 'bottom:-8px;top:auto' : 'top:-8px;bottom:auto'};width:auto`;
      dropBar.style.display = 'block';
    };
    const isDraggedItself = () => (isMulti && this.dragGroup)
      || (!this.dragGroup && this.dragSource && this.dragSource.h === h && this.dragSource.v === v);
    tile.addEventListener('dragover', (event) => {
      event.preventDefault();
      if (isDraggedItself()) return;
      const rect = tile.getBoundingClientRect();
      const after = horizontalFlow
        ? event.clientX >= rect.left + rect.width / 2
        : event.clientY >= rect.top + rect.height / 2;
      tile.dataset.place = after ? 'after' : 'before';
      showDropBar(tile.dataset.place);
    });
    tile.addEventListener('dragleave', (event) => {
      if (event.relatedTarget instanceof Node && tile.contains(event.relatedTarget)) return;
      hideDropBar();
    });
    tile.addEventListener('drop', (event) => {
      event.preventDefault();
      hideDropBar();
      this.moveByDropTarget(tile);
    });
    tile.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      const keys = isMulti ? [...this.multiSel] : [slideKey(h, v)];
      const states = keys.map((key) => {
        const [kh, kv] = key.split(':').map(Number);
        return slideIsHidden(this.stacks[kh]?.[kv]);
      });
      const visibilityItems = [];
      if (states.some((hiddenState) => !hiddenState)) {
        visibilityItems.push({
          label: keys.length > 1 ? `Hide ${keys.length} Slides` : 'Hide Slide',
          action: () => this.setHidden(keys, true)
        });
      }
      if (states.some(Boolean)) {
        visibilityItems.push({
          label: keys.length > 1 ? `Unhide ${keys.length} Slides` : 'Unhide Slide',
          action: () => this.setHidden(keys, false)
        });
      }
      if (isMulti) {
        this.openContextMenu(event.clientX, event.clientY, [
          ...visibilityItems,
          {
            label: `Delete ${keys.length} Slides`,
            action: () => {
              const next = deleteSlidesInStacks(this.stacks, keys);
              if (!next) return;
              this.multiSel.clear();
              this.commit(next, 'Slide sorter delete slides');
            }
          },
          {
            label: 'Clear Selection',
            action: () => {
              this.multiSel.clear();
              this.refresh();
            }
          }
        ]);
        return;
      }
      this.openContextMenu(event.clientX, event.clientY, [
        {
          label: 'Insert Slide After',
          action: () => {
            const moved = insertSlideAfterInStacks(this.stacks, h, v, createNewSlide());
            if (moved) this.commit(moved, 'Slide sorter insert slide');
          }
        },
        {
          label: 'Duplicate Slide',
          action: () => {
            const moved = duplicateSlideInStacks(this.stacks, h, v);
            if (moved) this.commit(moved, 'Slide sorter duplicate slide');
          }
        },
        ...visibilityItems,
        {
          label: 'Delete Slide',
          action: () => {
            const moved = deleteSlideInStacks(this.stacks, h, v);
            if (moved) this.commit(moved, 'Slide sorter delete slide');
          }
        }
      ]);
    });

    tile.addEventListener('click', (event) => {
      const current = this.host.getSelection();
      const anchor = this.anchor && this.stacks[this.anchor.h]?.[this.anchor.v] ? this.anchor : current;
      if (event.shiftKey && anchor.h === h) {
        // Range within one column, from the anchor to the clicked slide.
        const lo = Math.min(anchor.v, v);
        const hi = Math.max(anchor.v, v);
        this.multiSel = new Set();
        for (let i = lo; i <= hi; i += 1) this.multiSel.add(slideKey(h, i));
        this.anchor = anchor;
        this.refresh();
        return;
      }
      if (event.ctrlKey || event.metaKey) {
        if (!this.multiSel.size) this.multiSel.add(slideKey(current.h, current.v));
        const key = slideKey(h, v);
        if (this.multiSel.has(key)) this.multiSel.delete(key);
        else this.multiSel.add(key);
        this.anchor = { h, v };
        this.host.transact('Slide sorter navigate', (tx) => {
          tx.setSelection({ h, v });
        });
        this.refresh();
        return;
      }
      this.multiSel.clear();
      this.anchor = { h, v };
      this.host.transact('Slide sorter navigate', (tx) => {
        tx.setSelection({ h, v });
      });
      this.refresh();
    });

    tile.addEventListener('dblclick', () => {
      this.host.transact('Slide sorter select slide', (tx) => {
        tx.setSelection({ h, v });
      });
      deactivateSlideSorterMode(this.host);
    });

    return tile;
  }
}

export function getBuilderExtensions(ctx = {}) {
  const host = ctx.host;
  if (!host) return [];
  if (slideSorterInitialized) {
    return [
      {
        kind: 'slide-navigator-renderer',
        id: 'slidesorter-slide-nav-renderer',
        renderTile: createNavigatorTileRenderer(ctx)
      }
    ];
  }
  slideSorterInitialized = true;

  const modeCtx = {
    host,
    slug: ctx.slug,
    dir: ctx.dir,
    mdFile: ctx.mdFile
  };
  const view = new SlideSorterView(host, modeCtx);
  let active = false;

  host.on('document:changed', () => {
    if (!active) return;
    view.refresh();
  });

  if (typeof host.registerKeyboardShortcut === 'function') {
    host.registerKeyboardShortcut({
      key: 'Escape',
      onTrigger() {
        if (!active) {
          activateSlideSorterMode(host);
        }
      }
    });
  }

  host.registerMode({
    id: SLIDE_SORTER_MODE_ID,
    location: 'view-tabs',
    label: 'Slide Sorter',
    icon: '🧱',
    tooltip: 'Slide Sorter (Esc)',
    mount(mountCtx) {
      return {
        onActivate() {
          active = true;
          view.mount(mountCtx.root);
        },
        onDeactivate() {
          active = false;
          view.dispose();
        }
      };
    }
  });

  return [
    {
      kind: 'slide-navigator-renderer',
      id: 'slidesorter-slide-nav-renderer',
      renderTile: createNavigatorTileRenderer(ctx)
    }
  ];
}
