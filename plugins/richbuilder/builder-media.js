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
  mediaByTag: {}
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
  rbDebug('updateImageRuntimeContext:start', {
    slug: richImageRuntime.slug,
    dir: richImageRuntime.dir
  });

  const yaml = window.jsyaml;
  if (!yaml || !host || typeof host.getDocument !== 'function') return;
  try {
    const doc = host.getDocument();
    const yamlText = normalizeFrontmatterYaml(doc?.frontmatter || '');
    if (!yamlText) return;
    const parsed = yaml.load(yamlText) || {};
    const media = parsed?.media && typeof parsed.media === 'object' ? parsed.media : {};
    Object.entries(media).forEach(([tag, entry]) => {
      const key = String(tag || '').trim();
      if (!key) return;
      richImageRuntime.mediaByTag[key] = entry || {};
    });
    rbDebug('updateImageRuntimeContext:media-loaded', {
      mediaTagCount: Object.keys(richImageRuntime.mediaByTag).length
    });
  } catch {
    richImageRuntime.mediaByTag = {};
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

const _bgLineRe = /^!\[([^\]]*)\]\((<[^>]*>|[^)]+)\)/;
const _isBgAlt = (alt) => /^background(?::|$)/i.test(String(alt || '').trim());

function _parseSlideBg(slide) {
  let backgroundSrc = '';
  let backgroundIsSticky = false;
  let clearBg = false;

  for (const part of [String(slide?.top || ''), String(slide?.body || '')]) {
    if (backgroundSrc) break; // body only checked when top found nothing
    for (const line of part.split(/\r?\n/)) {
      const t = line.trim();
      if (/^:clearbg:/i.test(t)) { clearBg = true; continue; }
      if (!t.startsWith('![')) continue;
      const m = t.match(_bgLineRe);
      if (!m || !_isBgAlt(m[1])) continue;
      let s = String(m[2] || '').trim();
      if (s.startsWith('<') && s.endsWith('>')) s = s.slice(1, -1);
      backgroundSrc = s;
      backgroundIsSticky = /\bsticky\b/i.test(m[1]);
    }
  }

  return { backgroundSrc, backgroundIsSticky, clearBg };
}

/**
 * getEffectiveSlideBg — Resolve the thumbnail URL for the current slide's background.
 *
 * Walks the current column from slide 0 to the selected slide, tracking sticky
 * backgrounds exactly as the slide renderer does, and returns a thumbnail URL
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
  const column = Array.isArray(doc?.stacks?.[h]) ? doc.stacks[h] : [];

  let stickyBg = '';

  for (let i = 0; i <= v && i < column.length; i++) {
    const p = _parseSlideBg(column[i]);
    const effectiveBg = p.backgroundSrc || (p.clearBg ? '' : stickyBg);
    if (p.backgroundIsSticky) stickyBg = p.backgroundSrc;
    else if (p.clearBg) stickyBg = '';
    if (i === v) {
      if (!effectiveBg) return '';
      return toThumbnailUrl(resolveImageDisplaySrc(effectiveBg));
    }
  }

  return '';
}
