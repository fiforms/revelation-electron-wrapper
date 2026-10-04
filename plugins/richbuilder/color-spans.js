/**
 * color-spans.js — Inline text colors for `[text]{.red}` spans
 *
 * Shared by the rich slide editor (plugins/richbuilder) and the notes editor
 * (http_admin/builder). The two copies of this file are identical; keep them in
 * sync. The names and aliases mirror the markdown compiler in revelation/.
 *
 * In the editing DOM a color is `<span class="text-red">`. Applying a color
 * wraps each selected text node individually, so it works across bold/italic
 * runs and multiple paragraphs, then merges neighbouring spans of one color.
 */

export const TEXT_COLORS = ['red', 'green', 'blue', 'purple', 'highlight', 'muted'];

const COLOR_ALIASES = {
  yellow: 'highlight', orange: 'highlight', gold: 'highlight',
  grey: 'muted', gray: 'muted', silver: 'muted'
};

// Dark-surface palette, matching rv-text-colors-dark in revelation's text-colors.scss.
export const EDITOR_COLOR_VALUES = {
  red: '#ff6b6b',
  green: '#6fcf8a',
  blue: '#6cb4ff',
  purple: '#c792ea',
  highlight: '#ffd54f',
  muted: '#9aa0a6'
};

/** Canonical color name for a markdown name or alias, or null if unknown. */
export function normalizeColorName(name) {
  const lower = String(name || '').toLowerCase();
  if (TEXT_COLORS.includes(lower)) return lower;
  return COLOR_ALIASES[lower] || null;
}

/** Canonical color name carried by a `<span class="text-…">`, or null. */
export function colorOfElement(el) {
  if (!el || el.tagName !== 'SPAN') return null;
  for (const cls of el.classList) {
    if (cls.startsWith('text-') && TEXT_COLORS.includes(cls.slice(5))) return cls.slice(5);
  }
  return null;
}

/**
 * Serialize a colored run as `[inner]{.name}`, one span per line because the
 * markdown compiler converts spans line by line. Whitespace stays outside the
 * brackets. Text containing brackets can't use the span syntax, so it is
 * returned uncolored rather than producing markup that would not convert.
 */
export function colorSpanMarkdown(name, inner) {
  return String(inner).split('\n').map((line) => {
    const match = line.match(/^(\s*)([\s\S]*?)(\s*)$/);
    if (!match[2] || /[[\]]/.test(match[2])) return line;
    return `${match[1]}[${match[2]}]{.${name}}${match[3]}`;
  }).join('\n');
}

// Text that must never be recolored: links, tokens and other non-text widgets.
const SKIP_SELECTOR = 'a, [contenteditable="false"], [data-md-image], input';

function findColorSpan(startEl, root) {
  let el = startEl;
  while (el && el !== root) {
    if (colorOfElement(el)) return el;
    el = el.parentElement;
  }
  return null;
}

// Split `span` so that it wraps only `node`; text before/after goes into clones.
function isolateNode(node, span) {
  const before = document.createRange();
  before.setStart(span, 0);
  before.setEndBefore(node);
  const beforeFrag = before.extractContents();
  const after = document.createRange();
  after.setStartAfter(node);
  after.setEnd(span, span.childNodes.length);
  const afterFrag = after.extractContents();
  if (beforeFrag.textContent) {
    const clone = span.cloneNode(false);
    clone.appendChild(beforeFrag);
    span.before(clone);
  }
  if (afterFrag.textContent) {
    const clone = span.cloneNode(false);
    clone.appendChild(afterFrag);
    span.after(clone);
  }
}

function setNodeColor(node, root, name) {
  const existing = findColorSpan(node.parentElement, root);
  if (existing) {
    isolateNode(node, existing);
    if (name) existing.className = `text-${name}`;
    else existing.replaceWith(...existing.childNodes);
    return;
  }
  if (!name) return;
  const wrapper = document.createElement('span');
  wrapper.className = `text-${name}`;
  node.replaceWith(wrapper);
  wrapper.appendChild(node);
}

function mergeAdjacentSpans(root) {
  root.querySelectorAll('span').forEach((span) => {
    const name = colorOfElement(span);
    if (!name || !span.isConnected) return;
    let next = span.nextSibling;
    while (next && next.nodeType === 1 && colorOfElement(next) === name) {
      span.append(...next.childNodes);
      next.remove();
      next = span.nextSibling;
    }
  });
}

/**
 * Apply a color (or clear it with `name === null`) to the current selection
 * inside `root`. Returns true if the DOM changed. A collapsed selection is a no-op.
 */
export function applyTextColor(root, name) {
  const selection = window.getSelection();
  if (!root || !selection || !selection.rangeCount) return false;
  const range = selection.getRangeAt(0);
  if (range.collapsed || !root.contains(range.commonAncestorContainer)) return false;

  const { startContainer, startOffset, endContainer, endOffset } = range;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets = [];
  while (walker.nextNode()) {
    let node = walker.currentNode;
    if (!range.intersectsNode(node)) continue;
    const from = node === startContainer ? startOffset : 0;
    const to = node === endContainer ? endOffset : node.length;
    if (from >= to || !node.nodeValue.slice(from, to).trim()) continue;
    if (node.parentElement?.closest(SKIP_SELECTOR)) continue;
    if (to < node.length) node.splitText(to);
    if (from > 0) node = node.splitText(from);
    targets.push(node);
  }
  if (!targets.length) return false;

  targets.forEach((node) => setNodeColor(node, root, name));
  mergeAdjacentSpans(root);

  const first = targets[0];
  const last = targets[targets.length - 1];
  const next = document.createRange();
  next.setStart(first, 0);
  next.setEnd(last, last.length);
  selection.removeAllRanges();
  selection.addRange(next);
  return true;
}

/** Color of the span at the selection anchor inside `root`, or null. */
export function currentTextColor(root) {
  const selection = window.getSelection();
  let node = selection?.anchorNode;
  if (!node || !root.contains(node)) return null;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  const span = node instanceof Element ? findColorSpan(node, root) : null;
  return span ? colorOfElement(span) : null;
}
