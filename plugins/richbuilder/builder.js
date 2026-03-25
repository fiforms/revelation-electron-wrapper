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

import { ensureStyles } from './builder-styles.js';
import { rbDebug, previewText, countImageMarkdownTokens, insertHardBreakAtCursor } from './builder-utils.js';
import { updateImageRuntimeContext } from './builder-media.js';
import {
  RICH_LAYOUT_PRESETS,
  applyEditorLayoutState,
  getEditorLayoutState,
  renderLayoutPresetMenu,
  parseLayoutDirectives,
  mergeLayoutDirectivesWithBody,
  extractHiddenDirectiveLines,
  restoreHiddenDirectiveLines
} from './builder-layout.js';
import { markdownToHtml } from './builder-markdown.js';
import { htmlToMarkdown } from './builder-serialize.js';
import {
  applyHeadingTag,
  applyBlockquoteTag,
  applyCiteTag,
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

  const isItalic = document.queryCommandState('italic');
  const isUnderline = document.queryCommandState('underline');
  const isBold = document.queryCommandState('bold');
  const isUl = document.queryCommandState('insertUnorderedList');
  const isOl = document.queryCommandState('insertOrderedList');
  const activeChecklist = getSelectionListItem()?.dataset?.checklist === 'true';
  const isCite = activeTag === 'cite';
  const isBlockquote = activeTag === 'blockquote';

  const italicBtn = toolbarEl.querySelector('[data-role="italic"]');
  const underlineBtn = toolbarEl.querySelector('[data-role="underline"]');
  const boldBtn = toolbarEl.querySelector('[data-role="bold"]');
  const ulBtn = toolbarEl.querySelector('[data-role="ul"]');
  const olBtn = toolbarEl.querySelector('[data-role="ol"]');
  const checklistBtn = toolbarEl.querySelector('[data-role="checklist"]');
  const citeBtn = toolbarEl.querySelector('[data-role="cite"]');
  const blockquoteBtn = toolbarEl.querySelector('[data-role="blockquote"]');
  const listToggleBtn = toolbarEl.querySelector('[data-role="list-toggle"]');

  if (italicBtn) italicBtn.dataset.active = String(!!isItalic);
  if (underlineBtn) underlineBtn.dataset.active = String(!!isUnderline);
  if (boldBtn) boldBtn.dataset.active = String(!!isBold);
  if (ulBtn) ulBtn.dataset.active = String(!!isUl);
  if (olBtn) olBtn.dataset.active = String(!!isOl);
  if (checklistBtn) checklistBtn.dataset.active = String(activeChecklist);
  if (citeBtn) citeBtn.dataset.active = String(!!isCite);
  if (blockquoteBtn) blockquoteBtn.dataset.active = String(!!isBlockquote);
  if (listToggleBtn) listToggleBtn.dataset.active = String(!!(isUl || isOl || activeChecklist || isCite || isBlockquote));

  if (!editorEl.contains(document.activeElement)) {
    [italicBtn, underlineBtn, boldBtn, ulBtn, olBtn, checklistBtn, citeBtn, blockquoteBtn, listToggleBtn].forEach((btn) => {
      if (btn) btn.dataset.active = 'false';
    });
    if (headingSelect) headingSelect.value = 'paragraph';
  }
}

/**
 * getBuilderExtensions — Main Rich Editor Initialiser
 *
 * Called once by client.js after the builder page loads.  Builds the toolbar
 * and editor stage, appends them to the preview panel, registers a "Rich"
 * toggle button in the preview header, and immediately activates the editor.
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
      <button type="button" class="richbuilder-btn" data-role="link" title="Insert or edit link">🔗</button>
    </div>
    <div class="richbuilder-toolbar-group richbuilder-list-group">
      <button type="button" class="richbuilder-btn" data-role="list-toggle" aria-expanded="false">More ▾</button>
      <div class="richbuilder-list-menu" data-role="list-menu" hidden>
        <button type="button" class="richbuilder-btn" data-role="ul">UL</button>
        <button type="button" class="richbuilder-btn" data-role="ol">OL</button>
        <button type="button" class="richbuilder-btn" data-role="checklist">Task</button>
        <button type="button" class="richbuilder-btn" data-role="cite">Cite</button>
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

  if (previewPanel) {
    previewPanel.appendChild(root);
  }

  let isActive = false;
  let syncing = false;
  let rafToken = 0;
  let lastSyncedMarkdown = '';
  let hiddenDirectiveBuffer = [];
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
    const markdownWithHiddenDirectives = restoreHiddenDirectiveLines(markdownBody, hiddenDirectiveBuffer);
    const markdown = mergeLayoutDirectivesWithBody(layoutState, markdownWithHiddenDirectives);
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
    const directiveExtraction = extractHiddenDirectiveLines(parsed.body);
    rbDebug('syncFromCurrentSlide:input', {
      imageTokenCount: countImageMarkdownTokens(markdown),
      markdown: previewText(markdown, 420)
    });
    if (markdown === lastSyncedMarkdown) return;
    syncing = true;
    hiddenDirectiveBuffer = directiveExtraction.hiddenDirectives;
    applyEditorLayoutState(editor, parsed.layout, layoutControls);
    editor.innerHTML = markdownToHtml(directiveExtraction.visibleBody);
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
    if (layoutControls.menu) layoutControls.menu.hidden = true;
    if (layoutControls.button) layoutControls.button.setAttribute('aria-expanded', 'false');
    if (listControls.menu) listControls.menu.hidden = true;
    if (listControls.button) listControls.button.setAttribute('aria-expanded', 'false');
    if (tableControls.menu) tableControls.menu.hidden = true;
    if (tableControls.button) tableControls.button.setAttribute('aria-expanded', 'false');
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
    if (role === 'list-toggle') {
      event.preventDefault();
      setLayoutMenuOpen(false);
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
    if (role === 'ul') document.execCommand('insertUnorderedList', false);
    if (role === 'ol') document.execCommand('insertOrderedList', false);
    if (role === 'checklist') toggleChecklistAtSelection(editor);
    if (role === 'cite') {
      const applied = applyCiteTag(editor);
      if (!applied) return;
    }
    if (role === 'blockquote') applyBlockquoteTag();
    if (role === 'ul' || role === 'ol' || role === 'checklist' || role === 'cite' || role === 'blockquote' || role === 'twocol') {
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
    const insideTableMenu = !!tableControls.group?.contains(target);
    if (!insideTableMenu && tableControls.menu && !tableControls.menu.hidden) {
      setTableMenuOpen(false);
    }
  });

  editor.addEventListener('input', scheduleSync);
  editor.addEventListener('keydown', (event) => {
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
  });
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
