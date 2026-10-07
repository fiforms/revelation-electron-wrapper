/**
 * builder.js — Rich Editor Entry Point
 *
 * Exported entry point consumed by client.js via dynamic import:
 *   const mod = await import('./builder.js');
 *   mod.getBuilderExtensions(ctx);
 *
 * This module is the orchestration layer.  It:
 *   - Imports all building blocks from the sibling modules
 *   - Constructs the toolbar and editor DOM
 *   - Manages activate/deactivate lifecycle
 *   - Owns the two-way sync loop between the editor DOM and the slide markdown
 *   - Wires all toolbar, keyboard, and document event handlers
 *
 * The single export `getBuilderExtensions(ctx)` is called once per builder
 * session.  It registers a "Rich" preview button and activates the editor.
 */

import { installBreakMarks } from './break-marks.js';
import { ensureStyles } from './builder-styles.js';
import { rbDebug, previewText, countImageMarkdownTokens, insertHardBreakAtCursor, logDomToMarkdown } from './builder-utils.js';
import { updateImageRuntimeContext, getEffectiveSlideBg, applyImagePlacement } from './builder-media.js';
import {
  RICH_LAYOUT_PRESETS,
  applyEditorLayoutState,
  getEditorLayoutState,
  renderLayoutPresetMenu,
  parseLayoutDirectives,
  mergeLayoutDirectivesWithBody
} from './builder-layout.js';
import { markdownToHtml } from './builder-markdown.js';
import { TEXT_COLORS, EDITOR_COLOR_VALUES, applyTextColor, currentTextColor } from './color-spans.js';
import { htmlToMarkdown } from './builder-serialize.js';
import {
  applyHeadingTag,
  applyBlockquoteTag,
  applyInlineCite,
  getSelectionListItem,
  fixBareChecklistItems,
  handleEditorTabIndent,
  toggleChecklistAtSelection,
  insertTwoColumnBlock
} from './builder-format.js';
import {
  getSelectionTableCell,
  insertTable,
  addTableRowAfter,
  addTableColumnAfter,
  deleteTableRow,
  deleteTableColumn,
  deleteTable,
  alignTableColumn,
  navigateTableCell
} from './builder-table.js';

// Prevents double-init if getBuilderExtensions is somehow called twice.
let richBuilderInitialized = false;

/**
 * updateTextareaMarkdown — Push serialized markdown into the slide textarea.
 *
 * Pushes serialized markdown into the hidden textarea that the builder host
 * monitors for changes.  Guards against spurious events by skipping the update
 * when the value has not actually changed.
 */
function updateTextareaMarkdown(markdown) {
  const editorEl = document.getElementById('slide-editor');
  if (!editorEl) return;
  if (editorEl.value === markdown) return;
  editorEl.value = markdown;
  editorEl.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * getCurrentSlideBody — Read the raw markdown body of the focused slide.
 *
 * Reads the raw markdown body of the currently focused slide from the host
 * document model.  Returns an empty string when the slide cannot be resolved.
 */
function getCurrentSlideBody(host) {
  const doc = host.getDocument();
  const selection = host.getSelection();
  return String(doc?.stacks?.[selection.h]?.[selection.v]?.body || '');
}

/**
 * updateToolbarState — Refresh toolbar button active/inactive states.
 *
 * Refreshes all toolbar button active/inactive states to match the current
 * editor selection.  Called after every input and cursor move.  When the
 * editor does not contain the focused element all buttons are reset to
 * inactive.
 */
function updateToolbarState(editorEl, toolbarEl) {
  const blocks = ['h1', 'h2', 'h3', 'h4', 'h5'];
  const activeTag = String(document.queryCommandValue('formatBlock') || '').replace(/[<>]/g, '').toLowerCase();
  const headingSelect = toolbarEl.querySelector('[data-role="heading-level"]');
  if (headingSelect) headingSelect.value = blocks.includes(activeTag) ? activeTag : 'paragraph';

  // Detect inline <cite> by walking up from the selection anchor node.
  const isCite = (() => {
    const sel = window.getSelection();
    let n = sel?.anchorNode;
    if (n && n.nodeType === Node.TEXT_NODE) n = n.parentElement;
    return n instanceof Element && editorEl.contains(n) && !!n.closest('cite');
  })();

  // Browsers report italic=true inside <cite> because <cite> renders italic.
  // Suppress that so only the Verse button lights up, not the I button.
  const isItalic = !isCite && document.queryCommandState('italic');
  const isUnderline = document.queryCommandState('underline');
  const isBold = document.queryCommandState('bold');
  const isUl = document.queryCommandState('insertUnorderedList');
  const isOl = document.queryCommandState('insertOrderedList');
  const activeChecklist = getSelectionListItem()?.dataset?.checklist === 'true';
  const isBlockquote = activeTag === 'blockquote';

  const italicBtn = toolbarEl.querySelector('[data-role="italic"]');
  const underlineBtn = toolbarEl.querySelector('[data-role="underline"]');
  const boldBtn = toolbarEl.querySelector('[data-role="bold"]');
  const verseBtn = toolbarEl.querySelector('[data-role="verse"]');
  const ulBtn = toolbarEl.querySelector('[data-role="ul"]');
  const olBtn = toolbarEl.querySelector('[data-role="ol"]');
  const checklistBtn = toolbarEl.querySelector('[data-role="checklist"]');
  const blockquoteBtn = toolbarEl.querySelector('[data-role="blockquote"]');
  const listToggleBtn = toolbarEl.querySelector('[data-role="list-toggle"]');

  if (italicBtn) italicBtn.dataset.active = String(!!isItalic);
  if (underlineBtn) underlineBtn.dataset.active = String(!!isUnderline);
  if (boldBtn) boldBtn.dataset.active = String(!!isBold);
  if (verseBtn) verseBtn.dataset.active = String(!!isCite);
  if (ulBtn) ulBtn.dataset.active = String(!!isUl);
  if (olBtn) olBtn.dataset.active = String(!!isOl);
  if (checklistBtn) checklistBtn.dataset.active = String(activeChecklist);
  if (blockquoteBtn) blockquoteBtn.dataset.active = String(!!isBlockquote);
  if (listToggleBtn) listToggleBtn.dataset.active = String(!!(isUl || isOl || activeChecklist || isBlockquote));
  const colorBtn = toolbarEl.querySelector('[data-role="color-toggle"]');
  const activeColor = currentTextColor(editorEl);
  if (colorBtn) colorBtn.style.color = activeColor ? EDITOR_COLOR_VALUES[activeColor] : '';

  if (!editorEl.contains(document.activeElement)) {
    [italicBtn, underlineBtn, boldBtn, verseBtn, ulBtn, olBtn, checklistBtn, blockquoteBtn, listToggleBtn].forEach((btn) => {
      if (btn) btn.dataset.active = 'false';
    });
    if (headingSelect) headingSelect.value = 'paragraph';
    if (colorBtn) colorBtn.style.color = '';
  }
}

/**
 * getBuilderExtensions — Main Rich Editor Initialiser
 *
 * Called once by client.js after the builder page loads.  Builds the toolbar
 * and editor stage, appends them to the preview panel, registers a "Rich"
 * toggle button in the preview header. The builder opens on the slide preview;
 * double-clicking the preview switches to the editor, and a one-time hint
 * overlay says so the first time the pointer enters the preview.
 *
 * Internal functions `activate`, `deactivate`, `syncFromCurrentSlide`, and
 * `syncToMarkdown` form the core lifecycle:
 *   activate         — shows editor, hides preview iframe, loads current slide
 *   deactivate       — hides editor, restores iframe, triggers Reveal re-layout
 *   syncFromCurrentSlide — markdown → HTML (on slide selection change)
 *   syncToMarkdown   — HTML → markdown (on every editor input, via rAF)
 */
export function getBuilderExtensions(ctx = {}) {
  const host = ctx.host;
  if (!host) return [];
  if (richBuilderInitialized) return [];
  richBuilderInitialized = true;

  const PREVIEW_VIEW_GROUP = 'core-preview-view';
  const PREVIEW_SLIDE_BUTTON_ID = 'core-preview-slide';
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
    <div class="richbuilder-toolbar-group richbuilder-layout-group">
      <span class="richbuilder-layout-label" style="display: none;">Layout</span>
      <button type="button" class="richbuilder-btn richbuilder-layout-trigger" data-role="layout-toggle" aria-expanded="false">Standard ▾</button>
      <div class="richbuilder-layout-menu" data-role="layout-menu" hidden></div>
    </div>
    <div class="richbuilder-toolbar-group">
      <span class="richbuilder-heading-label" style="display: none;">Heading</span>
      <select class="richbuilder-heading-select" data-role="heading-level" title="Heading level">
        <option value="paragraph">P</option>
        <option value="h1">H1</option>
        <option value="h2">H2</option>
        <option value="h3">H3</option>
        <option value="h4">H4</option>
        <option value="h5">H5</option>
      </select>
    </div>
    <div class="richbuilder-toolbar-group">
      <button type="button" class="richbuilder-btn" data-role="bold"><b>B</b></button>
      <button type="button" class="richbuilder-btn" data-role="italic"><i>I</i></button>
      <button type="button" class="richbuilder-btn" data-role="underline"><u>U</u></button>
      <button type="button" class="richbuilder-btn" data-role="verse" title="Verse style"><u><i>V</i></u></button>
      <button type="button" class="richbuilder-btn" data-role="link" title="Insert or edit link">🔗</button>
    </div>
    <div class="richbuilder-toolbar-group richbuilder-color-group">
      <button type="button" class="richbuilder-btn" data-role="color-toggle" aria-expanded="false" title="Text color">A ▾</button>
      <div class="richbuilder-color-menu" data-role="color-menu" hidden>
        ${TEXT_COLORS.map((name) => `<button type="button" class="richbuilder-btn richbuilder-color-choice" data-role="color-choice" data-color="${name}"><span class="richbuilder-color-swatch" style="background:${EDITOR_COLOR_VALUES[name]}"></span>${name[0].toUpperCase()}${name.slice(1)}</button>`).join('')}
        <button type="button" class="richbuilder-btn richbuilder-color-choice" data-role="color-choice" data-color="">No color</button>
      </div>
    </div>
    <div class="richbuilder-toolbar-group richbuilder-list-group">
      <button type="button" class="richbuilder-btn" data-role="list-toggle" aria-expanded="false">More ▾</button>
      <div class="richbuilder-list-menu" data-role="list-menu" hidden>
        <button type="button" class="richbuilder-btn" data-role="ul">UL</button>
        <button type="button" class="richbuilder-btn" data-role="ol">OL</button>
        <button type="button" class="richbuilder-btn" data-role="checklist">Task</button>
        <button type="button" class="richbuilder-btn" data-role="blockquote">Quote</button>
        <button type="button" class="richbuilder-btn" data-role="twocol" title="Insert 2-column layout">2-Col</button>
      </div>
    </div>
    <div class="richbuilder-toolbar-group richbuilder-table-group">
      <button type="button" class="richbuilder-btn" data-role="table-toggle" aria-expanded="false">Table ▾</button>
      <div class="richbuilder-table-menu" data-role="table-menu" hidden>
        <button type="button" class="richbuilder-btn" data-role="table-insert">Insert Table</button>
        <button type="button" class="richbuilder-btn" data-role="table-add-row">Add Row</button>
        <button type="button" class="richbuilder-btn" data-role="table-add-col">Add Column</button>
        <button type="button" class="richbuilder-btn" data-role="table-del-row">Delete Row</button>
        <button type="button" class="richbuilder-btn" data-role="table-del-col">Delete Column</button>
        <button type="button" class="richbuilder-btn" data-role="table-delete">Delete Table</button>
        <button type="button" class="richbuilder-btn" data-role="table-align-left">Align Left</button>
        <button type="button" class="richbuilder-btn" data-role="table-align-center">Align Center</button>
        <button type="button" class="richbuilder-btn" data-role="table-align-right">Align Right</button>
      </div>
    </div>
    <div class="richbuilder-toolbar-group richbuilder-markdown-tools" data-role="markdown-tools-slot"></div>
    <div class="richbuilder-toolbar-group richbuilder-host-slot" data-role="host-slot"></div>
  `;

  // Host the builder's slide Properties control at the end of the toolbar, so
  // it shows only while rich editing. Without this plugin it stays in the
  // Live Preview header.
  const slidePropertiesControl = document.querySelector('.builder-preview .slide-properties');
  if (slidePropertiesControl) {
    toolbar.querySelector('[data-role="host-slot"]').appendChild(slidePropertiesControl);
  }

  const stage = document.createElement('div');
  stage.className = 'richbuilder-stage';

  const editor = document.createElement('div');
  editor.className = 'richbuilder-editor';
  editor.contentEditable = 'true';
  editor.spellcheck = true;

  stage.appendChild(editor);
  installBreakMarks(stage, editor);
  root.appendChild(toolbar);
  root.appendChild(stage);

  // Link modal — appended to document.body so it overlays everything.
  // Hidden by default; opened by openLinkModal() when the 🔗 button is clicked
  // or when the user clicks an existing link token in the editor.
  const linkBackdrop = document.createElement('div');
  linkBackdrop.className = 'richbuilder-link-backdrop';
  linkBackdrop.hidden = true;
  linkBackdrop.innerHTML = `
    <div class="richbuilder-link-dialog">
      <h3>Insert Link</h3>
      <div class="richbuilder-link-field">
        <label>Link text</label>
        <input type="text" class="richbuilder-link-text" placeholder="Visible text">
      </div>
      <div class="richbuilder-link-field">
        <label>URL</label>
        <input type="text" class="richbuilder-link-url" placeholder="https://">
      </div>
      <div class="richbuilder-link-actions">
        <button type="button" class="richbuilder-btn" data-role="link-cancel">Cancel</button>
        <button type="button" class="richbuilder-btn" data-role="link-apply">Apply</button>
      </div>
    </div>
  `;
  document.body.appendChild(linkBackdrop);
  const linkTextInput = linkBackdrop.querySelector('.richbuilder-link-text');
  const linkUrlInput = linkBackdrop.querySelector('.richbuilder-link-url');

  // Macro modal — similar to link modal, for editing in-slide macros
  const macroBackdrop = document.createElement('div');
  macroBackdrop.className = 'richbuilder-macro-backdrop';
  macroBackdrop.hidden = true;
  macroBackdrop.innerHTML = `
    <div class="richbuilder-macro-dialog">
      <h3>Edit Macro</h3>
      <textarea class="richbuilder-macro-textarea" rows="6" spellcheck="false"></textarea>
      <div class="richbuilder-link-actions">
        <button type="button" class="richbuilder-btn richbuilder-btn-danger" data-role="macro-delete">Delete</button>
        <button type="button" class="richbuilder-btn" data-role="macro-cancel">Cancel</button>
        <button type="button" class="richbuilder-btn" data-role="macro-apply">Apply</button>
      </div>
    </div>
  `;
  document.body.appendChild(macroBackdrop);
  const macroTextarea = macroBackdrop.querySelector('.richbuilder-macro-textarea');

  // Fragment modal — for editing ++/== markers
  const fragmentBackdrop = document.createElement('div');
  fragmentBackdrop.className = 'richbuilder-fragment-backdrop';
  fragmentBackdrop.hidden = true;
  fragmentBackdrop.innerHTML = `
    <div class="richbuilder-fragment-dialog">
      <h3>Edit Fragment</h3>
      <textarea class="richbuilder-fragment-textarea" rows="4" spellcheck="false" placeholder="++&#10;++:reveal&#10;==:highlight"></textarea>
      <p class="richbuilder-fragment-help">Use ++ or == with optional :modifiers</p>
      <div class="richbuilder-link-actions">
        <button type="button" class="richbuilder-btn richbuilder-btn-danger" data-role="fragment-delete">Delete</button>
        <button type="button" class="richbuilder-btn" data-role="fragment-cancel">Cancel</button>
        <button type="button" class="richbuilder-btn" data-role="fragment-apply">Apply</button>
      </div>
    </div>
  `;
  document.body.appendChild(fragmentBackdrop);
  const fragmentTextarea = fragmentBackdrop.querySelector('.richbuilder-fragment-textarea');

  // HTML block modal — for editing raw HTML code
  const htmlBackdrop = document.createElement('div');
  htmlBackdrop.className = 'richbuilder-html-backdrop';
  htmlBackdrop.hidden = true;
  htmlBackdrop.innerHTML = `
    <div class="richbuilder-html-dialog">
      <h3>Edit HTML</h3>
      <textarea class="richbuilder-html-textarea" rows="8" spellcheck="false" placeholder="<div>&#10;  content here&#10;</div>"></textarea>
      <div class="richbuilder-link-actions">
        <button type="button" class="richbuilder-btn richbuilder-btn-danger" data-role="html-delete">Delete</button>
        <button type="button" class="richbuilder-btn" data-role="html-cancel">Cancel</button>
        <button type="button" class="richbuilder-btn" data-role="html-apply">Apply</button>
      </div>
    </div>
  `;
  document.body.appendChild(htmlBackdrop);
  const htmlTextarea = htmlBackdrop.querySelector('.richbuilder-html-textarea');

  if (previewPanel) {
    previewPanel.appendChild(root);
  }

  // One-time "Double-click to Edit" hint over the preview iframe. It shows on
  // the first hover and goes away when the pointer leaves or after a few seconds.
  const editHint = document.createElement('div');
  editHint.className = 'richbuilder-edit-hint';
  editHint.hidden = true;
  editHint.innerHTML = '<span class="richbuilder-edit-hint-label">Double-click to Edit</span>';
  if (previewPanel) previewPanel.appendChild(editHint);
  let editHintShown = false;
  let editHintTimer = 0;

  // Borrow the Slide Markdown header menus (tools, format, media, audio,
  // image) while rich editing, and the table picker the tools menu opens.
  // Their handlers edit the markdown textarea; they go back to the markdown
  // panel when the rich editor closes.
  const markdownToolsSlot = toolbar.querySelector('[data-role="markdown-tools-slot"]');
  const borrowedMarkdownTools = [
    [document.getElementById('slide-tools-btn')?.closest('.builder-dropdown'), markdownToolsSlot],
    [document.getElementById('add-slide-format-btn')?.closest('.builder-dropdown'), markdownToolsSlot],
    [document.getElementById('add-slide-media-btn')?.closest('.builder-dropdown'), markdownToolsSlot],
    [document.getElementById('add-slide-audio-btn')?.closest('.builder-dropdown'), markdownToolsSlot],
    [document.getElementById('add-slide-image-btn'), markdownToolsSlot],
    [document.getElementById('table-picker'), root]
  ]
    .filter(([el]) => el)
    .map(([el, target]) => ({ el, target, placeholder: document.createComment('richbuilder-borrowed') }));
  if (!borrowedMarkdownTools.some((item) => item.target === markdownToolsSlot)) {
    markdownToolsSlot.remove();
  }

  function borrowMarkdownTools() {
    borrowedMarkdownTools.forEach((item) => {
      if (item.el.parentNode === item.target) return;
      item.el.before(item.placeholder);
      item.target.appendChild(item.el);
    });
  }

  function returnMarkdownTools() {
    borrowedMarkdownTools.forEach((item) => {
      if (!item.placeholder.parentNode) return;
      item.placeholder.replaceWith(item.el);
    });
  }

  let isActive = false;
  let syncing = false;
  let rafToken = 0;
  let lastSyncedMarkdown = '';
  const layoutControls = {
    group: toolbar.querySelector('.richbuilder-layout-group'),
    button: toolbar.querySelector('[data-role="layout-toggle"]'),
    menu: toolbar.querySelector('[data-role="layout-menu"]')
  };
  const listControls = {
    group: toolbar.querySelector('.richbuilder-list-group'),
    button: toolbar.querySelector('[data-role="list-toggle"]'),
    menu: toolbar.querySelector('[data-role="list-menu"]')
  };
  const colorControls = {
    group: toolbar.querySelector('.richbuilder-color-group'),
    button: toolbar.querySelector('[data-role="color-toggle"]'),
    menu: toolbar.querySelector('[data-role="color-menu"]')
  };
  const tableControls = {
    group: toolbar.querySelector('.richbuilder-table-group'),
    button: toolbar.querySelector('[data-role="table-toggle"]'),
    menu: toolbar.querySelector('[data-role="table-menu"]')
  };

  renderLayoutPresetMenu(layoutControls.menu);
  applyEditorLayoutState(editor, { mode: 'standard', vertical: 'center', shift: 'none' }, layoutControls);

  const syncToMarkdown = () => {
    if (!isActive || syncing) return;
    rbDebug('syncToMarkdown:start', {
      editorHtml: previewText(editor.innerHTML, 520)
    });
    const markdownBody = htmlToMarkdown(editor);
    const layoutState = getEditorLayoutState(editor);
    const markdown = mergeLayoutDirectivesWithBody(layoutState, markdownBody);
    logDomToMarkdown('editor → markdown', editor, markdown);
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
    const parsed = parseLayoutDirectives(markdown);
    rbDebug('syncFromCurrentSlide:input', {
      imageTokenCount: countImageMarkdownTokens(markdown),
      markdown: previewText(markdown, 420)
    });
    if (markdown === lastSyncedMarkdown) return;
    syncing = true;
    applyEditorLayoutState(editor, parsed.layout, layoutControls);
    editor.innerHTML = markdownToHtml(parsed.body);
    logDomToMarkdown('slide load (markdown → editor)', editor, markdown);
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

    const bgThumb = getEffectiveSlideBg(host);
    if (bgThumb) {
      editor.style.backgroundImage = `linear-gradient(rgba(0,0,0,0.7),rgba(0,0,0,0.7)),url('${bgThumb}')`;
      editor.style.backgroundSize = 'cover';
      editor.style.backgroundPosition = 'center';
    } else {
      editor.style.backgroundImage = '';
      editor.style.backgroundSize = '';
      editor.style.backgroundPosition = '';
    }
  };

  // Ctrl+Enter: break the slide at the caret, like the markdown editor does.
  // Everything before the caret (plus the layout directives) stays; the rest
  // moves to a new slide below, which then loads into the editor.
  function splitSlideAtCaret() {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;
    const caret = selection.getRangeAt(0);
    if (!editor.contains(caret.endContainer)) return;

    const halfToMarkdown = (range) => {
      const holder = document.createElement('div');
      holder.appendChild(range.cloneContents());
      return htmlToMarkdown(holder);
    };
    const beforeRange = document.createRange();
    beforeRange.setStart(editor, 0);
    beforeRange.setEnd(caret.endContainer, caret.endOffset);
    const afterRange = document.createRange();
    afterRange.setStart(caret.endContainer, caret.endOffset);
    afterRange.setEnd(editor, editor.childNodes.length);

    const before = mergeLayoutDirectivesWithBody(getEditorLayoutState(editor), halfToMarkdown(beforeRange));
    const after = halfToMarkdown(afterRange);

    // The split writes both halves itself, so drop any pending sync, and
    // make sure the new slide loads even if its body matches the last sync.
    if (rafToken) cancelAnimationFrame(rafToken);
    rafToken = 0;
    lastSyncedMarkdown = null;
    host.transact('Split slide', (tx) => {
      tx.splitSlide(host.getSelection(), { before, after });
    });

    const start = document.createRange();
    start.setStart(editor, 0);
    start.collapse(true);
    selection.removeAllRanges();
    selection.addRange(start);
    editor.focus();
  }

  function restoreCorePreviewButtonState() {
    if (typeof host.setPreviewButtonGroupActive !== 'function') return;
    host.setPreviewButtonGroupActive(PREVIEW_VIEW_GROUP, PREVIEW_SLIDE_BUTTON_ID);
  }

  function activate() {
    if (isActive) return;
    isActive = true;
    borrowMarkdownTools();
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
    returnMarkdownTools();
    closeCardMenu();
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
    if (layoutControls.menu) layoutControls.menu.hidden = true;
    if (layoutControls.button) layoutControls.button.setAttribute('aria-expanded', 'false');
    if (listControls.menu) listControls.menu.hidden = true;
    if (listControls.button) listControls.button.setAttribute('aria-expanded', 'false');
    if (tableControls.menu) tableControls.menu.hidden = true;
    if (tableControls.button) tableControls.button.setAttribute('aria-expanded', 'false');
    if (colorControls.menu) colorControls.menu.hidden = true;
    if (colorControls.button) colorControls.button.setAttribute('aria-expanded', 'false');
    closeLinkModal();
  }

  function setLayoutMenuOpen(shouldOpen) {
    if (!layoutControls.menu || !layoutControls.button) return;
    const open = !!shouldOpen;
    layoutControls.menu.hidden = !open;
    layoutControls.button.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function setListMenuOpen(shouldOpen) {
    if (!listControls.menu || !listControls.button) return;
    const open = !!shouldOpen;
    listControls.menu.hidden = !open;
    listControls.button.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function setColorMenuOpen(shouldOpen) {
    if (!colorControls.menu || !colorControls.button) return;
    const open = !!shouldOpen;
    colorControls.menu.hidden = !open;
    colorControls.button.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function setTableMenuOpen(shouldOpen) {
    if (!tableControls.menu || !tableControls.button) return;
    const open = !!shouldOpen;
    tableControls.menu.hidden = !open;
    tableControls.button.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  // ── Link modal state ───────────────────────────────────────────────────────
  // `pendingLinkSpan` holds the existing link-token span being edited, or null
  // when inserting a new link.  `savedRange` captures the selection before the
  // modal opens so the new span can be inserted at the right position.
  let pendingLinkSpan = null;
  let savedRange = null;
  let pendingMacroEl = null;
  let pendingFragmentEl = null;
  let pendingHtmlEl = null;

  /**
   * openLinkModal — Show the link dialog, pre-filled for insert or edit.
   *
   * If the cursor sits inside an existing `.richbuilder-link-token` span the
   * dialog opens in edit mode (text + href pre-filled).  Otherwise it opens in
   * insert mode, pre-filling link text from the current text selection.
   */
  // openLinkModal accepts an optional existing span directly (passed by the
  // editor click handler) because contenteditable="false" spans never hold the
  // caret, so sel.anchorNode is never inside them.
  function openLinkModal(existingSpanOverride = null) {
    const sel = window.getSelection();
    let existingSpan = existingSpanOverride;
    if (!existingSpan && sel && sel.anchorNode) {
      let node = sel.anchorNode;
      if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
      if (node instanceof Element && node.classList.contains('richbuilder-link-token')) {
        existingSpan = node;
      }
    }
    if (existingSpan) {
      pendingLinkSpan = existingSpan;
      savedRange = null;
      linkTextInput.value = existingSpan.textContent || '';
      linkUrlInput.value = existingSpan.getAttribute('data-href') || '';
    } else {
      pendingLinkSpan = null;
      savedRange = sel?.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
      linkTextInput.value = sel?.toString() || '';
      linkUrlInput.value = '';
    }
    linkBackdrop.hidden = false;
    // Focus URL field when inserting (text already pre-filled), text field when editing
    (existingSpan ? linkTextInput : linkUrlInput).focus();
  }

  /**
   * applyLink — Commit the modal values as a link span in the editor.
   *
   * Captures pendingLinkSpan and savedRange into locals BEFORE calling
   * closeLinkModal, which resets those shared variables.
   */
  function applyLink() {
    const href = linkUrlInput.value.trim();
    const linkText = linkTextInput.value.trim();
    // Capture state before closeLinkModal nulls it out
    const spanToEdit = pendingLinkSpan;
    const rangeToInsert = savedRange;
    closeLinkModal();
    if (!href) return;
    editor.focus();
    if (spanToEdit) {
      spanToEdit.textContent = linkText || href;
      spanToEdit.dataset.href = href;
    } else {
      const span = document.createElement('span');
      span.className = 'richbuilder-link-token';
      span.contentEditable = 'false';
      span.dataset.href = href;
      span.textContent = linkText || href;
      if (rangeToInsert) {
        rangeToInsert.deleteContents();
        rangeToInsert.insertNode(span);
        const range = document.createRange();
        range.setStartAfter(span);
        range.collapse(true);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
      } else {
        editor.appendChild(span);
      }
    }
    scheduleSync();
  }

  /**
   * closeLinkModal — Hide the link dialog without making any changes.
   */
  function closeLinkModal() {
    linkBackdrop.hidden = true;
    pendingLinkSpan = null;
    savedRange = null;
    editor.focus();
  }

  function openMacroModal(el) {
    const raw = el.getAttribute('data-macro-content') || '';
    macroTextarea.value = raw ? decodeURIComponent(raw) : '';
    pendingMacroEl = el;
    macroBackdrop.hidden = false;
    macroTextarea.focus();
    macroTextarea.select();
  }

  function applyMacro() {
    if (!pendingMacroEl) return;
    const newContent = macroTextarea.value.trim();
    if (!newContent) {
      closeMacroModal();
      return;
    }
    // Extract tag label from the new content
    const tagMatch = newContent.match(/^(:[A-Za-z0-9_-]+:)/);
    const tagLabel = tagMatch ? tagMatch[1] : ':macro:';
    // Update the element
    pendingMacroEl.setAttribute('data-macro-content', encodeURIComponent(newContent));
    pendingMacroEl.textContent = tagLabel;
    closeMacroModal();
    scheduleSync();
  }

  function closeMacroModal() {
    macroBackdrop.hidden = true;
    pendingMacroEl = null;
    editor.focus();
  }

  function openFragmentModal(el) {
    const raw = el.getAttribute('data-fragment-content') || '';
    fragmentTextarea.value = raw ? decodeURIComponent(raw) : '';
    pendingFragmentEl = el;
    fragmentBackdrop.hidden = false;
    fragmentTextarea.focus();
    fragmentTextarea.select();
  }

  function applyFragment() {
    if (!pendingFragmentEl) return;
    const newContent = fragmentTextarea.value.trim();
    if (!newContent) {
      closeFragmentModal();
      return;
    }
    // Extract marker symbol (++ or ==) from the new content
    const symbolMatch = newContent.match(/^\+\+|==/);
    const symbol = symbolMatch ? symbolMatch[0] : '++';
    // Update the element
    pendingFragmentEl.setAttribute('data-fragment-content', encodeURIComponent(newContent));
    pendingFragmentEl.textContent = symbol;
    closeFragmentModal();
    scheduleSync();
  }

  function closeFragmentModal() {
    fragmentBackdrop.hidden = true;
    pendingFragmentEl = null;
    editor.focus();
  }

  function openHtmlModal(el) {
    const raw = el.getAttribute('data-html-content') || '';
    htmlTextarea.value = raw ? decodeURIComponent(raw) : '';
    pendingHtmlEl = el;
    htmlBackdrop.hidden = false;
    htmlTextarea.focus();
    htmlTextarea.select();
  }

  function applyHtml() {
    if (!pendingHtmlEl) return;
    const newContent = htmlTextarea.value.trim();
    if (!newContent) {
      closeHtmlModal();
      return;
    }
    // Extract tag label from the new content (first tag name or comment)
    const tagMatch = newContent.match(/^<!--/) ? newContent.match(/^<!--.*?-->/) : newContent.match(/^<([A-Za-z][A-Za-z0-9]*)/);
    let tagLabel = '<html>';
    if (tagMatch) {
      if (newContent.startsWith('<!--')) {
        tagLabel = tagMatch[0];
        if (tagLabel.length > 60) tagLabel = tagLabel.substring(0, 57) + '...';
      } else {
        tagLabel = `<${tagMatch[1]}>`;
      }
    }
    // Update the element
    pendingHtmlEl.setAttribute('data-html-content', encodeURIComponent(newContent));
    pendingHtmlEl.textContent = tagLabel;
    closeHtmlModal();
    scheduleSync();
  }

  function closeHtmlModal() {
    htmlBackdrop.hidden = true;
    pendingHtmlEl = null;
    editor.focus();
  }

  // --- Card deletion + context menu ---
  // Cards are the contenteditable=false tokens: macros (:credits:, :animate:,
  // …), HTML blocks, fragment markers, images and links.
  const CARD_SELECTOR = '.richbuilder-macro-token, .richbuilder-html-token, .richbuilder-fragment-token, .richbuilder-image-token, .richbuilder-link-token';

  function deleteEditorToken(el) {
    if (!el || !editor.contains(el)) return;
    const parent = el.parentElement;
    el.remove();
    // An image line sits in its own <div>; drop the wrapper once it is empty.
    if (parent && parent !== editor && parent.tagName === 'DIV' && !parent.textContent.trim() && !parent.querySelector('img, video, [contenteditable="false"]')) {
      parent.remove();
    }
    if (!editor.children.length) editor.innerHTML = '<div><br></div>';
    editor.focus();
    scheduleSync();
  }

  function unwrapLinkToken(el) {
    if (!el || !editor.contains(el)) return;
    el.replaceWith(document.createTextNode(el.textContent || ''));
    editor.focus();
    scheduleSync();
  }

  const cardMenu = document.createElement('div');
  cardMenu.className = 'richbuilder-card-menu';
  cardMenu.hidden = true;
  document.body.appendChild(cardMenu);

  function closeCardMenu() {
    cardMenu.hidden = true;
    cardMenu.innerHTML = '';
  }

  function openCardMenu(card, x, y) {
    const isLink = card.classList.contains('richbuilder-link-token');
    const edit = card.classList.contains('richbuilder-macro-token') ? openMacroModal
      : card.classList.contains('richbuilder-html-token') ? openHtmlModal
        : card.classList.contains('richbuilder-fragment-token') ? openFragmentModal
          : isLink ? openLinkModal
            : null;
    const items = [];
    if (edit) items.push([isLink ? 'Edit Link…' : 'Edit…', () => edit(card)]);
    if (isLink) items.push(['Remove Link', () => unwrapLinkToken(card)]);
    items.push(['Delete', () => deleteEditorToken(card), true]);
    cardMenu.innerHTML = '';
    items.forEach(([label, action, danger]) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `richbuilder-card-menu-item${danger ? ' is-danger' : ''}`;
      item.textContent = label;
      item.addEventListener('click', (event) => {
        event.stopPropagation();
        closeCardMenu();
        action();
      });
      cardMenu.appendChild(item);
    });
    cardMenu.hidden = false;
    // Keep the menu on screen.
    const { width, height } = cardMenu.getBoundingClientRect();
    cardMenu.style.left = `${Math.min(x, window.innerWidth - width - 8)}px`;
    cardMenu.style.top = `${Math.min(y, window.innerHeight - height - 8)}px`;
  }

  // Right-click on plain text: clipboard actions plus the plugin slide tools
  // (the same getSlideTools items as the Slide Markdown Tools menu). Without
  // any plugin tools the browser's own menu is left alone.
  function openTextMenu(x, y, tools) {
    const items = [];
    const hasSelection = !window.getSelection()?.isCollapsed;
    if (hasSelection) {
      items.push(['Cut', () => document.execCommand('cut')]);
      items.push(['Copy', () => document.execCommand('copy')]);
    }
    items.push(['Paste', async () => {
      const text = await navigator.clipboard.readText().catch(() => '');
      if (text) document.execCommand('insertText', false, text);
    }]);
    tools.forEach((tool) => {
      items.push([tool.label, () => {
        placeMarkdownCaretFromEditor();
        return window.RevelationSlideTools.run(tool);
      }, false, items.length === (hasSelection ? 3 : 1)]);
    });
    cardMenu.innerHTML = '';
    items.forEach(([label, action, danger, separated]) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `richbuilder-card-menu-item${danger ? ' is-danger' : ''}${separated ? ' has-separator' : ''}`;
      item.textContent = label;
      // Keep the editor's selection while the menu is used.
      item.addEventListener('mousedown', (event) => event.preventDefault());
      item.addEventListener('click', (event) => {
        event.stopPropagation();
        closeCardMenu();
        Promise.resolve(action()).catch((err) => console.error('[richbuilder] Context menu action failed:', err));
      });
      cardMenu.appendChild(item);
    });
    cardMenu.hidden = false;
    const { width, height } = cardMenu.getBoundingClientRect();
    cardMenu.style.left = `${Math.min(x, window.innerWidth - width - 8)}px`;
    cardMenu.style.top = `${Math.min(y, window.innerHeight - height - 8)}px`;
  }

  editor.addEventListener('contextmenu', (event) => {
    if (!isActive || !(event.target instanceof Element)) return;
    const card = event.target.closest(CARD_SELECTOR);
    if (!card || !editor.contains(card)) {
      const tools = window.RevelationSlideTools?.list() || [];
      if (!tools.length) return;
      event.preventDefault();
      openTextMenu(event.clientX, event.clientY, tools);
      return;
    }
    // Leave the placement picker's own controls alone.
    if (event.target.closest('.richbuilder-image-placement')) return;
    event.preventDefault();
    openCardMenu(card, event.clientX, event.clientY);
  });
  document.addEventListener('pointerdown', (event) => {
    if (!cardMenu.hidden && !cardMenu.contains(event.target)) closeCardMenu();
  }, true);
  // Escape closes the card menu, or else returns from the editor to the
  // preview. It runs before the builder's window handler, so claiming it here
  // keeps the Slide Sorter shortcut from firing too.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (!cardMenu.hidden) {
      closeCardMenu();
      event.preventDefault();
      return;
    }
    // Modal inputs handle their own Escape; don't also leave the editor.
    const modalBackdrops = [linkBackdrop, macroBackdrop, fragmentBackdrop, htmlBackdrop];
    if (modalBackdrops.some((backdrop) => backdrop.contains(event.target))) return;
    // Only while the editor is on screen (Visual or Split view).
    if (!isActive || !root.getClientRects().length) return;
    event.preventDefault();
    deactivate();
  });
  window.addEventListener('blur', closeCardMenu);
  editor.addEventListener('scroll', closeCardMenu, true);

  // Modal button clicks and keyboard shortcuts
  linkBackdrop.addEventListener('click', (event) => {
    if (event.target === linkBackdrop) { closeLinkModal(); return; }
    const btn = event.target.closest('button[data-role]');
    if (btn?.dataset.role === 'link-apply') applyLink();
    if (btn?.dataset.role === 'link-cancel') closeLinkModal();
  });
  linkUrlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') applyLink();
    if (e.key === 'Escape') closeLinkModal();
  });
  linkTextInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') applyLink();
    if (e.key === 'Escape') closeLinkModal();
  });

  macroBackdrop.addEventListener('click', (event) => {
    if (event.target === macroBackdrop) { closeMacroModal(); return; }
    const btn = event.target.closest('button[data-role]');
    if (btn?.dataset.role === 'macro-apply') applyMacro();
    if (btn?.dataset.role === 'macro-cancel') closeMacroModal();
    if (btn?.dataset.role === 'macro-delete') {
      const el = pendingMacroEl;
      closeMacroModal();
      deleteEditorToken(el);
    }
  });
  macroTextarea.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMacroModal();
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) applyMacro();
  });

  fragmentBackdrop.addEventListener('click', (event) => {
    if (event.target === fragmentBackdrop) { closeFragmentModal(); return; }
    const btn = event.target.closest('button[data-role]');
    if (btn?.dataset.role === 'fragment-apply') applyFragment();
    if (btn?.dataset.role === 'fragment-cancel') closeFragmentModal();
    if (btn?.dataset.role === 'fragment-delete') {
      const el = pendingFragmentEl;
      closeFragmentModal();
      deleteEditorToken(el);
    }
  });
  fragmentTextarea.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeFragmentModal();
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) applyFragment();
  });

  htmlBackdrop.addEventListener('click', (event) => {
    if (event.target === htmlBackdrop) { closeHtmlModal(); return; }
    const btn = event.target.closest('button[data-role]');
    if (btn?.dataset.role === 'html-apply') applyHtml();
    if (btn?.dataset.role === 'html-cancel') closeHtmlModal();
    if (btn?.dataset.role === 'html-delete') {
      const el = pendingHtmlEl;
      closeHtmlModal();
      deleteEditorToken(el);
    }
  });
  htmlTextarea.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeHtmlModal();
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) applyHtml();
  });

  toolbar.addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-role]');
    if (!btn || !isActive) return;

    const role = btn.dataset.role;

    if (role === 'layout-toggle') {
      event.preventDefault();
      setListMenuOpen(false);
      setTableMenuOpen(false);
      setLayoutMenuOpen(layoutControls.menu.hidden);
      return;
    }
    if (role === 'color-toggle') {
      event.preventDefault();
      setLayoutMenuOpen(false);
      setListMenuOpen(false);
      setTableMenuOpen(false);
      setColorMenuOpen(colorControls.menu.hidden);
      return;
    }
    if (role === 'color-choice') {
      event.preventDefault();
      setColorMenuOpen(false);
      editor.focus();
      if (applyTextColor(editor, btn.dataset.color || null)) scheduleSync();
      return;
    }
    if (role === 'list-toggle') {
      event.preventDefault();
      setLayoutMenuOpen(false);
      setColorMenuOpen(false);
      setTableMenuOpen(false);
      setListMenuOpen(listControls.menu.hidden);
      return;
    }
    if (role === 'table-toggle') {
      event.preventDefault();
      setLayoutMenuOpen(false);
      setListMenuOpen(false);
      setTableMenuOpen(tableControls.menu.hidden);
      return;
    }
    if (role === 'layout-preset') {
      event.preventDefault();
      const presetId = String(btn.dataset.layoutPreset || '').trim().toLowerCase();
      const preset = RICH_LAYOUT_PRESETS.find((candidate) => candidate.id === presetId);
      if (preset) {
        applyEditorLayoutState(editor, preset.layout, layoutControls);
        setLayoutMenuOpen(false);
        editor.focus();
        scheduleSync();
      }
      return;
    }

    editor.focus();

    if (role === 'link') { openLinkModal(); return; }
    if (role === 'bold') document.execCommand('bold', false);
    if (role === 'italic') document.execCommand('italic', false);
    if (role === 'underline') document.execCommand('underline', false);
    if (role === 'verse') {
      applyInlineCite(editor);
    }
    if (role === 'ul') document.execCommand('insertUnorderedList', false);
    if (role === 'ol') document.execCommand('insertOrderedList', false);
    if (role === 'checklist') toggleChecklistAtSelection(editor);
    if (role === 'blockquote') applyBlockquoteTag();
    if (role === 'ul' || role === 'ol' || role === 'checklist' || role === 'blockquote' || role === 'twocol') {
      setListMenuOpen(false);
    }
    if (role === 'twocol') {
      insertTwoColumnBlock(editor);
      scheduleSync();
      return;
    }
    if (role === 'table-insert') {
      setTableMenuOpen(false);
      insertTable(editor);
      scheduleSync();
      return;
    }
    if (role === 'table-add-row') {
      setTableMenuOpen(false);
      editor.focus();
      if (addTableRowAfter()) scheduleSync();
      return;
    }
    if (role === 'table-add-col') {
      setTableMenuOpen(false);
      editor.focus();
      if (addTableColumnAfter()) scheduleSync();
      return;
    }
    if (role === 'table-del-row') {
      setTableMenuOpen(false);
      editor.focus();
      if (deleteTableRow()) scheduleSync();
      return;
    }
    if (role === 'table-del-col') {
      setTableMenuOpen(false);
      editor.focus();
      if (deleteTableColumn()) scheduleSync();
      return;
    }
    if (role === 'table-delete') {
      setTableMenuOpen(false);
      editor.focus();
      if (deleteTable()) scheduleSync();
      return;
    }
    if (role === 'table-align-left' || role === 'table-align-center' || role === 'table-align-right') {
      setTableMenuOpen(false);
      editor.focus();
      const align = role === 'table-align-left' ? 'left' : role === 'table-align-center' ? 'center' : 'right';
      if (alignTableColumn(align)) scheduleSync();
      return;
    }

    scheduleSync();
  });
  toolbar.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement) || !isActive) return;
    if (target.dataset.role !== 'heading-level') return;
    editor.focus();
    const value = String(target.value || '').toLowerCase();
    if (value === 'h1') applyHeadingTag(1);
    else if (value === 'h2') applyHeadingTag(2);
    else if (value === 'h3') applyHeadingTag(3);
    else if (value === 'h4') applyHeadingTag(4);
    else if (value === 'h5') applyHeadingTag(5);
    else applyHeadingTag(0);
    scheduleSync();
  });
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Node)) return;
    const insideLayoutMenu = !!layoutControls.group?.contains(target);
    const insideListMenu = !!listControls.group?.contains(target);
    if (!insideLayoutMenu && layoutControls.menu && !layoutControls.menu.hidden) {
      setLayoutMenuOpen(false);
    }
    if (!insideListMenu && listControls.menu && !listControls.menu.hidden) {
      setListMenuOpen(false);
    }
    const insideColorMenu = !!colorControls.group?.contains(target);
    if (!insideColorMenu && colorControls.menu && !colorControls.menu.hidden) {
      setColorMenuOpen(false);
    }
    const insideTableMenu = !!tableControls.group?.contains(target);
    if (!insideTableMenu && tableControls.menu && !tableControls.menu.hidden) {
      setTableMenuOpen(false);
    }
  });

  // Image placement picker (Default / Fill / Fit / Background) on image lines.
  const handleImagePlacementEvent = (event) => {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest('.richbuilder-image-placement')) return false;
    const tokenEl = target.closest('.richbuilder-image-token');
    if (tokenEl && applyImagePlacement(tokenEl)) scheduleSync();
    return true;
  };

  // The borrowed markdown tools insert at the textarea caret. Before they run,
  // flush pending edits and put that caret at the end of the block holding the
  // rich editor's caret, so inserts land after it instead of at the slide end.
  let lastCaretBlock = null;
  document.addEventListener('selectionchange', () => {
    if (!isActive) return;
    let node = window.getSelection()?.anchorNode || null;
    if (!node || !editor.contains(node) || node === editor) return;
    while (node.parentNode && node.parentNode !== editor) node = node.parentNode;
    lastCaretBlock = node.parentNode === editor ? node : null;
  });

  function placeMarkdownCaretFromEditor() {
    if (!isActive) return;
    if (rafToken) {
      cancelAnimationFrame(rafToken);
      rafToken = 0;
      syncToMarkdown();
    }
    const textarea = document.getElementById('slide-editor');
    if (!textarea) return;
    const full = textarea.value;
    let offset = full.length;
    if (lastCaretBlock && lastCaretBlock.parentNode === editor) {
      const trim = (text) => String(text || '').replace(/^\n+/, '').replace(/\n+$/, '');
      const body = trim(htmlToMarkdown(editor));
      const partialRoot = document.createElement('div');
      const blocks = Array.from(editor.children);
      blocks.slice(0, blocks.indexOf(lastCaretBlock) + 1).forEach((block) => {
        partialRoot.appendChild(block.cloneNode(true));
      });
      const partial = trim(htmlToMarkdown(partialRoot));
      if (full.endsWith(body) && body.startsWith(partial)) {
        offset = full.length - body.length + partial.length;
      }
    }
    textarea.setSelectionRange(offset, offset);
  }
  markdownToolsSlot.addEventListener('pointerdown', placeMarkdownCaretFromEditor, true);
  markdownToolsSlot.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') placeMarkdownCaretFromEditor();
  }, true);

  editor.addEventListener('input', (event) => {
    if (handleImagePlacementEvent(event)) return;
    scheduleSync();
  });
  editor.addEventListener('keydown', (event) => {
    // Keys typed in the placement picker belong to it, not the editor.
    if (event.target instanceof Element && event.target.closest('.richbuilder-image-placement')) {
      if (event.key === 'Enter') {
        event.preventDefault();
        event.target.blur();
      }
      return;
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      splitSlideAtCaret();
      return;
    }
    if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault();
      insertHardBreakAtCursor();
      scheduleSync();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      const li = getSelectionListItem();
      if (li && li.querySelector(':scope > .richbuilder-check-item')) {
        setTimeout(() => {
          const fixed = fixBareChecklistItems(editor);
          if (fixed.length) {
            const textSpan = fixed[fixed.length - 1].querySelector('.richbuilder-check-text');
            if (textSpan) {
              const range = document.createRange();
              range.setStart(textSpan, 0);
              range.collapse(true);
              const sel = window.getSelection();
              sel.removeAllRanges();
              sel.addRange(range);
            }
          }
          scheduleSync();
        }, 0);
      }
    }
    if (event.key === 'Tab') {
      const tableCell = getSelectionTableCell();
      if (tableCell) {
        event.preventDefault();
        navigateTableCell(tableCell, event.shiftKey);
        scheduleSync();
        return;
      }
    }
    if (handleEditorTabIndent(event)) {
      scheduleSync();
    }
  });
  editor.addEventListener('change', (event) => {
    if (handleImagePlacementEvent(event)) return;
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
  // Clicking an existing link token opens the edit modal.
  editor.addEventListener('click', (event) => {
    if (!isActive) return;
    const target = event.target;
    if (target instanceof Element && target.classList.contains('richbuilder-link-token')) {
      openLinkModal(target);
    }
    if (target instanceof Element && target.classList.contains('richbuilder-macro-token')) {
      openMacroModal(target);
    }
    if (target instanceof Element && target.classList.contains('richbuilder-fragment-token')) {
      openFragmentModal(target);
    }
    if (target instanceof Element && target.classList.contains('richbuilder-html-token')) {
      openHtmlModal(target);
    }
  });
  editor.addEventListener('mouseup', () => updateToolbarState(editor, toolbar));

  host.on('selection:changed', () => {
    if (!isActive) return;
    syncFromCurrentSlide();
  });
  // Undo history is about to snapshot the document: sync pending edits now.
  host.on('history:flush', () => {
    if (!isActive || !rafToken) return;
    cancelAnimationFrame(rafToken);
    rafToken = 0;
    syncToMarkdown();
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

  function canEnterFromPreview() {
    return !isActive && !document.body.classList.contains('is-column-md-mode');
  }

  function enterFromPreview() {
    if (!canEnterFromPreview()) return;
    hideEditHint();
    host.setPreviewButtonGroupActive(PREVIEW_VIEW_GROUP, RICH_BUTTON_ID);
    activate();
  }

  function hideEditHint() {
    if (editHintTimer) window.clearTimeout(editHintTimer);
    editHintTimer = 0;
    editHint.hidden = true;
  }

  function showEditHint() {
    if (editHintShown || !previewFrame || !canEnterFromPreview()) return;
    editHintShown = true;
    // Cover just the iframe, below the panel header.
    editHint.style.top = `${previewFrame.offsetTop}px`;
    editHint.style.height = `${previewFrame.offsetHeight}px`;
    editHint.hidden = false;
    editHintTimer = window.setTimeout(hideEditHint, 5000);
  }

  previewFrame?.addEventListener('mouseenter', showEditHint);
  editHint.addEventListener('mouseleave', hideEditHint);
  editHint.addEventListener('dblclick', enterFromPreview);
  host.on('preview:dblclick', enterFromPreview);

  host.registerPreviewButton({
    id: RICH_BUTTON_ID,
    location: 'preview-header',
    title: 'Rich Editor',
    tooltip: 'Rich Editor',
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

  return [];
}
