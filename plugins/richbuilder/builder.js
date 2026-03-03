function ensureStyles() {
  if (document.getElementById('richbuilder-style')) return;
  const style = document.createElement('style');
  style.id = 'richbuilder-style';
  style.textContent = `
    .richbuilder-root {
      display: none;
      height: 100%;
      min-height: 0;
      flex: 1;
      background: #0f131b;
      color: #e5ebf5;
      border-top: 1px solid #2a2f39;
      flex-direction: column;
    }
    .richbuilder-toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 10px;
      border-bottom: 1px solid #2a2f39;
      background: #171d29;
    }
    .richbuilder-toolbar-group {
      display: inline-flex;
      gap: 6px;
      align-items: center;
    }
    .richbuilder-btn {
      border: 1px solid #3a4456;
      background: #20283a;
      color: #ecf2ff;
      border-radius: 6px;
      padding: 4px 10px;
      font: 600 12px/1.2 "Source Sans Pro", sans-serif;
      cursor: pointer;
    }
    .richbuilder-btn:hover {
      background: #2a3550;
    }
    .richbuilder-btn[data-active="true"] {
      border-color: #66a2ff;
      background: #264c82;
    }
    .richbuilder-stage {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: 20px;
      background:
        radial-gradient(circle at 90% 10%, rgba(83, 125, 213, 0.12), transparent 45%),
        radial-gradient(circle at 10% 90%, rgba(75, 159, 130, 0.12), transparent 42%),
        #0f131b;
    }
    .richbuilder-editor {
      min-height: 100%;
      background: #0b0f17;
      border: 1px solid #2e3544;
      border-radius: 10px;
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.01);
      padding: 26px;
      font: 400 36px/1.35 "Noto Serif", serif;
      white-space: pre-wrap;
      word-break: break-word;
      outline: none;
    }
    .richbuilder-editor h1,
    .richbuilder-editor h2,
    .richbuilder-editor h3,
    .richbuilder-editor p,
    .richbuilder-editor div {
      margin: 0 0 0.3em 0;
    }
    .richbuilder-editor ul,
    .richbuilder-editor ol {
      margin: 0 0 0.5em 0;
      padding-left: 1.25em;
    }
    .richbuilder-editor li {
      margin: 0.08em 0;
    }
    .richbuilder-editor img.richbuilder-inline-image {
      display: block;
      max-width: min(100%, 680px);
      max-height: 42vh;
      width: auto;
      height: auto;
      margin: 0.35em 0;
      border-radius: 6px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
      object-fit: contain;
    }
    .richbuilder-editor video.richbuilder-inline-video {
      display: block;
      max-width: min(100%, 760px);
      max-height: 42vh;
      width: auto;
      height: auto;
      margin: 0.35em 0;
      border-radius: 6px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
      background: #000;
    }
    .richbuilder-image-token {
      display: inline-block;
      max-width: 100%;
      vertical-align: middle;
    }
    .richbuilder-check-item {
      display: inline-flex;
      align-items: center;
      gap: 0.45em;
    }
    .richbuilder-check-item input[type="checkbox"] {
      width: 0.95em;
      height: 0.95em;
      margin: 0;
    }
    .richbuilder-check-item input[type="checkbox"]:checked + .richbuilder-check-text {
      text-decoration: line-through;
      opacity: 0.82;
    }
    .richbuilder-editor h1 { font-size: 1.35em; }
    .richbuilder-editor h2 { font-size: 1.2em; }
    .richbuilder-editor h3 { font-size: 1.05em; }
    .richbuilder-hint {
      margin-left: auto;
      font: 500 11px/1.2 "Source Sans Pro", sans-serif;
      opacity: 0.72;
      align-self: center;
    }
  `;
  document.head.appendChild(style);
}

const richImageRuntime = {
  slug: '',
  dir: '',
  mediaByTag: {}
};
let richBuilderInitialized = false;

const RICHBUILDER_DEBUG = window.__RICHBUILDER_DEBUG ?? true;

function rbDebug(...args) {
  if (!RICHBUILDER_DEBUG) return;
  console.log('[richbuilder][debug]', ...args);
}

function previewText(text, max = 220) {
  const value = String(text || '').replace(/\n/g, '\\n');
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

function countImageMarkdownTokens(text) {
  const matches = String(text || '').match(/!\[[^\]]*\]\([^)]+\)/g);
  return matches ? matches.length : 0;
}

function splitHardBreakSuffix(line) {
  const raw = String(line || '');
  const match = raw.match(/^(.*?)( {2,})$/);
  if (!match) return { text: raw, hasHardBreak: false };
  return { text: match[1], hasHardBreak: true };
}

function trimEmptyEdgeLines(raw) {
  const lines = String(raw || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.join('\n');
}

function insertHardBreakAtCursor() {
  const selection = window.getSelection?.();
  if (!selection || selection.rangeCount < 1) {
    document.execCommand('insertHTML', false, '<br>');
    return;
  }
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const br = document.createElement('br');
  range.insertNode(br);
  range.setStartAfter(br);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

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

function stripQueryHash(value) {
  return String(value || '').split('#')[0].split('?')[0];
}

function isVideoSource(value) {
  const candidate = stripQueryHash(value).toLowerCase();
  return /\.(mp4|webm|mov|m4v|ogv)$/.test(candidate);
}

function escapeHtml(text) {
  return String(text || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function escapeAttribute(text) {
  return escapeHtml(text).replaceAll('"', '&quot;');
}

function normalizeFrontmatterYaml(frontmatter) {
  const text = String(frontmatter || '').trim();
  if (!text) return '';
  const wrapped = text.match(/^---\r?\n([\s\S]*?)\r?\n---\s*$/);
  if (wrapped) return wrapped[1];
  return text.replace(/^---\r?\n/, '').replace(/\r?\n---\s*$/, '');
}

function updateImageRuntimeContext(host, modeCtx = {}) {
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

function resolveImageDisplaySrc(rawSrc) {
  const src = String(rawSrc || '').trim();
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
    const base = `/${richImageRuntime.dir}/${richImageRuntime.slug}/${filename}`;
    rbDebug('resolveImageDisplaySrc:media-alias-hit', { src, resolved: base });
    return encodePathSafely(base);
  }

  if (!richImageRuntime.dir || !richImageRuntime.slug) return src;
  const base = `/${richImageRuntime.dir}/${richImageRuntime.slug}/${src}`;
  rbDebug('resolveImageDisplaySrc:relative', { src, resolved: base });
  return encodePathSafely(base);
}

function buildImageHtmlTag(alt, src) {
  const resolvedSrc = resolveImageDisplaySrc(src);
  const finalSrc = resolvedSrc || src;
  if (isVideoSource(finalSrc)) {
    return `<video class="richbuilder-inline-video" src="${escapeAttribute(finalSrc)}" data-md-alt="${escapeAttribute(alt)}" data-md-src="${escapeAttribute(src)}" controls preload="metadata" playsinline muted></video>`;
  }
  return `<img class="richbuilder-inline-image" src="${escapeAttribute(finalSrc)}" alt="${escapeAttribute(alt)}" data-md-alt="${escapeAttribute(alt)}" data-md-src="${escapeAttribute(src)}">`;
}

function parseSingleImageLine(line) {
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

function buildImageMarkdownToken(alt, src) {
  return `![${String(alt || '')}](${String(src || '')})`;
}

function imageMarkdownToHtml(raw) {
  const text = String(raw || '');
  const imagePattern = /!\[([^\]]*)\]\(([^)]+)\)/g;
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

function inlineMarkdownToHtml(text) {
  let html = imageMarkdownToHtml(text || '');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/\+\+(.+?)\+\+/g, '<u>$1</u>');
  return html;
}

function parseListLine(line) {
  const raw = String(line || '');
  const unordered = raw.match(/^(\s*)[-*+]\s+(.*)$/);
  const ordered = raw.match(/^(\s*)\d+\.\s+(.*)$/);
  const match = unordered || ordered;
  if (!match) return null;

  const indent = match[1] || '';
  const indentSize = indent.replace(/\t/g, '  ').length;
  const level = Math.floor(indentSize / 2);
  const type = unordered ? 'ul' : 'ol';
  const content = String(match[2] || '');
  const checklistMatch = type === 'ul' ? content.match(/^\[( |x|X)\]\s+(.*)$/) : null;
  const isChecklist = !!checklistMatch;
  const checked = !!checklistMatch && checklistMatch[1].toLowerCase() === 'x';
  const text = checklistMatch ? checklistMatch[2] : content;

  return { level, type, text, isChecklist, checked };
}

function createChecklistLabel(text, checked) {
  const label = document.createElement('label');
  label.className = 'richbuilder-check-item';

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = !!checked;
  input.setAttribute('contenteditable', 'false');

  const textSpan = document.createElement('span');
  textSpan.className = 'richbuilder-check-text';
  textSpan.innerHTML = inlineMarkdownToHtml(text);

  label.appendChild(input);
  label.appendChild(textSpan);
  return label;
}

function buildListBlock(lines, startIndex) {
  const container = document.createElement('div');
  const stack = [];
  let idx = startIndex;

  const openList = (parentEl, type, level) => {
    const list = document.createElement(type);
    parentEl.appendChild(list);
    stack.push({ level, type, list, lastLi: null, parentEl });
    return stack[stack.length - 1];
  };

  while (idx < lines.length) {
    const token = parseListLine(lines[idx]);
    if (!token) break;

    if (!stack.length) {
      openList(container, token.type, token.level);
    }

    let current = stack[stack.length - 1];
    let targetLevel = token.level;
    if (targetLevel > current.level + 1) {
      targetLevel = current.level + 1;
    }

    while (stack.length && targetLevel < stack[stack.length - 1].level) {
      stack.pop();
    }
    current = stack[stack.length - 1];

    while (current && targetLevel > current.level) {
      const parentLi = current.lastLi;
      if (!parentLi) {
        targetLevel = current.level;
        break;
      }
      current = openList(parentLi, token.type, current.level + 1);
    }

    current = stack[stack.length - 1];
    if (!current) {
      current = openList(container, token.type, targetLevel);
    }

    if (current.level === targetLevel && current.type !== token.type) {
      stack.pop();
      const parentCtx = stack[stack.length - 1];
      const parentEl = parentCtx ? parentCtx.lastLi : container;
      current = openList(parentEl || container, token.type, targetLevel);
    }

    const li = document.createElement('li');
    if (token.isChecklist) {
      li.dataset.checklist = 'true';
      li.dataset.checked = token.checked ? 'true' : 'false';
      li.appendChild(createChecklistLabel(token.text, token.checked));
    } else {
      li.innerHTML = inlineMarkdownToHtml(token.text);
    }

    current.list.appendChild(li);
    current.lastLi = li;
    idx += 1;
  }

  return {
    html: container.innerHTML,
    nextIndex: idx
  };
}

function markdownToHtml(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  rbDebug('markdownToHtml:start', {
    lineCount: lines.length,
    imageTokenCount: countImageMarkdownTokens(markdown),
    markdown: previewText(markdown, 420)
  });
  const chunks = [];
  let idx = 0;

  while (idx < lines.length) {
    const line = lines[idx];
    const trimmed = String(line || '').trim();

    if (!trimmed) {
      chunks.push('<div><br></div>');
      idx += 1;
      continue;
    }

    if (parseListLine(line)) {
      const block = buildListBlock(lines, idx);
      chunks.push(block.html);
      idx = block.nextIndex;
      continue;
    }

    const singleImage = parseSingleImageLine(line);
    if (singleImage) {
      const token = buildImageMarkdownToken(singleImage.alt, singleImage.src);
      rbDebug('markdownToHtml:single-image-line', {
        line: previewText(line),
        token
      });
      chunks.push(`<div><span class="richbuilder-image-token" contenteditable="false" data-md-image="${escapeAttribute(token)}">${buildImageHtmlTag(singleImage.alt, singleImage.src)}</span></div>`);
      idx += 1;
      continue;
    }

    if (/^###\s+/.test(line)) {
      chunks.push(`<h3>${inlineMarkdownToHtml(line.replace(/^###\s+/, ''))}</h3>`);
      idx += 1;
      continue;
    }
    if (/^##\s+/.test(line)) {
      chunks.push(`<h2>${inlineMarkdownToHtml(line.replace(/^##\s+/, ''))}</h2>`);
      idx += 1;
      continue;
    }
    if (/^#\s+/.test(line)) {
      chunks.push(`<h1>${inlineMarkdownToHtml(line.replace(/^#\s+/, ''))}</h1>`);
      idx += 1;
      continue;
    }

    const first = splitHardBreakSuffix(line);
    let inlineHtml = inlineMarkdownToHtml(first.text);
    let keepMerging = first.hasHardBreak;

    while (keepMerging && idx + 1 < lines.length) {
      idx += 1;
      const nextLine = String(lines[idx] || '');
      const next = splitHardBreakSuffix(nextLine);
      inlineHtml += `<br>${inlineMarkdownToHtml(next.text)}`;
      keepMerging = next.hasHardBreak;
    }

    chunks.push(`<div>${inlineHtml}</div>`);
    idx += 1;
  }

  const html = chunks.join('');
  rbDebug('markdownToHtml:end', {
    html: previewText(html, 420),
    htmlImageTokenCount: (html.match(/data-md-image=/g) || []).length
  });
  return html;
}

function serializeInline(node) {
  if (!node) return '';
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent || '';
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }

  const tag = node.tagName.toLowerCase();
  if (tag === 'br') return '  \n';
  if (tag === 'input' && node.getAttribute('type') === 'checkbox') return '';
  if (tag === 'span' && node.hasAttribute('data-md-image')) {
    const token = node.getAttribute('data-md-image') || '';
    rbDebug('serializeInline:image-span', { token });
    return token;
  }
  if (tag === 'img') {
    const alt = node.getAttribute('data-md-alt') ?? node.getAttribute('alt') ?? '';
    const src = node.getAttribute('data-md-src') ?? node.getAttribute('src') ?? '';
    rbDebug('serializeInline:image-tag', { alt, src });
    return src ? `![${alt}](${src})` : '';
  }
  if (tag === 'video') {
    const alt = node.getAttribute('data-md-alt') ?? '';
    const src = node.getAttribute('data-md-src') ?? node.getAttribute('src') ?? '';
    rbDebug('serializeInline:video-tag', { alt, src });
    return src ? `![${alt}](${src})` : '';
  }

  const inner = Array.from(node.childNodes).map(serializeInline).join('');
  if (tag === 'em' || tag === 'i') return `*${inner}*`;
  if (tag === 'strong' || tag === 'b') return `**${inner}**`;
  if (tag === 'u') return `++${inner}++`;
  return inner;
}

function serializeListToMarkdown(listEl, depth = 0) {
  const lines = [];
  if (!listEl) return lines;
  const listTag = listEl.tagName.toLowerCase();
  let orderedIndex = 1;
  let sawRealListItem = false;
  const childElements = Array.from(listEl.children || []);

  childElements.forEach((element) => {
    const tag = element.tagName?.toLowerCase();
    if (tag === 'li') {
      sawRealListItem = true;
      const item = element;
      const nestedLists = Array.from(item.querySelectorAll('ul, ol')).filter((listNode) => {
        return listNode.closest('li') === item;
      });

      const itemClone = item.cloneNode(true);
      Array.from(itemClone.querySelectorAll('ul, ol')).forEach((listNode) => {
        if (listNode.closest('li') === itemClone) {
          listNode.remove();
        }
      });

      let content = trimEmptyEdgeLines(Array.from(itemClone.childNodes).map(serializeInline).join(''));
      const checklistInput = item.querySelector(':scope > .richbuilder-check-item > input[type="checkbox"]');
      const checklistState = item.dataset.checklist === 'true' || !!checklistInput;
      const checked = item.dataset.checked === 'true' || !!checklistInput?.checked;
      if (!content && checklistInput) {
        const textEl = item.querySelector(':scope > .richbuilder-check-item > .richbuilder-check-text');
        content = trimEmptyEdgeLines(Array.from(textEl?.childNodes || []).map(serializeInline).join(''));
      }

      const indent = '  '.repeat(depth);
      const bullet = listTag === 'ol' ? `${orderedIndex}. ` : '- ';
      const checklistPrefix = checklistState ? `[${checked ? 'x' : ' '}] ` : '';
      if (content || checklistState) {
        lines.push(`${indent}${bullet}${checklistPrefix}${content}`);
      }
      if (listTag === 'ol') {
        orderedIndex += 1;
      }

      nestedLists.forEach((nested) => {
        lines.push(...serializeListToMarkdown(nested, depth + 1));
      });
      return;
    }

    if (tag === 'ul' || tag === 'ol') {
      // Some browsers create orphan nested lists when indenting in contenteditable.
      // Treat them as nested content so markdown does not lose indented items.
      lines.push(...serializeListToMarkdown(element, depth + (sawRealListItem ? 1 : 0)));
    }
  });

  return lines;
}

function htmlToMarkdown(rootEl) {
  if (!rootEl) return '';
  const lines = [];
  const blocks = Array.from(rootEl.children);
  rbDebug('htmlToMarkdown:start', {
    blockCount: blocks.length,
    rootHtml: previewText(rootEl.innerHTML, 520)
  });

  if (!blocks.length) {
    const fallback = String(rootEl.textContent || '').trim();
    rbDebug('htmlToMarkdown:no-blocks-fallback', {
      textContent: previewText(rootEl.textContent || '', 420),
      fallback
    });
    return fallback;
  }

  blocks.forEach((node, blockIndex) => {
    const tag = node.tagName.toLowerCase();
    rbDebug('htmlToMarkdown:block:start', {
      blockIndex,
      tag,
      html: previewText(node.outerHTML || '', 420)
    });
    const childElements = Array.from(node.children || []);
    const directChildLists = childElements.filter((child) => {
      const childTag = child.tagName?.toLowerCase();
      return childTag === 'ul' || childTag === 'ol';
    });

    if (tag === 'ul' || tag === 'ol') {
      lines.push(...serializeListToMarkdown(node, 0));
      lines.push('');
      return;
    }

    if (tag === 'li') {
      const inline = trimEmptyEdgeLines(Array.from(node.childNodes).map(serializeInline).join(''));
      if (inline) {
        lines.push(`- ${inline}`);
        lines.push('');
      }
      return;
    }

    if (directChildLists.length) {
      const nonListNodes = Array.from(node.childNodes).filter((child) => {
        if (child.nodeType !== Node.ELEMENT_NODE) return true;
        const childTag = child.tagName.toLowerCase();
        return childTag !== 'ul' && childTag !== 'ol';
      });
      const wrapperText = trimEmptyEdgeLines(nonListNodes.map(serializeInline).join(''));
      if (wrapperText) {
        lines.push(wrapperText);
      }
      directChildLists.forEach((list) => {
        lines.push(...serializeListToMarkdown(list, 0));
      });
      lines.push('');
      return;
    }

    const content = trimEmptyEdgeLines(Array.from(node.childNodes).map(serializeInline).join(''));
    rbDebug('htmlToMarkdown:block:content', {
      blockIndex,
      tag,
      content
    });

    if (!content) {
      lines.push('');
      return;
    }
    if (tag === 'h1') {
      lines.push(`# ${content}`);
      lines.push('');
      return;
    }
    if (tag === 'h2') {
      lines.push(`## ${content}`);
      lines.push('');
      return;
    }
    if (tag === 'h3') {
      lines.push(`### ${content}`);
      lines.push('');
      return;
    }
    lines.push(content);
    lines.push('');
  });

  const markdown = lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');
  rbDebug('htmlToMarkdown:end', {
    blockCount: blocks.length,
    imageTokenCount: countImageMarkdownTokens(markdown),
    markdown: previewText(markdown, 420)
  });
  return markdown;
}

function applyHeadingTag(level) {
  const tag = level === 1 ? 'H1' : level === 2 ? 'H2' : level === 3 ? 'H3' : 'DIV';
  document.execCommand('formatBlock', false, tag);
}

function getSelectionListItem() {
  const selection = window.getSelection();
  let node = selection?.anchorNode || null;
  if (node && node.nodeType !== Node.ELEMENT_NODE) {
    node = node.parentElement;
  }
  return node && typeof node.closest === 'function' ? node.closest('li') : null;
}

function handleEditorTabIndent(event) {
  if (!event || event.key !== 'Tab') return false;
  const activeLi = getSelectionListItem();
  if (!activeLi) return false;
  event.preventDefault();
  if (event.shiftKey) {
    document.execCommand('outdent', false);
  } else {
    document.execCommand('indent', false);
  }
  return true;
}

function toggleChecklistAtSelection(editor) {
  if (!editor) return;
  let li = getSelectionListItem();

  if (!li) {
    document.execCommand('insertUnorderedList', false);
    li = getSelectionListItem();
  }
  if (!li) return;

  const existingInput = li.querySelector(':scope > .richbuilder-check-item > input[type="checkbox"]');
  if (existingInput) {
    existingInput.checked = !existingInput.checked;
    li.dataset.checklist = 'true';
    li.dataset.checked = existingInput.checked ? 'true' : 'false';
    return;
  }

  const nestedLists = Array.from(li.children).filter((child) => {
    const tag = child.tagName?.toLowerCase();
    return tag === 'ul' || tag === 'ol';
  });
  const inlineNodes = Array.from(li.childNodes).filter((child) => !nestedLists.includes(child));

  const label = createChecklistLabel('', false);
  const textSpan = label.querySelector('.richbuilder-check-text');
  inlineNodes.forEach((node) => textSpan.appendChild(node));
  li.insertBefore(label, li.firstChild);
  li.dataset.checklist = 'true';
  li.dataset.checked = 'false';
}

function updateTextareaMarkdown(markdown) {
  const editorEl = document.getElementById('slide-editor');
  if (!editorEl) return;
  if (editorEl.value === markdown) return;
  editorEl.value = markdown;
  editorEl.dispatchEvent(new Event('input', { bubbles: true }));
}

function getCurrentSlideBody(host) {
  const doc = host.getDocument();
  const selection = host.getSelection();
  return String(doc?.stacks?.[selection.h]?.[selection.v]?.body || '');
}

function updateToolbarState(editorEl, toolbarEl) {
  const blocks = ['h1', 'h2', 'h3'];
  const activeTag = String(document.queryCommandValue('formatBlock') || '').toLowerCase();
  blocks.forEach((tag) => {
    const btn = toolbarEl.querySelector(`[data-role="heading-${tag}"]`);
    if (btn) {
      btn.dataset.active = String(activeTag === tag);
    }
  });

  const isItalic = document.queryCommandState('italic');
  const isUnderline = document.queryCommandState('underline');
  const isBold = document.queryCommandState('bold');
  const isUl = document.queryCommandState('insertUnorderedList');
  const isOl = document.queryCommandState('insertOrderedList');
  const activeChecklist = getSelectionListItem()?.dataset?.checklist === 'true';

  const italicBtn = toolbarEl.querySelector('[data-role="italic"]');
  const underlineBtn = toolbarEl.querySelector('[data-role="underline"]');
  const boldBtn = toolbarEl.querySelector('[data-role="bold"]');
  const ulBtn = toolbarEl.querySelector('[data-role="ul"]');
  const olBtn = toolbarEl.querySelector('[data-role="ol"]');
  const checklistBtn = toolbarEl.querySelector('[data-role="checklist"]');

  if (italicBtn) italicBtn.dataset.active = String(!!isItalic);
  if (underlineBtn) underlineBtn.dataset.active = String(!!isUnderline);
  if (boldBtn) boldBtn.dataset.active = String(!!isBold);
  if (ulBtn) ulBtn.dataset.active = String(!!isUl);
  if (olBtn) olBtn.dataset.active = String(!!isOl);
  if (checklistBtn) checklistBtn.dataset.active = String(activeChecklist);

  if (!editorEl.contains(document.activeElement)) {
    [italicBtn, underlineBtn, boldBtn, ulBtn, olBtn, checklistBtn].forEach((btn) => {
      if (btn) btn.dataset.active = 'false';
    });
  }
}

export function getBuilderExtensions(ctx = {}) {
  const host = ctx.host;
  if (!host) return [];
  if (richBuilderInitialized) return [];
  richBuilderInitialized = true;

  const PREVIEW_VIEW_GROUP = 'core-preview-view';
  const PREVIEW_SLIDE_BUTTON_ID = 'core-preview-slide';
  const PREVIEW_OVERVIEW_BUTTON_ID = 'core-preview-overview';
  const RICH_BUTTON_ID = 'rich-builder-mode';
  const modeCtx = {
    slug: String(ctx.slug || '').trim(),
    dir: String(ctx.dir || '').trim()
  };

  ensureStyles();

  const previewFrame = document.getElementById('preview-frame');
  const previewPanel = document.querySelector('.builder-preview .panel-body') || previewFrame?.parentElement;

  const root = document.createElement('div');
  root.className = 'richbuilder-root';

  const toolbar = document.createElement('div');
  toolbar.className = 'richbuilder-toolbar';
  toolbar.innerHTML = `
    <div class="richbuilder-toolbar-group">
      <button type="button" class="richbuilder-btn" data-role="heading-h1">H1</button>
      <button type="button" class="richbuilder-btn" data-role="heading-h2">H2</button>
      <button type="button" class="richbuilder-btn" data-role="heading-h3">H3</button>
    </div>
    <div class="richbuilder-toolbar-group">
      <button type="button" class="richbuilder-btn" data-role="bold"><b>B</b></button>
      <button type="button" class="richbuilder-btn" data-role="italic"><i>I</i></button>
      <button type="button" class="richbuilder-btn" data-role="underline"><u>U</u></button>
    </div>
    <div class="richbuilder-toolbar-group">
      <button type="button" class="richbuilder-btn" data-role="ul">UL</button>
      <button type="button" class="richbuilder-btn" data-role="ol">OL</button>
      <button type="button" class="richbuilder-btn" data-role="checklist">Task</button>
    </div>
    <div class="richbuilder-hint">Rich editing updates slide markdown</div>
  `;

  const stage = document.createElement('div');
  stage.className = 'richbuilder-stage';

  const editor = document.createElement('div');
  editor.className = 'richbuilder-editor';
  editor.contentEditable = 'true';
  editor.spellcheck = true;

  stage.appendChild(editor);
  root.appendChild(toolbar);
  root.appendChild(stage);

  if (previewPanel) {
    previewPanel.appendChild(root);
  }

  let isActive = false;
  let syncing = false;
  let rafToken = 0;
  let lastSyncedMarkdown = '';

  const syncToMarkdown = () => {
    if (!isActive || syncing) return;
    rbDebug('syncToMarkdown:start', {
      editorHtml: previewText(editor.innerHTML, 520)
    });
    const markdown = htmlToMarkdown(editor);
    rbDebug('syncToMarkdown', {
      prevImageTokens: countImageMarkdownTokens(lastSyncedMarkdown),
      nextImageTokens: countImageMarkdownTokens(markdown),
      markdown: previewText(markdown, 420)
    });
    lastSyncedMarkdown = markdown;
    updateTextareaMarkdown(markdown);
    updateToolbarState(editor, toolbar);
  };

  const scheduleSync = () => {
    if (rafToken) cancelAnimationFrame(rafToken);
    rafToken = requestAnimationFrame(() => {
      rafToken = 0;
      syncToMarkdown();
    });
  };

  const syncFromCurrentSlide = () => {
    if (!isActive) return;
    updateImageRuntimeContext(host, modeCtx);
    const markdown = getCurrentSlideBody(host);
    rbDebug('syncFromCurrentSlide:input', {
      imageTokenCount: countImageMarkdownTokens(markdown),
      markdown: previewText(markdown, 420)
    });
    if (markdown === lastSyncedMarkdown) return;
    syncing = true;
    editor.innerHTML = markdownToHtml(markdown);
    rbDebug('syncFromCurrentSlide:editor-html', {
      htmlImageTokenCount: (editor.innerHTML.match(/data-md-image=/g) || []).length,
      html: previewText(editor.innerHTML, 420)
    });
    const hasInlineMedia = !!editor.querySelector('img, [data-md-image], video, audio, iframe');
    if (!editor.textContent?.trim() && !hasInlineMedia) {
      editor.innerHTML = '<div><br></div>';
    }
    lastSyncedMarkdown = markdown;
    syncing = false;
  };

  function restoreCorePreviewButtonState() {
    if (typeof host.setPreviewButtonGroupActive !== 'function') return;
    const deck = window.__builderPreviewDeck;
    const isOverview = !!(deck && typeof deck.isOverview === 'function' && deck.isOverview());
    host.setPreviewButtonGroupActive(
      PREVIEW_VIEW_GROUP,
      isOverview ? PREVIEW_OVERVIEW_BUTTON_ID : PREVIEW_SLIDE_BUTTON_ID
    );
  }

  function activate() {
    if (isActive) return;
    isActive = true;
    updateImageRuntimeContext(host, modeCtx);
    root.style.display = 'flex';
    if (previewFrame) previewFrame.style.display = 'none';
    syncFromCurrentSlide();
    editor.focus();
  }

  function deactivate({ restorePreviewButtons = true } = {}) {
    if (!isActive && !restorePreviewButtons) return;
    isActive = false;
    if (rafToken) cancelAnimationFrame(rafToken);
    rafToken = 0;
    root.style.display = 'none';
    if (previewFrame) {
      previewFrame.style.display = '';
      const deck = window.__builderPreviewDeck;
      if (deck && typeof deck.layout === 'function') {
        deck.layout();
        window.setTimeout(() => deck.layout?.(), 140);
      } else {
        previewFrame.contentWindow?.dispatchEvent?.(new Event('resize'));
      }
    }
    if (restorePreviewButtons) {
      restoreCorePreviewButtonState();
    }
  }

  toolbar.addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-role]');
    if (!btn || !isActive) return;

    const role = btn.dataset.role;
    editor.focus();

    if (role === 'heading-h1') applyHeadingTag(1);
    if (role === 'heading-h2') applyHeadingTag(2);
    if (role === 'heading-h3') applyHeadingTag(3);
    if (role === 'bold') document.execCommand('bold', false);
    if (role === 'italic') document.execCommand('italic', false);
    if (role === 'underline') document.execCommand('underline', false);
    if (role === 'ul') document.execCommand('insertUnorderedList', false);
    if (role === 'ol') document.execCommand('insertOrderedList', false);
    if (role === 'checklist') toggleChecklistAtSelection(editor);

    scheduleSync();
  });

  editor.addEventListener('input', scheduleSync);
  editor.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault();
      insertHardBreakAtCursor();
      scheduleSync();
      return;
    }
    if (handleEditorTabIndent(event)) {
      scheduleSync();
    }
  });
  editor.addEventListener('change', (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.type === 'checkbox') {
      const li = target.closest('li');
      if (li) {
        li.dataset.checklist = 'true';
        li.dataset.checked = target.checked ? 'true' : 'false';
      }
      scheduleSync();
    }
  });
  editor.addEventListener('keyup', () => updateToolbarState(editor, toolbar));
  editor.addEventListener('mouseup', () => updateToolbarState(editor, toolbar));

  host.on('selection:changed', () => {
    if (!isActive) return;
    syncFromCurrentSlide();
  });
  host.on('document:changed', (payload) => {
    if (!isActive || payload?.source === 'dirty') return;
    if (editor.contains(document.activeElement)) return;
    syncFromCurrentSlide();
  });
  host.on('preview-button:changed', (payload = {}) => {
    if (String(payload.id || '') !== RICH_BUTTON_ID) return;
    if (payload.active) {
      activate();
      return;
    }
    deactivate({ restorePreviewButtons: false });
  });

  host.registerPreviewButton({
    id: RICH_BUTTON_ID,
    location: 'preview-header',
    title: 'R Rich',
    tooltip: 'Rich',
    group: PREVIEW_VIEW_GROUP,
    onClick: ({ isActive: buttonIsActive, setGroupActive }) => {
      if (buttonIsActive()) {
        deactivate();
        return;
      }
      setGroupActive(RICH_BUTTON_ID);
      activate();
    }
  });

  host.setPreviewButtonGroupActive(PREVIEW_VIEW_GROUP, RICH_BUTTON_ID);
  activate();
  return [];
}
