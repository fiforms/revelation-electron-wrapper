/**
 * builder-clipboard.js — Rich Editor Cut / Copy / Paste
 *
 * Callers: builder.js (editor copy/cut/paste events, toolbar Clipboard group,
 * right-click text menu).
 *
 * Copy/Cut write three flavours: text/plain (the selection as slide markdown),
 * text/html, and a private JSON type so a rich→rich paste restores the exact
 * markdown (cards, tokens, macros). The last copied markdown is also remembered
 * in memory, so the button Paste (which has no clipboardData) recognises it.
 *
 * Paste chooses a route (choosePasteRoute, pure and unit-tested):
 *   own      → our own markdown, inserted as-is
 *   slides   → slide-sorter payload, handed to window.RevelationSlideClipboard
 *   inline   → ≤ PASTE_SMART_LINE_THRESHOLD lines: HTML is filtered to markdown
 *              (window.RevelationSmartPaste.htmlToText), then inserted
 *   smart    → longer text: window.RevelationSmartPaste.run (which opens the
 *              Divide Slides dialog and inserts the resulting slides)
 *
 * Gotchas: Smart Paste writes through the markdown textarea, so the caret is
 * first mapped there (placeMarkdownCaretFromEditor) and the editor re-synced
 * afterwards.
 */

import { markdownToHtml, inlineMarkdownToHtml } from './builder-markdown.js';
import { htmlToMarkdown } from './builder-serialize.js';

export const PASTE_SMART_LINE_THRESHOLD = 8;
export const OWN_CLIPBOARD_TYPE = 'application/x-revelation-richtext';

/** Number of non-blank lines in a block of text. */
export function countContentLines(text) {
  return String(text || '').split(/\r?\n/).filter((line) => line.trim()).length;
}

/**
 * choosePasteRoute — Decide how a paste is handled.
 *
 * `htmlText` is the clipboard HTML already filtered to text/markdown ('' when
 * there is no HTML or it yields nothing); `text` is the plain-text flavour.
 * Returns 'empty' | 'own' | 'slides' | 'smart' | 'inline'.
 */
export function choosePasteRoute({ own = false, hasSlides = false, text = '', htmlText = '' } = {}) {
  if (own) return 'own';
  if (hasSlides) return 'slides';
  const source = String(htmlText || '').trim() ? htmlText : text;
  if (!String(source || '').trim()) return 'empty';
  return countContentLines(source) > PASTE_SMART_LINE_THRESHOLD ? 'smart' : 'inline';
}

/**
 * createClipboardController — Bind clipboard actions to one editor instance.
 *
 * Options: editor (contenteditable root), isActive(), scheduleSync(),
 * placeMarkdownCaret() (map the rich caret into the markdown textarea) and
 * resync() (reload the editor from the slide after Smart Paste).
 */
export function createClipboardController({ editor, isActive, scheduleSync, placeMarkdownCaret, resync }) {
  let lastOwnMarkdown = '';

  const selectionMarkdown = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount || !editor.contains(sel.anchorNode)) return null;
    const holder = document.createElement('div');
    holder.appendChild(sel.getRangeAt(0).cloneContents());
    return { markdown: htmlToMarkdown(holder).trim(), html: holder.innerHTML };
  };

  /** copy / cut event on the editor: write our three flavours. */
  function handleCopyEvent(event) {
    if (!isActive()) return;
    const selected = selectionMarkdown();
    if (!selected || !selected.markdown) return;
    event.preventDefault();
    lastOwnMarkdown = selected.markdown;
    event.clipboardData.setData('text/plain', selected.markdown);
    event.clipboardData.setData('text/html', selected.html);
    event.clipboardData.setData(OWN_CLIPBOARD_TYPE, JSON.stringify({ format: 'revelation-richtext', version: 1, markdown: selected.markdown }));
    if (event.type === 'cut') {
      document.execCommand('delete');
      scheduleSync();
    }
  }

  const insertMarkdown = (markdown) => {
    editor.focus();
    const lines = countContentLines(markdown);
    const html = lines <= 1 && !/^\s*(#{1,5}\s|[-*+]\s|\d+\.\s|>|\|)/.test(markdown)
      ? inlineMarkdownToHtml(String(markdown).trim())
      : markdownToHtml(markdown);
    document.execCommand('insertHTML', false, html);
    scheduleSync();
  };

  async function runSmartPaste(payload) {
    const smart = window.RevelationSmartPaste;
    if (!smart) return;
    placeMarkdownCaret();
    // Let the document-changed sync reload the editor once the slides land.
    editor.blur();
    try {
      await smart.run(payload);
    } finally {
      resync();
    }
  }

  /**
   * paste — Route a clipboard payload `{ text, html, ownMarkdown }`.
   * Without a payload the clipboard is read (toolbar / context menu Paste).
   */
  async function paste(payload) {
    if (!isActive()) return;
    const smart = window.RevelationSmartPaste;
    const clip = payload || (smart ? await smart.readClipboardPayload() : { text: '', html: '' });
    const text = String(clip.text || '');
    const html = String(clip.html || '');
    const ownMarkdown = clip.ownMarkdown || (lastOwnMarkdown && text.trim() === lastOwnMarkdown ? lastOwnMarkdown : '');
    const hasSlides = ownMarkdown ? false : !!(await window.RevelationSlideClipboard?.hasSlides().catch(() => false));
    const htmlText = html && smart ? smart.htmlToText(html) : '';

    const route = choosePasteRoute({ own: !!ownMarkdown, hasSlides, text, htmlText });
    if (route === 'own') insertMarkdown(ownMarkdown);
    else if (route === 'slides') await window.RevelationSlideClipboard.paste();
    else if (route === 'smart') await runSmartPaste({ text, html });
    else if (route === 'inline') insertMarkdown(String(htmlText || text).replace(/\r\n?/g, '\n').trim());
  }

  /** paste event on the editor. */
  function handlePasteEvent(event) {
    if (!isActive() || !event.clipboardData) return;
    event.preventDefault();
    const data = event.clipboardData;
    let ownMarkdown = '';
    try {
      ownMarkdown = String(JSON.parse(data.getData(OWN_CLIPBOARD_TYPE) || 'null')?.markdown || '');
    } catch (_) {
      ownMarkdown = '';
    }
    paste({ text: data.getData('text/plain'), html: data.getData('text/html'), ownMarkdown })
      .catch((err) => console.error('[richbuilder] Paste failed:', err));
  }

  /** Paste as plain text: no routing, no markdown conversion. */
  async function pastePlain() {
    const clip = await (window.RevelationSmartPaste?.readClipboardPayload() || Promise.resolve({ text: '' }));
    if (!clip.text) return;
    editor.focus();
    document.execCommand('insertText', false, clip.text);
    scheduleSync();
  }

  return {
    handleCopyEvent,
    handlePasteEvent,
    copy: () => { editor.focus(); document.execCommand('copy'); },
    cut: () => { editor.focus(); document.execCommand('cut'); },
    paste: () => paste(),
    pastePlain,
    smartPaste: () => runSmartPaste()
  };
}
