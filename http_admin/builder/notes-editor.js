/*
 * Rich notes editor for the Visual view's notes bar.
 *
 * Sections:
 * - DOM setup
 * - Markdown sync
 * - Formatting commands
 * - Link editing
 * - Setup
 *
 * The notes textarea stays the source of truth: the rich surface renders from
 * it and writes back through its input event, so state, dirty tracking and the
 * collapsed-bar preview all update the usual way. Markdown and Split views keep
 * the plain textarea.
 */
import { notesEditorEl, state } from './context.js';
import { markdownToNotesDom, notesDomToMarkdown, isSafeHref } from './notes-markdown.js';
import { TEXT_COLORS, EDITOR_COLOR_VALUES, applyTextColor, currentTextColor } from './color-spans.js';

let richEl = null;
let toolbarEl = null;
let linkEditEl = null;
let linkInputEl = null;
let colorPickEl = null;
let tocPickEl = null;
let lastSynced = null;
let savedRange = null;
let editingAnchor = null;

// --- DOM setup ---
// Session-only font size for the notes surface (not persisted).
const NOTES_FONT_MIN = 10;
const NOTES_FONT_MAX = 36;
const NOTES_FONT_DEFAULT = 14;
let notesFontSize = NOTES_FONT_DEFAULT;

function adjustNotesFont(delta) {
  notesFontSize = Math.min(NOTES_FONT_MAX, Math.max(NOTES_FONT_MIN, notesFontSize + delta));
  if (richEl) richEl.style.fontSize = `${notesFontSize}px`;
}

function buildFontControls() {
  const group = document.createElement('div');
  group.className = 'notes-font-controls';
  group.innerHTML = `
    <button type="button" class="notes-tool" data-font="down">−</button>
    <button type="button" class="notes-tool" data-font="up">+</button>
  `;
  group.querySelector('[data-font="down"]').title = tr('Smaller text');
  group.querySelector('[data-font="up"]').title = tr('Larger text');
  // Same as the toolbar: keep editor focus, and don't toggle panel collapse.
  group.addEventListener('mousedown', (event) => {
    if (event.target instanceof Element && event.target.closest('button')) event.preventDefault();
  });
  group.addEventListener('click', (event) => {
    event.stopPropagation();
    const button = event.target instanceof Element ? event.target.closest('button[data-font]') : null;
    if (button) adjustNotesFont(button.dataset.font === 'up' ? 2 : -2);
  });
  return group;
}

function buildToolbar() {
  const toolbar = document.createElement('div');
  toolbar.className = 'notes-toolbar';
  toolbar.innerHTML = `
    <button type="button" class="notes-tool" data-cmd="bold"><b>B</b></button>
    <button type="button" class="notes-tool" data-cmd="italic"><i>I</i></button>
    <button type="button" class="notes-tool" data-cmd="ul">• List</button>
    <button type="button" class="notes-tool" data-cmd="ol">1. List</button>
    <button type="button" class="notes-tool" data-cmd="link">🔗</button>
    <button type="button" class="notes-tool" data-cmd="toc">☰</button>
    <button type="button" class="notes-tool" data-cmd="color"><span class="notes-color-a">A</span> ▾</button>
    <span class="notes-toc-pick" role="menu" hidden>
      <button type="button" class="notes-toc-item" role="menuitem" data-toc="order"></button>
      <button type="button" class="notes-toc-item" role="menuitem" data-toc="alpha"></button>
    </span>
    <span class="notes-color-pick" hidden>
      ${TEXT_COLORS.map((name) => `<button type="button" class="notes-tool notes-color-swatch" data-color="${name}" style="--swatch:${EDITOR_COLOR_VALUES[name]}"></button>`).join('')}
      <button type="button" class="notes-tool" data-color="">✕</button>
    </span>
    <span class="notes-link-edit" hidden>
      <input type="text" class="notes-link-input" placeholder="https://" spellcheck="false">
      <button type="button" class="notes-tool" data-link-action="apply">OK</button>
      <button type="button" class="notes-tool" data-link-action="remove">Unlink</button>
    </span>
  `;
  const titles = {
    bold: `${tr('Bold')} (Ctrl+B)`,
    italic: `${tr('Italic')} (Ctrl+I)`,
    ul: tr('Bulleted list'),
    ol: tr('Numbered list'),
    link: `${tr('Link')} (Ctrl+K)`,
    color: tr('Text color'),
    toc: tr('Table of contents (from the first heading of each column)')
  };
  toolbar.querySelectorAll('[data-cmd]').forEach((button) => {
    button.title = titles[button.dataset.cmd] || '';
  });
  toolbar.querySelector('[data-toc="order"]').textContent = tr('Build Index (Slide Order)');
  toolbar.querySelector('[data-toc="alpha"]').textContent = tr('Build Index (Alphabetical)');
  toolbar.querySelector('[data-link-action="remove"]').textContent = tr('Unlink');
  toolbar.querySelectorAll('.notes-color-pick [data-color]').forEach((button) => {
    const name = button.dataset.color;
    button.title = name ? tr(name[0].toUpperCase() + name.slice(1)) : tr('No color');
  });
  return toolbar;
}

// --- Markdown sync ---
function renderFromMarkdown() {
  if (!richEl || !notesEditorEl) return;
  lastSynced = notesEditorEl.value;
  markdownToNotesDom(document, richEl, lastSynced);
}

function syncToMarkdown() {
  if (!richEl || !notesEditorEl) return;
  const markdown = notesDomToMarkdown(richEl);
  if (markdown === notesEditorEl.value) return;
  lastSynced = markdown;
  notesEditorEl.value = markdown;
  notesEditorEl.dispatchEvent(new Event('input', { bubbles: true }));
}

// Called when the slide changes or the Visual view is entered.
function refreshNotesRich() {
  if (!richEl || !notesEditorEl) return;
  // Same content while typing: keep the caret where it is.
  if (notesEditorEl.value === lastSynced && richEl.contains(document.activeElement)) return;
  renderFromMarkdown();
  closeLinkEdit(false);
}

// --- Table of contents ---
// Heading text as the viewer sees it, so the slug matches the id presentations.js assigns.
function plainHeadingText(text) {
  return text
    .replace(/\s+==\S*\s*$/, '')
    .replace(/\{[^}]*\}\s*$/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Same rule as the deck's ready handler in revelation/js/presentations.js.
function headingSlug(text) {
  return text.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');
}

// Consecutive heading lines at the top of a slide body: one logical line.
function slideHeadings(slide) {
  const found = [];
  for (const line of String(slide?.body || '').split(/\r?\n/)) {
    if (!line.trim() && !found.length) continue;
    const match = line.match(/^\s{0,3}#{1,6}\s+(.*)$/);
    if (!match) break;
    const text = plainHeadingText(match[1]);
    if (text) found.push(text);
  }
  return found;
}

function buildTableOfContents(alphabetical) {
  const slugCounts = new Map();
  state.stacks.forEach((stack) => stack.forEach((slide) => {
    String(slide?.body || '').split(/\r?\n/).forEach((line) => {
      const match = line.match(/^\s{0,3}#{1,6}\s+(.*)$/);
      const slug = match ? headingSlug(plainHeadingText(match[1])) : '';
      if (slug) slugCounts.set(slug, (slugCounts.get(slug) || 0) + 1);
    });
  }));
  const entries = [];
  state.stacks.forEach((stack, h) => {
    if (h === state.selected.h) return;
    const headings = slideHeadings(stack[0]);
    if (!headings.length) return;
    const slug = headingSlug(headings[0]);
    // Duplicate or empty anchors fall back to the column number (one-based hashes).
    const anchor = slug && slugCounts.get(slug) === 1 ? slug : String(h + 1);
    const label = headings.join(' ').replace(/[[\]]/g, '\\$&');
    entries.push({ label, line: `- [${label}](#${anchor})` });
  });
  if (alphabetical) entries.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base', numeric: true }));
  return entries.map((entry) => entry.line).join('\n');
}

function insertTableOfContents(alphabetical) {
  if (!notesEditorEl) return;
  const toc = buildTableOfContents(alphabetical);
  if (!toc) return;
  const current = notesEditorEl.value.replace(/\s+$/, '');
  notesEditorEl.value = current ? `${current}\n\n${toc}` : toc;
  notesEditorEl.dispatchEvent(new Event('input', { bubbles: true }));
  refreshNotesRich();
}

// --- Formatting commands ---
function selectionInEditor() {
  const selection = window.getSelection();
  return !!(selection && selection.rangeCount && richEl.contains(selection.anchorNode));
}

function runCommand(cmd) {
  richEl.focus();
  if (cmd === 'bold') document.execCommand('bold');
  if (cmd === 'italic') document.execCommand('italic');
  if (cmd === 'ul') document.execCommand('insertUnorderedList');
  if (cmd === 'ol') document.execCommand('insertOrderedList');
  syncToMarkdown();
  updateToolbarState();
}

function setColorPickOpen(open) {
  if (colorPickEl) colorPickEl.hidden = !open;
  if (open) setTocPickOpen(false);
}

function setTocPickOpen(open) {
  if (!tocPickEl) return;
  tocPickEl.hidden = !open;
  if (!open) return;
  if (colorPickEl) colorPickEl.hidden = true;
  // Fixed so the toolbar's own clipping can't cut the menu off.
  const rect = toolbarEl.querySelector('[data-cmd="toc"]').getBoundingClientRect();
  // Shift left as needed to keep the whole menu on screen.
  const maxLeft = document.documentElement.clientWidth - tocPickEl.offsetWidth - 8;
  tocPickEl.style.left = `${Math.round(Math.max(8, Math.min(rect.left, maxLeft)))}px`;
  tocPickEl.style.top = `${Math.round(rect.bottom + 2)}px`;
}

function applyColor(name) {
  richEl.focus();
  setColorPickOpen(false);
  if (applyTextColor(richEl, name)) syncToMarkdown();
  updateToolbarState();
}

function getAnchorAtSelection() {
  const selection = window.getSelection();
  let node = selection?.anchorNode;
  if (node && node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  const anchor = node instanceof Element ? node.closest('a') : null;
  return anchor && richEl.contains(anchor) ? anchor : null;
}

function updateToolbarState() {
  if (!toolbarEl) return;
  const inEditor = selectionInEditor();
  const states = {
    bold: inEditor && document.queryCommandState('bold'),
    italic: inEditor && document.queryCommandState('italic'),
    ul: inEditor && document.queryCommandState('insertUnorderedList'),
    ol: inEditor && document.queryCommandState('insertOrderedList'),
    link: inEditor && !!getAnchorAtSelection(),
    color: inEditor && !!currentTextColor(richEl)
  };
  toolbarEl.querySelectorAll('[data-cmd]').forEach((button) => {
    button.classList.toggle('is-active', !!states[button.dataset.cmd]);
  });
  const activeColor = inEditor ? currentTextColor(richEl) : null;
  const colorLetter = toolbarEl.querySelector('.notes-color-a');
  if (colorLetter) colorLetter.style.color = activeColor ? EDITOR_COLOR_VALUES[activeColor] : '';
}

// --- Link editing ---
function openLinkEdit() {
  const selection = window.getSelection();
  if (!selectionInEditor()) {
    richEl.focus();
  }
  savedRange = selection && selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
  editingAnchor = getAnchorAtSelection();
  linkEditEl.hidden = false;
  linkInputEl.classList.remove('is-invalid');
  linkInputEl.value = editingAnchor?.getAttribute('href') || '';
  linkEditEl.querySelector('[data-link-action="remove"]').hidden = !editingAnchor;
  linkInputEl.focus();
  linkInputEl.select();
}

function closeLinkEdit(restoreFocus = true) {
  if (!linkEditEl || linkEditEl.hidden) return;
  linkEditEl.hidden = true;
  editingAnchor = null;
  if (restoreFocus) restoreSelection();
  savedRange = null;
}

function restoreSelection() {
  richEl.focus();
  if (!savedRange) return;
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(savedRange);
}

function unwrapAnchor(anchor) {
  anchor.replaceWith(...anchor.childNodes);
}

function applyLink() {
  const href = linkInputEl.value.trim();
  if (href && !isSafeHref(href)) {
    linkInputEl.classList.add('is-invalid');
    linkInputEl.title = tr('Only http, https, mailto or relative links are allowed');
    return;
  }
  const anchor = editingAnchor;
  const range = savedRange;
  closeLinkEdit(true);
  if (anchor) {
    if (href) anchor.setAttribute('href', href);
    else unwrapAnchor(anchor);
  } else if (href && range) {
    if (range.collapsed) {
      const link = document.createElement('a');
      link.setAttribute('href', href);
      link.textContent = href;
      range.insertNode(link);
      const selection = window.getSelection();
      selection.removeAllRanges();
      const after = document.createRange();
      after.setStartAfter(link);
      selection.addRange(after);
    } else {
      document.execCommand('createLink', false, href);
    }
  }
  syncToMarkdown();
  updateToolbarState();
}

function removeLink() {
  const anchor = editingAnchor;
  closeLinkEdit(true);
  if (anchor) unwrapAnchor(anchor);
  syncToMarkdown();
  updateToolbarState();
}

// --- Setup ---
function handleEditorKeydown(event) {
  const hasCommand = event.ctrlKey || event.metaKey;
  if (event.key === 'Enter' && event.shiftKey) {
    // The builder's global Shift+Enter targets textareas; handle it here.
    event.preventDefault();
    event.stopPropagation();
    document.execCommand('insertLineBreak');
    syncToMarkdown();
    return;
  }
  if (hasCommand && !event.altKey && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    event.stopPropagation();
    openLinkEdit();
    return;
  }
  if (event.key === 'Tab' && getSelectionListItem()) {
    event.preventDefault();
    document.execCommand(event.shiftKey ? 'outdent' : 'indent');
    syncToMarkdown();
  }
}

function getSelectionListItem() {
  const selection = window.getSelection();
  let node = selection?.anchorNode;
  if (node && node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  const li = node instanceof Element ? node.closest('li') : null;
  return li && richEl.contains(li) ? li : null;
}

function setupNotesEditor() {
  if (!notesEditorEl) return;
  const panel = notesEditorEl.closest('.builder-notes');
  const header = panel?.querySelector('.panel-header');
  if (!panel || !header) return;

  richEl = document.createElement('div');
  richEl.id = 'notes-rich';
  richEl.className = 'notes-rich';
  richEl.contentEditable = 'true';
  richEl.spellcheck = true;
  richEl.setAttribute('role', 'textbox');
  richEl.setAttribute('aria-multiline', 'true');
  richEl.setAttribute('aria-label', tr('Notes'));
  richEl.dataset.placeholder = tr('Speaker notes…');
  notesEditorEl.after(richEl);

  toolbarEl = buildToolbar();
  header.insertBefore(toolbarEl, header.querySelector('.panel-toggle'));
  header.querySelector('.notes-peek')?.before(buildFontControls());
  linkEditEl = toolbarEl.querySelector('.notes-link-edit');
  linkInputEl = toolbarEl.querySelector('.notes-link-input');
  colorPickEl = toolbarEl.querySelector('.notes-color-pick');
  tocPickEl = toolbarEl.querySelector('.notes-toc-pick');

  // Keep the editor selection when clicking toolbar buttons.
  toolbarEl.addEventListener('mousedown', (event) => {
    if (event.target instanceof Element && event.target.closest('button')) event.preventDefault();
  });
  toolbarEl.addEventListener('click', (event) => {
    // The header toggles collapse on click; the toolbar is not part of that.
    event.stopPropagation();
    const button = event.target instanceof Element ? event.target.closest('button') : null;
    if (!button) return;
    if (button.dataset.cmd === 'color') {
      setColorPickOpen(colorPickEl.hidden);
    } else if (button.dataset.color !== undefined) {
      applyColor(button.dataset.color || null);
    } else if (button.dataset.cmd === 'link') {
      if (linkEditEl.hidden) openLinkEdit();
      else closeLinkEdit(true);
    } else if (button.dataset.cmd === 'toc') {
      setTocPickOpen(tocPickEl.hidden);
    } else if (button.dataset.toc) {
      setTocPickOpen(false);
      insertTableOfContents(button.dataset.toc === 'alpha');
    } else if (button.dataset.cmd) {
      runCommand(button.dataset.cmd);
    } else if (button.dataset.linkAction === 'apply') {
      applyLink();
    } else if (button.dataset.linkAction === 'remove') {
      removeLink();
    }
  });
  linkInputEl.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      applyLink();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeLinkEdit(true);
    }
  });
  linkInputEl.addEventListener('input', () => linkInputEl.classList.remove('is-invalid'));

  // Dismiss the contents menu on any outside click or Escape.
  document.addEventListener('mousedown', (event) => {
    if (tocPickEl && !tocPickEl.hidden && !(event.target instanceof Element && event.target.closest('.notes-toc-pick, [data-cmd="toc"]'))) setTocPickOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && tocPickEl && !tocPickEl.hidden) setTocPickOpen(false);
  });

  richEl.addEventListener('input', syncToMarkdown);
  richEl.addEventListener('keydown', handleEditorKeydown);
  richEl.addEventListener('keyup', updateToolbarState);
  richEl.addEventListener('mouseup', updateToolbarState);
  richEl.addEventListener('focus', updateToolbarState);
  // Paste as plain text so foreign markup (styles, images) never enters notes.
  richEl.addEventListener('paste', (event) => {
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain') || '';
    if (text) document.execCommand('insertText', false, text);
  });
  richEl.addEventListener('drop', (event) => event.preventDefault());
  // Links are for editing here, never navigation.
  richEl.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('a')) event.preventDefault();
  });

  renderFromMarkdown();
}

export { setupNotesEditor, refreshNotesRich };
