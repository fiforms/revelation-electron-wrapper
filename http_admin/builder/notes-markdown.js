/*
 * Markdown <-> DOM conversion for the rich notes editor.
 *
 * Sections:
 * - Link safety
 * - Markdown -> DOM
 * - DOM -> Markdown
 *
 * Supports a deliberately small subset: paragraphs, hard line breaks, bullet and
 * numbered lists (nested by indentation), **bold**, *italic*, [links](url) and
 * [colored text]{.red} spans.
 * Anything else stays literal text, so unsupported markdown round-trips as-is.
 * Single newlines are soft breaks, as in markdown: they stay as "\n" inside
 * text nodes, which renders as a space and keeps the source's line wrapping.
 * Hard breaks (two trailing spaces or a trailing backslash) become <br>.
 * The DOM is built with createElement/textContent only (never innerHTML).
 */

import { normalizeColorName, colorOfElement, colorSpanMarkdown } from './color-spans.js';

// --- Link safety ---
// Resolve with the real URL parser rather than regex-matching the scheme: the
// parser strips leading control characters, tabs and newlines, so a string like
// "\x01javascript:..." looks relative to a regex but resolves to javascript:.
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

function isSafeHref(href) {
  const value = String(href || '').trim();
  if (!value) return false;
  if (/[\u0000-\u001f\u007f]/.test(value)) return false;
  let url;
  try {
    url = new URL(value, 'https://relative.invalid/'); // relative links resolve to https:
  } catch {
    return false;
  }
  return SAFE_PROTOCOLS.has(url.protocol);
}

// --- Markdown -> DOM ---
const LIST_LINE_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

// Earliest-match inline tokenizer: link, bold, then italic.
const INLINE_PATTERNS = [
  { type: 'link', re: /\[([^\]\n]+)\]\(([^)\s]+)\)/ },
  { type: 'color', re: /\[([^[\]\n]+)\]\{\.([A-Za-z]+)\}/ },
  { type: 'bolditalic', re: /\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/ },
  { type: 'bold', re: /\*\*(?=\S)([\s\S]*?\S)\*\*|__(?=\S)([\s\S]*?\S)__/ },
  { type: 'italic', re: /\*(?=[^\s*])([^*]*?[^\s*])?\*|(^|[^\w])_(?=[^\s_])([^_]*?[^\s_])?_(?!\w)/ }
];

function appendInline(doc, parent, text) {
  let rest = String(text || '');
  while (rest) {
    let best = null;
    for (const pattern of INLINE_PATTERNS) {
      const match = pattern.re.exec(rest);
      if (match && (!best || match.index < best.match.index)) best = { pattern, match };
    }
    if (!best) {
      appendText(doc, parent, rest);
      return;
    }
    const { pattern, match } = best;
    let start = match.index;
    let consumed = match[0];
    if (pattern.type === 'italic' && match[2] !== undefined) {
      // `_x_` form captured a leading boundary character; keep it as text.
      start += match[2].length;
      consumed = consumed.slice(match[2].length);
    }
    appendText(doc, parent, rest.slice(0, start));
    if (pattern.type === 'link') {
      const [, label, href] = match;
      if (isSafeHref(href)) {
        const a = doc.createElement('a');
        a.setAttribute('href', href);
        appendInline(doc, a, label);
        parent.appendChild(a);
      } else {
        appendText(doc, parent, match[0]);
      }
    } else if (pattern.type === 'color') {
      const color = normalizeColorName(match[2]);
      if (color) {
        const span = doc.createElement('span');
        span.className = `text-${color}`;
        appendInline(doc, span, match[1]);
        parent.appendChild(span);
      } else {
        appendText(doc, parent, match[0]);
      }
    } else if (pattern.type === 'bolditalic') {
      const strong = doc.createElement('strong');
      const em = doc.createElement('em');
      appendInline(doc, em, match[1]);
      strong.appendChild(em);
      parent.appendChild(strong);
    } else {
      const el = doc.createElement(pattern.type === 'bold' ? 'strong' : 'em');
      const inner = pattern.type === 'bold' ? (match[1] ?? match[2]) : (match[1] ?? match[3] ?? '');
      // Remember the source marker so `_x_` / `__x__` round-trip unchanged.
      if (consumed.startsWith('_')) el.dataset.mdMarker = pattern.type === 'bold' ? '__' : '_';
      appendInline(doc, el, inner);
      parent.appendChild(el);
    }
    rest = rest.slice(start + consumed.length);
  }
}

// Hard breaks become <br>; soft newlines stay inside the text node.
function appendText(doc, parent, text) {
  if (!text) return;
  text.split(/(?: {2,}|\\)\n/).forEach((part, index) => {
    if (index > 0) parent.appendChild(doc.createElement('br'));
    if (part) parent.appendChild(doc.createTextNode(part));
  });
}

function markdownToNotesDom(doc, root, markdown) {
  root.replaceChildren();
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
  let paragraphLines = [];
  let listStack = []; // [{ indent, el }]
  let lastItem = null;
  let sawBlank = false;
  // List item text is collected first (continuation lines included) and
  // rendered at the end, so soft and hard breaks work the same as in paragraphs.
  const itemTexts = [];

  const flushParagraph = () => {
    if (!paragraphLines.length) return;
    const p = doc.createElement('p');
    appendInline(doc, p, paragraphLines.join('\n'));
    root.appendChild(p);
    paragraphLines = [];
  };
  const closeLists = () => {
    listStack = [];
    lastItem = null;
  };

  for (const line of lines) {
    if (!line.trim()) {
      flushParagraph();
      sawBlank = true;
      continue;
    }
    const listMatch = line.match(LIST_LINE_RE);
    if (listMatch) {
      flushParagraph();
      const indent = listMatch[1].replace(/\t/g, '    ').length;
      const tag = /\d/.test(listMatch[2]) ? 'ol' : 'ul';
      while (listStack.length && indent < listStack[listStack.length - 1].indent) listStack.pop();
      let top = listStack[listStack.length - 1];
      if (top && indent > top.indent && lastItem) {
        const nested = doc.createElement(tag);
        lastItem.appendChild(nested);
        top = { indent, el: nested };
        listStack.push(top);
      } else if (!top || top.el.tagName.toLowerCase() !== tag) {
        const list = doc.createElement(tag);
        if (top) {
          top.el.after(list);
          listStack[listStack.length - 1] = { indent, el: list };
        } else {
          root.appendChild(list);
          listStack.push({ indent, el: list });
        }
        top = listStack[listStack.length - 1];
      }
      const li = doc.createElement('li');
      itemTexts.push({ li, text: listMatch[3] });
      top.el.appendChild(li);
      lastItem = li;
      sawBlank = false;
      continue;
    }
    if (lastItem && !sawBlank) {
      // Continuation line of the previous list item.
      itemTexts[itemTexts.length - 1].text += `\n${line.trimStart()}`;
      continue;
    }
    closeLists();
    sawBlank = false;
    paragraphLines.push(line);
  }
  flushParagraph();
  for (const { li, text } of itemTexts) {
    const holder = doc.createElement('span');
    appendInline(doc, holder, text);
    li.prepend(...holder.childNodes);
  }
}

// --- DOM -> Markdown ---
const BLOCK_TAGS = new Set(['P', 'DIV', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

function isBoldEl(el) {
  return el.tagName === 'B' || el.tagName === 'STRONG' || /^(bold|[6-9]00)$/.test(el.style?.fontWeight || '');
}

function isItalicEl(el) {
  return el.tagName === 'I' || el.tagName === 'EM' || el.style?.fontStyle === 'italic';
}

// Placeholder for <br> while serializing, so trailing-space cleanup can't
// eat the two spaces that mark a hard break.
const HARD_BREAK = '\u2028';

// Keep whitespace outside emphasis markers: "** x**" is not bold in markdown.
function wrap(inner, marker) {
  const match = inner.match(/^(\s*)([\s\S]*?)(\s*)$/);
  if (!match[2]) return inner;
  return `${match[1]}${marker}${match[2]}${marker}${match[3]}`;
}

function serializeInline(node) {
  if (node.nodeType === 3) return node.nodeValue.replace(/ /g, ' ');
  if (node.nodeType !== 1) return '';
  if (node.tagName === 'BR') return HARD_BREAK;
  const inner = [...node.childNodes].map(serializeInline).join('');
  if (node.tagName === 'A') {
    const href = node.getAttribute('href') || '';
    return isSafeHref(href) && inner.trim() ? `[${inner}](${href})` : inner;
  }
  const color = colorOfElement(node);
  if (color) return inner.split(HARD_BREAK).map((part) => colorSpanMarkdown(color, part)).join(HARD_BREAK);
  let out = inner;
  const marker = node.dataset?.mdMarker;
  if (isItalicEl(node)) out = wrap(out, marker === '_' ? '_' : '*');
  if (isBoldEl(node)) out = wrap(out, marker === '__' ? '__' : '**');
  return out;
}

function serializeList(listEl, depth, lines) {
  const ordered = listEl.tagName === 'OL';
  let number = 1;
  const indent = '  '.repeat(depth);
  for (const child of listEl.children) {
    if (child.tagName === 'UL' || child.tagName === 'OL') {
      // Chromium nests lists as siblings of <li> when indenting.
      serializeList(child, depth + 1, lines);
      continue;
    }
    if (child.tagName !== 'LI') continue;
    const marker = ordered ? `${number}.` : '-';
    number += 1;
    const inlineNodes = [];
    const nestedLists = [];
    for (const node of child.childNodes) {
      if (node.nodeType === 1 && (node.tagName === 'UL' || node.tagName === 'OL')) nestedLists.push(node);
      else inlineNodes.push(node);
    }
    const text = inlineNodes.map((node) => (
      node.nodeType === 1 && BLOCK_TAGS.has(node.tagName) ? serializeInline(node) + HARD_BREAK : serializeInline(node)
    )).join('');
    const continuation = `${indent}${' '.repeat(marker.length + 1)}`;
    lines.push(`${indent}${marker} ${finishText(text, continuation)}`);
    nestedLists.forEach((nested) => serializeList(nested, depth + 1, lines));
  }
}

// Tidy serialized text: drop edge breaks, trim each line, then turn hard-break
// placeholders into "  \n". `continuation` indents wrapped list-item lines.
function finishText(text, continuation = '') {
  const lines = text
    .replace(/^[\n\u2028]+|[\s\u2028]+$/g, '')
    .replace(/[ \t]*\u2028[ \t]*/g, '\u2028\n')
    .split('\n');
  return lines
    .map((line, index) => {
      const hard = line.endsWith(HARD_BREAK);
      const body = (continuation ? line.trim() : line.trimEnd()).replace(HARD_BREAK, '').trimEnd();
      return `${index > 0 ? continuation : ''}${body}${hard ? '  ' : ''}`;
    })
    .join('\n');
}

function notesDomToMarkdown(root) {
  const blocks = [];
  let inlineRun = [];
  const flushInline = () => {
    const text = inlineRun.map(serializeInline).join('');
    if (text.replace(/\u2028/g, '').trim()) blocks.push(finishText(text));
    inlineRun = [];
  };
  for (const node of root.childNodes) {
    if (node.nodeType === 1 && BLOCK_TAGS.has(node.tagName)) {
      flushInline();
      if (node.tagName === 'UL' || node.tagName === 'OL') {
        const lines = [];
        serializeList(node, 0, lines);
        if (lines.length) blocks.push(lines.join('\n'));
      } else if ([...node.children].some((child) => BLOCK_TAGS.has(child.tagName))) {
        // Chromium sometimes wraps blocks (even lists) in a <div>.
        const nested = notesDomToMarkdown(node);
        if (nested) blocks.push(nested);
      } else {
        inlineRun = [node];
        flushInline();
      }
    } else {
      inlineRun.push(node);
    }
  }
  flushInline();
  return blocks.join('\n\n');
}

export { markdownToNotesDom, notesDomToMarkdown, isSafeHref };
