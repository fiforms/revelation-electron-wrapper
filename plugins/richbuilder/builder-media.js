/**
 * builder-media.js — Media Resolution and Inline Image/Video Handling
 *
 * Manages the runtime media context (slug, dir, media-tag aliases loaded from
 * slide YAML frontmatter) and converts markdown image tokens — including
 * relative paths and `media:tag` aliases — into display `<img>` or `<video>`
 * HTML elements and back again.
 */

import { encodePathSafely, isVideoSource, escapeHtml, escapeAttribute, rbDebug, previewText, countImageMarkdownTokens, normalizeFrontmatterYaml } from './builder-utils.js';

// Module-level runtime context — mutated by updateImageRuntimeContext, read by
// resolveImageDisplaySrc.  Not exported; callers interact through the public API.
const richImageRuntime = {
  slug: '',
  dir: '',
  mediaByTag: {},
  macros: {}
};

/**
 * updateImageRuntimeContext — Reload the media alias table from YAML frontmatter.
 *
 * Reads the presentation-level `media:` map out of the host document's
 * frontmatter so that `media:tag` aliases in slide markdown can be resolved to
 * real file paths.  Also stores the current slug and dir for relative-path
 * resolution.  Safe to call on every slide selection change.
 */
export function updateImageRuntimeContext(host, modeCtx = {}) {
  richImageRuntime.slug = String(modeCtx?.slug || richImageRuntime.slug || '').trim();
  richImageRuntime.dir = String(modeCtx?.dir || richImageRuntime.dir || '').trim();
  richImageRuntime.mediaByTag = {};
  richImageRuntime.macros = {};
  rbDebug('updateImageRuntimeContext:start', {
    slug: richImageRuntime.slug,
    dir: richImageRuntime.dir
  });

  const yaml = window.jsyaml;
  if (!host || typeof host.getDocument !== 'function') return;
  try {
    // Use host.getMetadata() if available (includes merged imports), fallback to manual parse
    let parsed = {};
    if (typeof host.getMetadata === 'function') {
      parsed = host.getMetadata() || {};
    } else {
      if (!yaml) return;
      const doc = host.getDocument();
      const yamlText = normalizeFrontmatterYaml(doc?.frontmatter || '');
      if (!yamlText) return;
      parsed = (yaml.loadAll(yamlText)[0] ?? {});
    }
    const media = parsed?.media && typeof parsed.media === 'object' ? parsed.media : {};
    Object.entries(media).forEach(([tag, entry]) => {
      const key = String(tag || '').trim();
      if (!key) return;
      richImageRuntime.mediaByTag[key] = entry || {};
    });
    const macros = parsed?.macros;
    richImageRuntime.macros = macros && typeof macros === 'object' && !Array.isArray(macros) ? macros : {};
    rbDebug('updateImageRuntimeContext:media-loaded', {
      mediaTagCount: Object.keys(richImageRuntime.mediaByTag).length
    });
  } catch {
    richImageRuntime.mediaByTag = {};
    richImageRuntime.macros = {};
    rbDebug('updateImageRuntimeContext:parse-failed');
  }
}

/**
 * resolveImageDisplaySrc — Convert a markdown image src to a display URL.
 *
 * Handles four cases in priority order:
 *  1. Absolute/protocol URLs — returned unchanged.
 *  2. `media:tag` aliases — looked up in `richImageRuntime.mediaByTag`.
 *  3. Relative paths — prefixed with `/<dir>/<slug>/`.
 *  4. Fallback — returned as-is when no dir/slug context is available.
 */
export function resolveImageDisplaySrc(rawSrc) {
  let src = String(rawSrc || '').trim();
  if (src.startsWith('<') && src.endsWith('>')) src = src.slice(1, -1);
  if (!src) return '';
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

  if (src.startsWith('media:')) {
    const tag = src.slice('media:'.length).trim();
    const mediaEntry = richImageRuntime.mediaByTag[tag];
    const filename = String(mediaEntry?.filename || '').trim();
    if (!filename) {
      rbDebug('resolveImageDisplaySrc:media-alias-miss', { src, tag });
      return '';
    }
    const base = `/${richImageRuntime.dir}/_media/${filename}`;
    rbDebug('resolveImageDisplaySrc:media-alias-hit', { src, resolved: base });
    return encodePathSafely(base);
  }

  if (!richImageRuntime.dir || !richImageRuntime.slug) return src;
  const base = `/${richImageRuntime.dir}/${richImageRuntime.slug}/${src}`;
  rbDebug('resolveImageDisplaySrc:relative', { src, resolved: base });
  return encodePathSafely(base);
}

/**
 * buildImageHtmlTag — Build an `<img>` or `<video>` HTML string for a token.
 *
 * Resolves the display src, then selects the appropriate element type based on
 * the file extension.  Both elements carry `data-md-alt` and `data-md-src`
 * attributes so `serializeInline` can reconstruct the original markdown token.
 */
export function buildImageHtmlTag(alt, src) {
  const resolvedSrc = resolveImageDisplaySrc(src);
  const finalSrc = resolvedSrc || src;
  if (isVideoSource(finalSrc)) {
    return `<video class="richbuilder-inline-video" src="${escapeAttribute(finalSrc)}" data-md-alt="${escapeAttribute(alt)}" data-md-src="${escapeAttribute(src)}" controls preload="metadata" playsinline muted></video>`;
  }
  return `<img class="richbuilder-inline-image" src="${escapeAttribute(finalSrc)}" alt="${escapeAttribute(alt)}" data-md-alt="${escapeAttribute(alt)}" data-md-src="${escapeAttribute(src)}">`;
}

/**
 * parseSingleImageLine — Parse a line that contains exactly one image token.
 *
 * Returns `{ alt, src }` when the trimmed line matches `![alt](src)` exactly,
 * or `null` otherwise.  Used by `markdownToHtml` to detect image-only lines
 * that should be rendered as block-level elements rather than inline spans.
 */
export function parseSingleImageLine(line) {
  const trimmed = String(line || '').trim();
  const match = trimmed.match(/^!\[([^\]]*)\]\((.+)\)$/);
  if (!match) {
    if (trimmed.includes('![') || trimmed.includes('](')) {
      rbDebug('parseSingleImageLine:no-match', { line: previewText(trimmed) });
    }
    return null;
  }
  const alt = String(match[1] || '');
  const src = String(match[2] || '').trim();
  if (!src) {
    rbDebug('parseSingleImageLine:empty-src', { line: previewText(trimmed) });
    return null;
  }
  rbDebug('parseSingleImageLine:match', { alt, src });
  return { alt, src };
}

/**
 * buildImageMarkdownToken — Reconstruct a markdown image token string.
 *
 * Combines alt text and src into the standard `![alt](src)` format.  Used by
 * both the markdown→HTML and HTML→markdown directions of the pipeline.
 */
export function buildImageMarkdownToken(alt, src) {
  return `![${String(alt || '')}](${String(src || '')})`;
}

// --- Image placement (magic alt text) ---
// The compiler reads `![fill](…)`, `![fit](…)`, `![fit:65](…)` and
// `![background](…)` as placement keywords when the image is alone on its line
// (media-line-parsers.js tryHandleMagicImageLine). Other keywords it knows
// get no placement picker, so their alt text is never rewritten.
// `fill:background` (background contained in the slide) is its own picker mode.
const IMAGE_PLACEMENT_MODES = ['fill', 'fit', 'background'];
const OTHER_MAGIC_KEYWORDS = new Set(['youtube', 'web', 'caption']);

/**
 * parseImagePlacement — Read the placement keyword out of an image's alt text.
 *
 * Returns `{ mode, modifier }` with mode '' for plain alt text (Default), or
 * null when the alt is another magic keyword the picker should not touch.
 */
export function parseImagePlacement(alt) {
  const text = String(alt || '').trim();
  const colon = text.indexOf(':');
  const keyword = (colon === -1 ? text : text.slice(0, colon)).trim().toLowerCase();
  const modifier = colon === -1 ? '' : text.slice(colon + 1).trim();
  if (keyword === 'fill' && /^background(?::|$)/i.test(modifier)) return { mode: 'fill-background', modifier };
  if (IMAGE_PLACEMENT_MODES.includes(keyword)) return { mode: keyword, modifier };
  if (OTHER_MAGIC_KEYWORDS.has(keyword)) return null;
  return { mode: '', modifier: '' };
}

/**
 * buildImagePlacementAlt — Alt text for a placement mode.
 *
 * `fitPercent` only applies to fit. A background alt that already carries a
 * modifier (e.g. `background:sticky`, `fill:background:sticky`) is kept as-is.
 */
export function buildImagePlacementAlt(mode, fitPercent, previousAlt = '') {
  if (mode === 'fill') return 'fill';
  if (mode === 'fit') {
    const pct = Math.round(Number(fitPercent));
    return Number.isFinite(pct) && pct > 0 ? `fit:${Math.min(pct, 100)}` : 'fit';
  }
  if (mode === 'background') {
    return parseImagePlacement(previousAlt)?.mode === 'background' ? String(previousAlt).trim() : 'background';
  }
  if (mode === 'fill-background') {
    return parseImagePlacement(previousAlt)?.mode === 'fill-background' ? String(previousAlt).trim() : 'fill:background';
  }
  return '';
}

function buildImagePlacementControls(alt) {
  const placement = parseImagePlacement(alt);
  if (!placement) return '';
  const options = [['', 'Default'], ['fill', 'Fill'], ['fit', 'Fit'], ['background', 'Background'], ['fill-background', 'Fill background']]
    .map(([value, label]) => `<option value="${value}"${placement.mode === value ? ' selected' : ''}>${label}</option>`)
    .join('');
  const pct = placement.mode === 'fit' ? Number.parseFloat(placement.modifier) : NaN;
  const pctValue = Number.isFinite(pct) && pct > 0 ? String(Math.round(pct)) : '';
  return `<span class="richbuilder-image-placement">`
    + `<select class="richbuilder-image-mode" title="Image placement">${options}</select>`
    + `<input class="richbuilder-image-fit-pct" type="number" min="1" max="100" step="1" placeholder="%"`
    + ` title="Fit height (% of slide, optional)" value="${pctValue}"${placement.mode === 'fit' ? '' : ' hidden'}>`
    + `</span>`;
}

/**
 * buildImageLineTokenHtml — Token span for an image alone on its line.
 *
 * Adds the placement picker in the image's corner. The serializer reads only
 * `data-md-image`, so the picker's own markup never reaches the markdown.
 */
export function buildImageLineTokenHtml(alt, src) {
  const token = buildImageMarkdownToken(alt, src);
  return `<span class="richbuilder-image-token" contenteditable="false" data-md-image="${escapeAttribute(token)}">`
    + `${buildImageHtmlTag(alt, src)}${buildImagePlacementControls(alt)}</span>`;
}

/**
 * applyImagePlacement — Rewrite a token's alt text from its placement picker.
 *
 * Returns true when the token changed.
 */
export function applyImagePlacement(tokenEl) {
  const select = tokenEl?.querySelector('.richbuilder-image-mode');
  const pctInput = tokenEl?.querySelector('.richbuilder-image-fit-pct');
  const parsed = parseSingleImageLine(tokenEl?.getAttribute('data-md-image') || '');
  if (!select || !parsed) return false;
  const mode = select.value;
  if (pctInput) pctInput.hidden = mode !== 'fit';
  const nextAlt = buildImagePlacementAlt(mode, pctInput?.value, parsed.alt);
  const nextToken = buildImageMarkdownToken(nextAlt, parsed.src);
  if (nextToken === tokenEl.getAttribute('data-md-image')) return false;
  tokenEl.setAttribute('data-md-image', nextToken);
  const media = tokenEl.querySelector('img, video');
  if (media) {
    media.setAttribute('data-md-alt', nextAlt);
    if (media.tagName === 'IMG') media.setAttribute('alt', nextAlt);
  }
  return true;
}

/**
 * imageMarkdownToHtml — Replace `![…](…)` tokens in a text string with HTML.
 *
 * Scans the input for markdown image tokens and wraps each in a
 * `.richbuilder-image-token` span carrying a `data-md-image` attribute so the
 * serializer can recover the original token.  Non-image text between tokens is
 * HTML-escaped.
 */
export function imageMarkdownToHtml(raw) {
  const text = String(raw || '');
  const imagePattern = /!\[([^\]]*)\]\((<[^>]*>|[^)]+)\)/g;
  rbDebug('imageMarkdownToHtml:start', {
    imageTokenCount: countImageMarkdownTokens(text),
    text: previewText(text)
  });
  let result = '';
  let cursor = 0;
  let match = null;
  let matchCount = 0;

  while ((match = imagePattern.exec(text)) !== null) {
    const full = match[0];
    const alt = match[1] || '';
    const src = match[2] || '';
    matchCount += 1;
    rbDebug('imageMarkdownToHtml:match', {
      match: full,
      alt,
      src,
      index: match.index
    });
    result += escapeHtml(text.slice(cursor, match.index));
    result += `<span class="richbuilder-image-token" contenteditable="false" data-md-image="${escapeAttribute(buildImageMarkdownToken(alt, src))}">${buildImageHtmlTag(alt, src)}</span>`;
    cursor = match.index + full.length;
  }

  result += escapeHtml(text.slice(cursor));
  rbDebug('imageMarkdownToHtml:end', { matchCount, output: previewText(result) });
  return result;
}

/**
 * toThumbnailUrl — Convert a resolved display URL to its cached thumbnail URL.
 *
 * Media library files (`/_media/`) already have a `.thumbnail.jpg` generated
 * by the import pipeline — just append the suffix.  Presentation-local files
 * are served by the on-demand thumbs middleware at `/thumbs_<key>/`.
 * External and data/blob URLs have no thumbnail and return an empty string.
 */
export function toThumbnailUrl(displayUrl) {
  if (!displayUrl) return '';
  if (displayUrl.startsWith('data:') || displayUrl.startsWith('blob:')) return '';
  if (/^https?:\/\//.test(displayUrl) && !displayUrl.includes('localhost')) return '';
  if (displayUrl.includes('/_media/')) return displayUrl + '.thumbnail.jpg';
  return displayUrl.replace(/\/presentations_([^/]+)\//, '/thumbs_$1/');
}

// --- Sticky background tracking ---
const cleanBackgroundSrc = (raw) => {
  const s = String(raw || '').trim();
  return s.startsWith('<') && s.endsWith('>') ? s.slice(1, -1) : s;
};

// Mirrors the markdown compiler's sticky state (revelation/js/compiler/
// slide-compiler.js finalizeSlide + markdown-line-parsers.js). An identical
// copy lives in the slidesorter (builder.js) plugin; keep the two in sync.
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
    if (!bgMatch || !/^(?:fill:)?background(?::|$)/i.test(bgMatch[1].trim())) return;
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

/**
 * getEffectiveSlideBg — Resolve the thumbnail URL for the current slide's background.
 *
 * Tracks sticky backgrounds across the whole deck as the markdown compiler
 * does (see computeEffectiveBackgrounds). Returns a thumbnail URL
 * (via toThumbnailUrl) ready to use as a CSS background-image source.
 * Returns an empty string when there is no effective background.
 *
 * Must be called after updateImageRuntimeContext so that media: aliases resolve.
 */
export function getEffectiveSlideBg(host) {
  const doc = host?.getDocument?.();
  const sel = host?.getSelection?.();
  if (!doc || !sel) return '';
  const { h, v } = sel;
  const effectiveBg = computeEffectiveBackgrounds(doc.stacks, richImageRuntime.macros)[h]?.[v] || '';
  if (!effectiveBg) return '';
  return toThumbnailUrl(resolveImageDisplaySrc(effectiveBg));
}
