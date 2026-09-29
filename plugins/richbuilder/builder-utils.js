/**
 * builder-utils.js — General-Purpose Utilities
 *
 * Pure helper functions shared across all richbuilder modules.
 * No dependencies on other builder modules or DOM state.
 * Covers: debug logging, text manipulation, HTML escaping,
 * URL path encoding, and cursor insertion.
 */

/** Debug flag — set window.__RICHBUILDER_DEBUG = false to silence verbose logging. */
export const RICHBUILDER_DEBUG = window.__RICHBUILDER_DEBUG ?? true;

/**
 * rbDebug — Conditional debug logger.
 *
 * Logs to console only when RICHBUILDER_DEBUG is truthy.  All richbuilder
 * modules call this instead of console.log directly so verbose output can be
 * suppressed in production by setting window.__RICHBUILDER_DEBUG = false.
 */
export function rbDebug(...args) {
  if (!RICHBUILDER_DEBUG) return;
  console.log('[richbuilder][debug]', ...args);
}

/**
 * describeDomTree — Render a DOM subtree as an indented outline for debugging.
 *
 * Elements show their tag, id, classes and other attributes; text nodes show
 * their exact content (JSON-quoted so whitespace, \n and nbsp are visible).
 */
export function describeDomTree(node, depth = 0) {
  const indent = '  '.repeat(depth);
  if (node.nodeType === Node.TEXT_NODE) {
    return `${indent}#text ${JSON.stringify(node.nodeValue)}`;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return `${indent}#${node.nodeName.toLowerCase()}`;
  }
  const attrs = Array.from(node.attributes)
    .map((attr) => (attr.value === '' ? attr.name : `${attr.name}=${JSON.stringify(attr.value)}`))
    .join(' ');
  const line = `${indent}<${node.tagName.toLowerCase()}${attrs ? ` ${attrs}` : ''}>`;
  const children = Array.from(node.childNodes).map((child) => describeDomTree(child, depth + 1));
  return [line, ...children].join('\n');
}

/**
 * logDomToMarkdown — Dump an editor's DOM tree and the markdown produced from it.
 *
 * Logged as a collapsed console group so each sync is one expandable entry.
 */
export function logDomToMarkdown(label, rootEl, markdown) {
  if (!RICHBUILDER_DEBUG) return;
  console.groupCollapsed(`[richbuilder][dom→md] ${label}`);
  console.log(`DOM:\n${Array.from(rootEl.childNodes).map((child) => describeDomTree(child)).join('\n')}`);
  console.log(`Markdown:\n${markdown}`);
  console.log('Markdown (escaped):', JSON.stringify(markdown));
  console.groupEnd();
}

/**
 * previewText — Truncate a string for debug log output.
 *
 * Replaces newlines with the literal `\n` sequence and truncates to `max`
 * characters, appending an ellipsis when truncation occurs.  Keeps debug
 * log lines short without losing the beginning of long values.
 */
export function previewText(text, max = 220) {
  const value = String(text || '').replace(/\n/g, '\\n');
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

/**
 * countImageMarkdownTokens — Count `![…](…)` tokens in a string.
 *
 * Used in debug logging to quickly verify that image tokens survive
 * round-trips through the markdown ↔ HTML conversion pipeline.
 */
export function countImageMarkdownTokens(text) {
  const matches = String(text || '').match(/!\[[^\]]*\]\((?:<[^>]*>|[^)]+)\)/g);
  return matches ? matches.length : 0;
}

/**
 * splitHardBreakSuffix — Detect a trailing two-space hard-break sequence.
 *
 * Returns `{ text, hasHardBreak }` where `text` is the line content without
 * the trailing spaces and `hasHardBreak` is true when the original line ended
 * with two or more spaces (the CommonMark hard-break syntax).
 */
export function splitHardBreakSuffix(line) {
  const raw = String(line || '');
  const match = raw.match(/^(.*?)( {2,})$/);
  if (!match) return { text: raw, hasHardBreak: false };
  return { text: match[1], hasHardBreak: true };
}

/**
 * trimEmptyEdgeLines — Strip leading and trailing blank lines from a string.
 *
 * Normalises line endings to `\n` then removes empty lines at the start and
 * end of the string.  Used before pushing content into markdown output to
 * avoid spurious blank lines.
 */
export function trimEmptyEdgeLines(raw) {
  const lines = String(raw || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.join('\n');
}

/**
 * insertHardBreakAtCursor — Insert a `<br>` at the current selection.
 *
 * Used by the Shift+Enter keyboard handler to create a hard line-break inside
 * a paragraph without starting a new block element.
 */
function isBlockElement(el) {
  return !window.getComputedStyle(el).display.startsWith('inline');
}

// True when nothing visible follows `node` before the end of its block,
// climbing out of inline wrappers such as <strong> or <em>.
function isLastInBlock(node) {
  let current = node;
  while (current && current.parentElement) {
    for (let next = current.nextSibling; next; next = next.nextSibling) {
      if (next.nodeType === Node.TEXT_NODE && !next.nodeValue) continue;
      return false;
    }
    current = current.parentElement;
    if (isBlockElement(current)) return true;
  }
  return true;
}

export function insertHardBreakAtCursor() {
  const selection = window.getSelection?.();
  if (!selection || selection.rangeCount < 1) {
    document.execCommand('insertHTML', false, '<br>');
    return;
  }
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const br = document.createElement('br');
  range.insertNode(br);
  // A <br> that ends its block doesn't render an empty line, so the caret
  // would stay put. Add a placeholder <br> to give the new line height.
  if (isLastInBlock(br)) {
    br.after(document.createElement('br'));
  }
  range.setStartAfter(br);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * encodePathSafely — Percent-encode a URL path without double-encoding.
 *
 * Splits on `/`, decodes each segment, then re-encodes it.  This is safe to
 * call on paths that may already be partially encoded.
 */
export function encodePathSafely(pathValue) {
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

/**
 * stripQueryHash — Remove query string and fragment from a URL string.
 *
 * Used before extension-based video detection so that URLs like
 * `video.mp4?t=3#autoplay` are still recognised as video sources.
 */
export function stripQueryHash(value) {
  return String(value || '').split('#')[0].split('?')[0];
}

/**
 * isVideoSource — Return true if the URL points to a video file.
 *
 * Tests the cleaned path (query/hash stripped) against common video
 * extensions.  Used to decide whether to render `<video>` or `<img>`.
 */
export function isVideoSource(value) {
  const candidate = stripQueryHash(value).toLowerCase();
  return /\.(mp4|webm|mov|m4v|ogv)$/.test(candidate);
}

/**
 * escapeHtml — Escape `&`, `<`, `>` for safe HTML text insertion.
 *
 * Minimal HTML escaping used when embedding user-supplied strings as text
 * content inside generated HTML markup.
 */
export function escapeHtml(text) {
  return String(text || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/**
 * escapeAttribute — Escape a string for safe use inside an HTML attribute.
 *
 * Builds on `escapeHtml` and additionally escapes double-quote characters so
 * the result can be placed inside `"…"` attribute values.
 */
export function escapeAttribute(text) {
  return escapeHtml(text).replaceAll('"', '&quot;');
}

/**
 * normalizeFrontmatterYaml — Strip YAML fence delimiters from frontmatter.
 *
 * Accepts frontmatter with or without the surrounding `---` fence and returns
 * the raw YAML body text ready for `jsyaml.load()`.
 */
export function normalizeFrontmatterYaml(frontmatter) {
  const text = String(frontmatter || '').trim();
  if (!text) return '';
  const wrapped = text.match(/^---\r?\n([\s\S]*?)\r?\n---\s*$/);
  if (wrapped) return wrapped[1];
  return text.replace(/^---\r?\n/, '').replace(/\r?\n---\s*$/, '');
}
