import { editorEl, slug, mdFile } from './context.js';
import { applyReplacementToEditor } from './editor-actions.js';
import { reparseFromFile } from './presentation.js';

const SMART_PASTE_WORD_LIMIT = 60;
const SMART_PASTE_SLIDE_BREAK = '\n\n---\n\n';

function countWords(text = '') {
  const matches = String(text || '').match(/\S+/g);
  return matches ? matches.length : 0;
}

function splitLongSlideByWordLimit(text, wordLimit = SMART_PASTE_WORD_LIMIT) {
  const source = String(text || '').trim();
  if (!source) return [];
  const tokens = Array.from(source.matchAll(/\S+/g));
  if (!tokens.length) return [];
  if (tokens.length <= wordLimit) return [source];

  const chunks = [];
  const windowSize = Math.max(10, Math.floor(wordLimit * 0.35));
  let startWord = 0;

  const nextTokenStartsWithDigitAfterNewline = (tokenIndex) => {
    if (tokenIndex <= 0 || tokenIndex >= tokens.length) return false;
    const prev = tokens[tokenIndex - 1];
    const current = tokens[tokenIndex];
    if (!prev || !current) return false;
    const between = source.slice(prev.index + prev[0].length, current.index);
    return /\n+\s*$/.test(between) && /^\d/.test(current[0]);
  };

  const tokenEndsSentence = (tokenIndex) => {
    const token = tokens[tokenIndex]?.[0] || '';
    return /[.!?][)\]"']*$/.test(token);
  };

  while (startWord < tokens.length) {
    const remaining = tokens.length - startWord;
    if (remaining <= wordLimit) {
      const startChar = tokens[startWord].index;
      chunks.push(source.slice(startChar).trim());
      break;
    }

    const targetWord = startWord + wordLimit;
    const minIdx = Math.max(startWord + 1, targetWord - windowSize);
    const maxIdx = Math.min(tokens.length - 1, targetWord + windowSize);

    let chosenCut = targetWord;
    let bestScore = -1;

    for (let idx = minIdx; idx <= maxIdx; idx += 1) {
      let score = 0;
      if (tokenEndsSentence(idx - 1)) score += 3;
      if (nextTokenStartsWithDigitAfterNewline(idx)) score += 4;
      if (idx >= targetWord) score += 1;
      if (score > bestScore) {
        bestScore = score;
        chosenCut = idx;
      }
    }

    const startChar = tokens[startWord].index;
    const endChar = tokens[chosenCut - 1].index + tokens[chosenCut - 1][0].length;
    chunks.push(source.slice(startChar, endChar).trim());
    startWord = chosenCut;
  }

  return chunks.filter(Boolean);
}

function applyDefaultSmartPasteTransform(text) {
  const normalized = String(text || '').replace(/\r\n?/g, '\n').trim();
  if (!normalized) return '';
  const withParagraphSlideBreaks = normalized.replace(/\n{2,}/g, SMART_PASTE_SLIDE_BREAK);
  const rawSlides = withParagraphSlideBreaks
    .split(/\n\s*---\s*\n/g)
    .map((part) => part.trim())
    .filter(Boolean);

  const finalSlides = [];
  rawSlides.forEach((slideText) => {
    const slideWithHardBreaks = slideText
      .split('\n')
      .map((line) => line.replace(/\s+$/g, ''))
      .join('  \n');
    finalSlides.push(slideWithHardBreaks);
  });

  return applyWordCountChunkingToSlides(
    promoteParagraphBreaksToSlideBreaks(finalSlides.join(SMART_PASTE_SLIDE_BREAK))
  );
}

function applyHtmlSmartPasteTransform(text) {
  const normalized = String(text || '').replace(/\r\n?/g, '\n').trim();
  if (!normalized) return '';
  const rawSlides = normalized
    .split(/\n\s*---\s*\n/g)
    .map((part) => part.trim())
    .filter(Boolean);

  const finalSlides = [];
  rawSlides.forEach((slideText) => {
    const slideWithHardBreaks = slideText
      .split('\n')
      .map((line) => line.replace(/\s+$/g, ''))
      .join('  \n');
    finalSlides.push(slideWithHardBreaks);
  });

  return applyWordCountChunkingToSlides(
    promoteParagraphBreaksToSlideBreaks(finalSlides.join(SMART_PASTE_SLIDE_BREAK))
  );
}

function promoteParagraphBreaksToSlideBreaks(text) {
  const source = String(text || '').replace(/\r\n?/g, '\n').trim();
  if (!source) return '';
  const slides = source
    .split(/\n\s*---\s*\n/g)
    .map((slide) => slide.trim())
    .filter(Boolean);

  const normalizedSlides = [];
  slides.forEach((slide) => {
    const parts = slide
      .split(/(?:[ \t]*\n){2,}/g)
      .map((part) => part.trim())
      .filter(Boolean);
    if (!parts.length) return;
    normalizedSlides.push(...parts);
  });

  return normalizedSlides.join(SMART_PASTE_SLIDE_BREAK);
}

function applyWordCountChunkingToSlides(text) {
  const source = String(text || '').replace(/\r\n?/g, '\n').trim();
  if (!source) return '';
  const slides = source
    .split(/\n\s*---\s*\n/g)
    .map((slide) => slide.trim())
    .filter(Boolean);

  const chunkedSlides = [];
  slides.forEach((slide) => {
    if (countWords(slide) <= SMART_PASTE_WORD_LIMIT) {
      chunkedSlides.push(slide);
      return;
    }
    chunkedSlides.push(...splitLongSlideByWordLimit(slide, SMART_PASTE_WORD_LIMIT));
  });

  return chunkedSlides.join(SMART_PASTE_SLIDE_BREAK);
}

async function readClipboardText() {
  if (window.electronAPI?.readClipboardText) {
    return String(await window.electronAPI.readClipboardText() || '');
  }
  if (navigator.clipboard?.readText) {
    return String(await navigator.clipboard.readText() || '');
  }
  return '';
}

function sanitizeInlineText(value) {
  const text = String(value || '').replace(/\u00a0/g, ' ');
  return text.replace(/[ \t]+/g, ' ');
}

function readClipboardHtmlFromNavigator() {
  if (!navigator.clipboard?.read || typeof navigator.clipboard.read !== 'function') {
    return Promise.resolve('');
  }
  return navigator.clipboard.read()
    .then(async (items) => {
      for (const item of items || []) {
        if (!item.types?.includes('text/html')) continue;
        const blob = await item.getType('text/html');
        return blob ? blob.text() : '';
      }
      return '';
    })
    .catch(() => '');
}

async function readClipboardPayload() {
  const text = await readClipboardText();
  let html = '';
  if (window.electronAPI?.readClipboardHTML) {
    html = String(await window.electronAPI.readClipboardHTML() || '');
  } else {
    html = String(await readClipboardHtmlFromNavigator() || '');
  }
  return { text: String(text || ''), html: String(html || '') };
}

function extractStructuredTextFromHtml(html = '') {
  const source = String(html || '').trim();
  if (!source) return '';
  if (typeof DOMParser !== 'function') return '';

  const doc = new DOMParser().parseFromString(source, 'text/html');
  const body = doc?.body;
  if (!body) return '';

  const isHeadingTag = (tag) => /^h[1-6]$/.test(tag);
  const isContainerTag = (tag) => ['div', 'section', 'article', 'header', 'footer', 'aside', 'blockquote'].includes(tag);
  const isListTag = (tag) => tag === 'ul' || tag === 'ol';
  const isBlockTag = (tag) => isHeadingTag(tag) || isContainerTag(tag) || isListTag(tag) || tag === 'p' || tag === 'pre' || tag === 'li';
  const lineBlocks = [];

  const shouldInsertInlineSpace = (prev, next) => {
    if (!prev || !next) return false;
    if (/\s$/.test(prev) || /^\s/.test(next)) return false;
    if (/[([{"'`/]$/.test(prev)) return false;
    if (/^[)\]}"'`.,!?;:/]/.test(next)) return false;
    return /[A-Za-z0-9*_`)]$/.test(prev) && /^[A-Za-z0-9*_`([]/.test(next);
  };

  const joinInlineSegments = (parts = []) => {
    let out = '';
    parts.forEach((part) => {
      if (!part) return;
      if (shouldInsertInlineSpace(out, part)) {
        out += ' ';
      }
      out += part;
    });
    return out;
  };

  const renderInline = (node) => {
    if (!node) return '';
    if (node.nodeType === Node.TEXT_NODE) {
      return sanitizeInlineText(node.nodeValue || '');
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const tag = String(node.tagName || '').toLowerCase();
    const children = Array.from(node.childNodes || []);
    const inner = joinInlineSegments(children.map((child) => renderInline(child)));

    if (tag === 'br') return '\n';
    if (tag === 'strong' || tag === 'b') {
      const trimmed = inner.trim();
      if (!trimmed) return '';
      const leading = /^\s/.test(inner) ? ' ' : '';
      const trailing = /\s$/.test(inner) ? ' ' : '';
      return `${leading}**${trimmed}**${trailing}`;
    }
    if (tag === 'em' || tag === 'i') {
      const trimmed = inner.trim();
      if (!trimmed) return '';
      const leading = /^\s/.test(inner) ? ' ' : '';
      const trailing = /\s$/.test(inner) ? ' ' : '';
      return `${leading}*${trimmed}*${trailing}`;
    }
    if (tag === 'code') {
      const trimmed = sanitizeInlineText(node.textContent || '').trim();
      return trimmed ? `\`${trimmed}\`` : '';
    }
    if (tag === 'a') {
      const label = inner.trim();
      const href = String(node.getAttribute('href') || '').trim();
      if (!href) return label;
      if (!label || label === href) return href;
      return `[${label}](${href})`;
    }
    return inner;
  };

  const isBoldParagraph = (element) => {
    const tag = String(element?.tagName || '').toLowerCase();
    if (!(tag === 'p' || tag === 'div')) return false;
    const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let sawMeaningfulText = false;
    let current = walker.nextNode();
    while (current) {
      const text = String(current.nodeValue || '').trim();
      if (text) {
        sawMeaningfulText = true;
        let parent = current.parentElement;
        let inBold = false;
        while (parent && parent !== element) {
          const parentTag = String(parent.tagName || '').toLowerCase();
          if (parentTag === 'strong' || parentTag === 'b') {
            inBold = true;
            break;
          }
          parent = parent.parentElement;
        }
        if (!inBold) return false;
      }
      current = walker.nextNode();
    }
    return sawMeaningfulText;
  };

  const collectBlocks = (node) => {
    if (!node) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const text = sanitizeInlineText(node.nodeValue || '').trim();
      if (text) {
        lineBlocks.push({ type: 'paragraph', text, breakBefore: false });
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const tag = String(node.tagName || '').toLowerCase();
    if (isHeadingTag(tag)) {
      const level = Number(tag.slice(1));
      const headingText = renderInline(node).replace(/\n+/g, ' ').trim();
      if (headingText) {
        lineBlocks.push({
          type: 'heading',
          text: `${'#'.repeat(Math.max(1, Math.min(level, 6)))} ${headingText}`,
          breakBefore: true
        });
      }
      return;
    }

    if (tag === 'pre') {
      const codeText = String(node.textContent || '').replace(/\r\n?/g, '\n').trim();
      if (codeText) {
        lineBlocks.push({ type: 'paragraph', text: `\`\`\`\n${codeText}\n\`\`\``, breakBefore: false });
      }
      return;
    }

    if (isListTag(tag)) {
      const items = Array.from(node.children || [])
        .filter((child) => String(child.tagName || '').toLowerCase() === 'li')
        .map((child, index) => {
          const itemText = renderInline(child).replace(/\n+/g, ' ').trim();
          if (!itemText) return '';
          const prefix = tag === 'ol' ? `${index + 1}. ` : '- ';
          return `${prefix}${itemText}`;
        })
        .filter(Boolean);
      items.forEach((itemText) => {
        lineBlocks.push({ type: 'paragraph', text: itemText, breakBefore: false });
      });
      return;
    }

    if (tag === 'p' || tag === 'div') {
      const hasBlockChild = Array.from(node.children || []).some((child) => {
        const childTag = String(child.tagName || '').toLowerCase();
        return isBlockTag(childTag);
      });
      if (hasBlockChild) {
        Array.from(node.childNodes || []).forEach((child) => collectBlocks(child));
        return;
      }
      const lineText = renderInline(node).trim();
      if (lineText) {
        lineBlocks.push({
          type: 'paragraph',
          text: lineText,
          breakBefore: isBoldParagraph(node)
        });
        return;
      }
    }

    if (isContainerTag(tag)) {
      Array.from(node.childNodes || []).forEach((child) => collectBlocks(child));
      return;
    }

    Array.from(node.childNodes || []).forEach((child) => collectBlocks(child));
  };

  Array.from(body.childNodes || []).forEach((node) => collectBlocks(node));

  const slides = [[]];
  lineBlocks.forEach((block) => {
    let currentSlide = slides[slides.length - 1];
    if (block.breakBefore && currentSlide.length) {
      slides.push([]);
      currentSlide = slides[slides.length - 1];
    }
    currentSlide.push(block.text);
  });

  const extracted = slides
    .map((slide) => slide.join('\n').trim())
    .filter(Boolean)
    .join(SMART_PASTE_SLIDE_BREAK)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if ((!extracted || !/\n/.test(extracted)) && /<br\b/i.test(source)) {
    const withBreaks = source
      .replace(/<br\b[^>]*>/gi, '\n')
      .replace(/<\/(?:p|div|h[1-6]|li|ul|ol|section|article|blockquote)>/gi, '\n')
      .replace(/<[^>]+>/g, '');
    const decoded = new DOMParser().parseFromString(withBreaks, 'text/html').documentElement?.textContent || '';
    return String(decoded || '')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  return extracted;
}

function chooseSmartPasteSourceText(payload = {}) {
  const plainText = String(payload.text || '').replace(/\r\n?/g, '\n').trim();
  const hasHtml = String(payload.html || '').trim().length > 0;
  const richText = extractStructuredTextFromHtml(payload.html || '');
  if (hasHtml && richText) {
    return { text: richText, sourceType: 'html' };
  }
  return { text: plainText, sourceType: 'text' };
}

async function runSmartPastePluginHooks(clipboardPayload, initialText) {
  const plugins = Object.entries(window.RevelationPlugins || {})
    .map(([name, plugin]) => ({ name, plugin, priority: plugin?.priority ?? 999 }))
    .sort((a, b) => a.priority - b.priority);

  let text = String(initialText || '');
  let continueDefault = true;

  for (const { name, plugin } of plugins) {
    if (typeof plugin?.onBuilderSmartPaste !== 'function') continue;
    try {
      const result = await plugin.onBuilderSmartPaste({
        text,
        clipboardText: String(clipboardPayload?.text || ''),
        clipboardHtml: String(clipboardPayload?.html || ''),
        slug,
        mdFile,
        editorId: 'slide-editor'
      });
      if (typeof result === 'string') {
        text = result;
        continue;
      }
      if (!result || typeof result !== 'object') continue;
      if (typeof result.text === 'string') {
        text = result.text;
      }
      if (typeof result.continueDefault === 'boolean') {
        continueDefault = result.continueDefault;
      }
      if (!continueDefault) break;
    } catch (err) {
      console.warn(`[builder] Smart Paste hook failed for plugin '${name}':`, err);
    }
  }

  return { text, continueDefault };
}

async function runSmartPaste() {
  if (!editorEl) return;
  const clipboardPayload = await readClipboardPayload();
  console.log('[builder][smart-paste] Clipboard text/plain:', clipboardPayload.text || '');
  console.log('[builder][smart-paste] Clipboard text/html:', clipboardPayload.html || '');
  const source = chooseSmartPasteSourceText(clipboardPayload);
  if (!source.text.trim()) return;
  const { text, continueDefault } = await runSmartPastePluginHooks(clipboardPayload, source.text);
  const output = continueDefault
    ? (source.sourceType === 'html' ? applyHtmlSmartPasteTransform(text) : applyDefaultSmartPasteTransform(text))
    : String(text || '');
  if (!output.trim()) return;
  applyReplacementToEditor(
    editorEl,
    'body',
    editorEl.selectionStart ?? 0,
    editorEl.selectionEnd ?? 0,
    output
  );
  await reparseFromFile();
}

export {
  runSmartPaste
};
