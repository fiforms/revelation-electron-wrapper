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
import { t, tf } from './translate.js';
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
import { markdownToHtml, parseEmbedLine, isValidEmbedUrl, macroCardLabel, getFragmentMarkerSymbol } from './builder-markdown.js';
import { TEXT_COLORS, EDITOR_COLOR_VALUES, applyTextColor, currentTextColor } from './color-spans.js';
import { htmlToMarkdown } from './builder-serialize.js';
import { createClipboardController } from './builder-clipboard.js';
import {
  applyHeadingTag,
  applyBlockTag,
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
  const blocks = { h1: 'h1', h2: 'h2', h3: 'h3', h4: 'h4', h5: 'h5', blockquote: 'quote', pre: 'code' };
  const activeTag = String(document.queryCommandValue('formatBlock') || '').replace(/[<>]/g, '').toLowerCase();
  const headingSelect = toolbarEl.querySelector('[data-role="heading-level"]');
  if (headingSelect) headingSelect.value = blocks[activeTag] || 'paragraph';

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

  const italicBtn = toolbarEl.querySelector('[data-role="italic"]');
  const underlineBtn = toolbarEl.querySelector('[data-role="underline"]');
  const boldBtn = toolbarEl.querySelector('[data-role="bold"]');
  const verseBtn = toolbarEl.querySelector('[data-role="verse"]');
  const ulBtn = toolbarEl.querySelector('[data-role="ul"]');
  const olBtn = toolbarEl.querySelector('[data-role="ol"]');
  const checklistBtn = toolbarEl.querySelector('[data-role="checklist"]');
  const listToggleBtn = toolbarEl.querySelector('[data-role="list-toggle"]');

  if (italicBtn) italicBtn.dataset.active = String(!!isItalic);
  if (underlineBtn) underlineBtn.dataset.active = String(!!isUnderline);
  if (boldBtn) boldBtn.dataset.active = String(!!isBold);
  if (verseBtn) verseBtn.dataset.active = String(!!isCite);
  if (ulBtn) ulBtn.dataset.active = String(!!isUl);
  if (olBtn) olBtn.dataset.active = String(!!isOl);
  if (checklistBtn) checklistBtn.dataset.active = String(activeChecklist);
  if (listToggleBtn) listToggleBtn.dataset.active = String(!!(isUl || isOl || activeChecklist));
  const colorBtn = toolbarEl.querySelector('[data-role="color-toggle"]');
  const activeColor = currentTextColor(editorEl);
  if (colorBtn) colorBtn.style.color = activeColor ? EDITOR_COLOR_VALUES[activeColor] : '';

  if (!editorEl.contains(document.activeElement)) {
    [italicBtn, underlineBtn, boldBtn, verseBtn, ulBtn, olBtn, checklistBtn, listToggleBtn].forEach((btn) => {
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
      <span class="richbuilder-layout-label" style="display: none;">${t('Layout')}</span>
      <button type="button" class="richbuilder-btn richbuilder-layout-trigger" data-role="layout-toggle" aria-expanded="false">${t('Standard')} ▾</button>
      <div class="richbuilder-layout-menu" data-role="layout-menu" hidden></div>
    </div>
    <div class="richbuilder-toolbar-group">
      <span class="richbuilder-heading-label" style="display: none;">${t('Heading')}</span>
      <select class="richbuilder-heading-select" data-role="heading-level" title="${t('Heading level')}">
        <option value="paragraph">P</option>
        <option value="h1">H1</option>
        <option value="h2">H2</option>
        <option value="h3">H3</option>
        <option value="h4">H4</option>
        <option value="h5">H5</option>
        <option value="quote">${t('Quote')}</option>
        <option value="code">${t('Code')}</option>
      </select>
    </div>
    <div class="richbuilder-toolbar-group richbuilder-clipboard-group">
      <button type="button" class="richbuilder-btn" data-role="clip-paste" title="${t('Paste (long text opens Smart Paste)')}">
        <svg class="richbuilder-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 11h6M9 15h6"/></g></svg>
      </button>
      <button type="button" class="richbuilder-btn" data-role="clip-toggle" aria-expanded="false" title="${t('Cut, copy and paste options')}">
        <svg class="richbuilder-icon" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2 4l4 4 4-4z" fill="currentColor"/></svg>
      </button>
      <div class="richbuilder-list-menu" data-role="clip-menu" hidden>
        <button type="button" class="richbuilder-btn" data-role="clip-cut">${t('Cut')}</button>
        <button type="button" class="richbuilder-btn" data-role="clip-copy">${t('Copy')}</button>
        <button type="button" class="richbuilder-btn" data-role="clip-paste">${t('Paste')}</button>
        <button type="button" class="richbuilder-btn" data-role="clip-paste-plain">${t('Paste as Plain Text')}</button>
        <button type="button" class="richbuilder-btn" data-role="clip-smart">${t('Smart Paste…')}</button>
      </div>
    </div>
    <div class="richbuilder-toolbar-group">
      <button type="button" class="richbuilder-btn" data-role="bold"><b>B</b></button>
      <button type="button" class="richbuilder-btn" data-role="italic"><i>I</i></button>
      <button type="button" class="richbuilder-btn" data-role="underline"><u>U</u></button>
      <button type="button" class="richbuilder-btn" data-role="verse" title="${t('Verse style')}"><u><i>V</i></u></button>
      <button type="button" class="richbuilder-btn" data-role="link" title="${t('Insert or edit link')}">🔗</button>
    </div>
    <div class="richbuilder-toolbar-group richbuilder-color-group">
      <button type="button" class="richbuilder-btn" data-role="color-toggle" aria-expanded="false" title="${t('Text color')}"><span class="richbuilder-color-dots" aria-hidden="true"><i style="background:${EDITOR_COLOR_VALUES.red}"></i><i style="background:${EDITOR_COLOR_VALUES.green}"></i><i style="background:${EDITOR_COLOR_VALUES.blue}"></i></span></button>
      <div class="richbuilder-color-menu" data-role="color-menu" hidden>
        ${TEXT_COLORS.map((name) => `<button type="button" class="richbuilder-btn richbuilder-color-choice" data-role="color-choice" data-color="${name}"><span class="richbuilder-color-swatch" style="background:${EDITOR_COLOR_VALUES[name]}"></span>${t(name[0].toUpperCase() + name.slice(1))}</button>`).join('')}
        <button type="button" class="richbuilder-btn richbuilder-color-choice" data-role="color-choice" data-color="">${t('No color')}</button>
      </div>
    </div>
    <div class="richbuilder-toolbar-group richbuilder-list-group">
      <button type="button" class="richbuilder-btn" data-role="list-toggle" aria-expanded="false" title="${t('Lists')}">
        <svg class="richbuilder-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><g fill="currentColor"><circle cx="4" cy="6" r="1.8"/><circle cx="4" cy="12" r="1.8"/><circle cx="4" cy="18" r="1.8"/></g><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6h12M9 12h12M9 18h12"/></g></svg>
      </button>
      <div class="richbuilder-list-menu" data-role="list-menu" hidden>
        <button type="button" class="richbuilder-btn" data-role="ul">${t('Bullet List')}</button>
        <button type="button" class="richbuilder-btn" data-role="ol">${t('Numbered List')}</button>
        <button type="button" class="richbuilder-btn" data-role="checklist">${t('Checklist')}</button>
      </div>
    </div>
    <div class="richbuilder-toolbar-group richbuilder-insert-group">
      <button type="button" class="richbuilder-btn" data-role="insert-toggle" aria-expanded="false" title="${t('Insert image, media, audio, embeds')}">
        <svg class="richbuilder-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M3 17l5-4 4 3 3-2 6 4"/></g></svg>
      </button>
      <div class="richbuilder-list-menu" data-role="insert-menu" hidden></div>
    </div>
    <div class="richbuilder-toolbar-group richbuilder-anim-group">
      <button type="button" class="richbuilder-btn" data-role="anim-toggle" aria-expanded="false" title="${t('Animation: fragments, slide animation, appearance effects')}">
        <svg class="richbuilder-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><g fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"><path d="M17 2.5l1.6 3.3 3.6.5-2.6 2.5.6 3.6-3.2-1.7-3.2 1.7.6-3.6-2.6-2.5 3.6-.5z"/></g><g stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"><path d="M11 13L3 21M9 8L3 14M16 15l-5 5"/></g></svg>
      </button>
      <div class="richbuilder-list-menu" data-role="anim-menu" hidden></div>
    </div>
    <div class="richbuilder-toolbar-group richbuilder-table-group">
      <button type="button" class="richbuilder-btn" data-role="table-toggle" aria-expanded="false" title="${t('Tables and columns')}"><svg class="richbuilder-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 12h18M12 3v18"/></g></svg></button>
      <div class="richbuilder-table-menu" data-role="table-menu" hidden>
        <button type="button" class="richbuilder-btn" data-role="twocol" title="${t('Insert 2-column layout')}">${t('2-Column Layout')}</button>
        <button type="button" class="richbuilder-btn" data-role="table-insert">${t('Insert Table')}</button>
        <button type="button" class="richbuilder-btn" data-role="table-add-row">${t('Add Row')}</button>
        <button type="button" class="richbuilder-btn" data-role="table-add-col">${t('Add Column')}</button>
        <button type="button" class="richbuilder-btn" data-role="table-del-row">${t('Delete Row')}</button>
        <button type="button" class="richbuilder-btn" data-role="table-del-col">${t('Delete Column')}</button>
        <button type="button" class="richbuilder-btn" data-role="table-delete">${t('Delete Table')}</button>
        <button type="button" class="richbuilder-btn" data-role="table-align-left">${t('Align Left')}</button>
        <button type="button" class="richbuilder-btn" data-role="table-align-center">${t('Align Center')}</button>
        <button type="button" class="richbuilder-btn" data-role="table-align-right">${t('Align Right')}</button>
      </div>
    </div>
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
      <h3>${t('Insert Link')}</h3>
      <div class="richbuilder-link-field">
        <label>${t('Link text')}</label>
        <input type="text" class="richbuilder-link-text" placeholder="${t('Visible text')}">
      </div>
      <div class="richbuilder-link-field">
        <label>${t('URL')}</label>
        <input type="text" class="richbuilder-link-url" placeholder="https://">
      </div>
      <div class="richbuilder-link-actions">
        <button type="button" class="richbuilder-btn" data-role="link-cancel">${t('Cancel')}</button>
        <button type="button" class="richbuilder-btn" data-role="link-apply">${t('Apply')}</button>
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
      <h3 class="richbuilder-macro-title">${t('Edit Macro')}</h3>
      <p class="richbuilder-macro-hint" hidden></p>
      <textarea class="richbuilder-macro-textarea" rows="6" spellcheck="false"></textarea>
      <div class="richbuilder-link-actions">
        <button type="button" class="richbuilder-btn richbuilder-btn-danger" data-role="macro-delete">${t('Delete')}</button>
        <button type="button" class="richbuilder-btn" data-role="macro-cancel">${t('Cancel')}</button>
        <button type="button" class="richbuilder-btn" data-role="macro-apply">${t('Apply')}</button>
      </div>
    </div>
  `;
  document.body.appendChild(macroBackdrop);
  const macroTextarea = macroBackdrop.querySelector('.richbuilder-macro-textarea');
  const macroTitle = macroBackdrop.querySelector('.richbuilder-macro-title');
  const macroHint = macroBackdrop.querySelector('.richbuilder-macro-hint');
  const macroDeleteBtn = macroBackdrop.querySelector('[data-role="macro-delete"]');

  // Fragment modal — for editing ++/== markers
  const fragmentBackdrop = document.createElement('div');
  fragmentBackdrop.className = 'richbuilder-fragment-backdrop';
  fragmentBackdrop.hidden = true;
  fragmentBackdrop.innerHTML = `
    <div class="richbuilder-fragment-dialog">
      <h3>${t('Edit Fragment')}</h3>
      <textarea class="richbuilder-fragment-textarea" rows="4" spellcheck="false" placeholder="++&#10;++:reveal&#10;==:highlight"></textarea>
      <p class="richbuilder-fragment-help">${t('Use ++ or == with optional :modifiers')}</p>
      <div class="richbuilder-link-actions">
        <button type="button" class="richbuilder-btn richbuilder-btn-danger" data-role="fragment-delete">${t('Delete')}</button>
        <button type="button" class="richbuilder-btn" data-role="fragment-cancel">${t('Cancel')}</button>
        <button type="button" class="richbuilder-btn" data-role="fragment-apply">${t('Apply')}</button>
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
      <h3>${t('Edit HTML')}</h3>
      <textarea class="richbuilder-html-textarea" rows="8" spellcheck="false" placeholder="<div>&#10;  content here&#10;</div>"></textarea>
      <div class="richbuilder-link-actions">
        <button type="button" class="richbuilder-btn richbuilder-btn-danger" data-role="html-delete">${t('Delete')}</button>
        <button type="button" class="richbuilder-btn" data-role="html-cancel">${t('Cancel')}</button>
        <button type="button" class="richbuilder-btn" data-role="html-apply">${t('Apply')}</button>
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
  editHint.innerHTML = '<span class="richbuilder-edit-hint-label"></span>';
  editHint.firstChild.textContent = t('Double-click to Edit');
  if (previewPanel) previewPanel.appendChild(editHint);
  let editHintShown = false;
  let editHintTimer = 0;

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
  const insertControls = {
    group: toolbar.querySelector('.richbuilder-insert-group'),
    button: toolbar.querySelector('[data-role="insert-toggle"]'),
    menu: toolbar.querySelector('[data-role="insert-menu"]')
  };
  const animControls = {
    group: toolbar.querySelector('.richbuilder-anim-group'),
    button: toolbar.querySelector('[data-role="anim-toggle"]'),
    menu: toolbar.querySelector('[data-role="anim-menu"]')
  };
  const clipControls = {
    group: toolbar.querySelector('.richbuilder-clipboard-group'),
    button: toolbar.querySelector('[data-role="clip-toggle"]'),
    menu: toolbar.querySelector('[data-role="clip-menu"]')
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

  function setInsertMenuOpen(shouldOpen) {
    if (!insertControls.menu || !insertControls.button) return;
    const open = !!shouldOpen;
    insertControls.menu.hidden = !open;
    insertControls.button.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) renderInsertMenu('root');
  }

  // Insert menu: Image / Background Media / Audio / embeds. Media and Audio
  // open as sub-lists built by the builder's own menu code
  // (window.RevelationInsert, http_admin/builder/media.js). Every action first
  // maps the rich caret into the markdown textarea and detaches the editor, so
  // the insert lands at the caret and the editor reloads from the slide.
  let insertActions = [];
  let insertRenderRequest = 0;
  // Set when an Insert action may complete later (file/media dialogs): until
  // then (or a minute or two), a builder document change reloads the editor
  // even if it has focus, so stale DOM can't overwrite the inserted line.
  let insertPending = 0;
  async function renderInsertMenu(view) {
    const api = window.RevelationInsert;
    const menu = insertControls.menu;
    if (!api) {
      menu.innerHTML = '<button type="button" class="richbuilder-btn" disabled></button>';
      menu.firstChild.textContent = t('Insert is unavailable');
      return;
    }
    const keepOpen = (fn) => ({ fn, keepOpen: true });
    const atCaret = (fn) => () => {
      placeMarkdownCaretFromEditor();
      editor.blur();
      insertPending = Date.now() + 120000;
      return fn();
    };
    const snippet = (text) => atCaret(() => api.insertSnippet(text));
    const requestId = ++insertRenderRequest;
    let rows;
    if (view === 'root') {
      rows = [
        { label: t('Image…'), action: atCaret(() => api.openImageDialog()) },
        { label: t('Background Media ›'), ...keepOpen(() => renderInsertMenu('media')) },
        { label: t('Audio ›'), ...keepOpen(() => renderInsertMenu('audio')) },
        // Always :fit, so the video fills the usable part of the slide.
        { label: t('YouTube…'), action: () => openEmbedInsertModal('youtube', 'fit') },
        { label: t('Website Embed…'), action: () => openEmbedInsertModal('web') },
        { label: t('Named Anchor'), action: snippet('<a id="slide-name"></a>') }
      ];
    } else {
      menu.innerHTML = '<button type="button" class="richbuilder-btn" disabled></button>';
      menu.firstChild.textContent = t('Loading…');
      const items = view === 'media' ? await api.getMediaItems() : api.getAudioItems();
      // A newer render, or closing the menu, supersedes this one.
      if (requestId !== insertRenderRequest || menu.hidden) return;
      rows = [
        { label: t('‹ Back'), ...keepOpen(() => renderInsertMenu('root')) },
        ...items.map((item) => ({
          label: t(item.label),
          disabled: item.disabled,
          heading: item.disabled && !item.onClick,
          action: atCaret(() => item.onClick())
        }))
      ];
    }
    insertActions = rows;
    menu.innerHTML = '';
    rows.forEach((row, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'richbuilder-btn';
      btn.dataset.role = 'insert-item';
      btn.dataset.index = String(index);
      btn.textContent = row.label;
      if (row.disabled) btn.disabled = true;
      if (row.heading) btn.classList.add('richbuilder-menu-heading');
      menu.appendChild(btn);
    });
  }

  // Animation menu: Fragment (++), Slide Animation (:animate:) and whatever
  // plugins contribute through getAnimationTools (appearance's dialog).
  // Insertion goes through the markdown textarea like the Insert menu does.
  let animActions = [];
  function setAnimMenuOpen(shouldOpen) {
    if (!animControls.menu || !animControls.button) return;
    const open = !!shouldOpen;
    animControls.menu.hidden = !open;
    animControls.button.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) renderAnimMenu();
  }

  function insertFragmentAtCaret() {
    const api = window.RevelationInsert;
    if (!api) return;
    placeMarkdownCaretFromEditor();
    editor.blur();
    insertPending = Date.now() + 120000;
    api.insertFragment();
  }

  // Slide Animation options: whether this slide continues the previous
  // animated sequence (`:animate:`) or starts a new one (`:animate:restart:`),
  // and whether to duplicate the slide so there is a second slide to morph into.
  // Resolves { restart, duplicate }, or null when cancelled.
  function askSlideAnimation() {
    return new Promise((resolve) => {
      host.openDialog({
        render({ root, close }) {
          const box = document.createElement('form');
          box.style.cssText = 'display:flex;flex-direction:column;gap:12px;max-width:440px;font:14px/1.45 sans-serif;';
          box.innerHTML = `
            <h3 style="margin:0;">${t('Slide Animation')}</h3>
            <p style="margin:0;opacity:.85;">${t('Slides that each have the animation macro morph into one another, in order.')}</p>
            <label style="display:flex;gap:8px;align-items:flex-start;">
              <input type="radio" name="seq" value="continue" checked style="margin-top:4px;">
              <span><strong>${t('Continue the previous sequence')}</strong><br><span style="opacity:.75;"><code>:animate:</code> ${t('— joins the previous sequence, if the prior slide is part of one')}</span></span>
            </label>
            <label style="display:flex;gap:8px;align-items:flex-start;">
              <input type="radio" name="seq" value="restart" style="margin-top:4px;">
              <span><strong>${t('Start a new sequence')}</strong><br><span style="opacity:.75;"><code>:animate:restart:</code> ${t('— this slide begins a fresh animation')}</span></span>
            </label>
            <label style="display:flex;gap:8px;align-items:center;">
              <input type="checkbox" name="dup" checked>
              <span>${t('Also duplicate this slide so I can edit the copy')}</span>
            </label>
            <div style="display:flex;justify-content:flex-end;gap:10px;">
              <button type="button" class="panel-button" data-act="cancel">${t('Cancel')}</button>
              <button type="submit" class="panel-button" style="background:#2563eb;border-color:#2563eb;color:#fff;">${t('Add Animation')}</button>
            </div>`;
          box.querySelector('[data-act="cancel"]').addEventListener('click', () => { resolve(null); close({ canceled: true }); });
          box.addEventListener('submit', (event) => {
            event.preventDefault();
            resolve({
              restart: box.querySelector('[name="seq"]:checked').value === 'restart',
              duplicate: box.querySelector('[name="dup"]').checked
            });
            close({ canceled: false });
          });
          root.appendChild(box);
        }
      }).then(() => resolve(null));
    });
  }

  async function insertSlideAnimation() {
    const api = window.RevelationInsert;
    if (!api) return;
    const choice = await askSlideAnimation();
    if (!choice) return;
    placeMarkdownCaretFromEditor(); // also flushes pending edits to the textarea
    editor.blur();
    insertPending = Date.now() + 120000;
    // The macro is a whole-slide setting, so it goes at the end of the slide.
    api.insertMacro(choice.restart ? ':animate:restart:' : ':animate:', { atEnd: true });
    if (choice.duplicate) {
      await api.duplicateSlide();
      // The copy is now the selected slide. Only the first slide of a new
      // sequence carries the restart; the copy continues it.
      if (choice.restart) api.insertMacro(':animate:', { atEnd: true });
    }
  }

  function renderAnimMenu() {
    const menu = animControls.menu;
    animActions = [
      { label: t('Slide Animation…'), action: insertSlideAnimation },
      { label: t('Fragment'), action: insertFragmentAtCaret },
      ...(window.RevelationSlideTools?.listAnimation?.() || []).map((tool) => ({
        label: t(tool.label),
        action: () => {
          placeMarkdownCaretFromEditor();
          insertPending = Date.now() + 120000;
          return window.RevelationSlideTools.run(tool);
        }
      }))
    ];
    menu.innerHTML = '';
    animActions.forEach((row, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'richbuilder-btn';
      btn.dataset.role = 'anim-item';
      btn.dataset.index = String(index);
      btn.textContent = row.label;
      menu.appendChild(btn);
    });
  }

  function setClipMenuOpen(shouldOpen) {
    if (!clipControls.menu || !clipControls.button) return;
    const open = !!shouldOpen;
    clipControls.menu.hidden = !open;
    clipControls.button.setAttribute('aria-expanded', open ? 'true' : 'false');
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

  // Embed (YouTube / web) cards and the Insert menu's embed items share the
  // macro modal: it shows a hint, validates the address, and in "insert" mode
  // (pendingEmbedKind set, no card yet) writes the new line at the caret.
  let pendingEmbedKind = null;

  function setMacroModalMode({ title, hint, canDelete }) {
    macroTitle.textContent = title;
    macroHint.textContent = hint || '';
    macroHint.hidden = !hint;
    macroHint.classList.remove('is-error');
    macroDeleteBtn.hidden = !canDelete;
  }

  function openMacroModal(el) {
    const raw = el.getAttribute('data-macro-content') || '';
    const content = raw ? decodeURIComponent(raw) : '';
    macroTextarea.value = content;
    pendingMacroEl = el;
    pendingEmbedKind = null;
    const embed = parseEmbedLine(content);
    setMacroModalMode(embed
      ? { title: embed.kind === 'youtube' ? t('Edit YouTube Embed') : t('Edit Web Embed'), hint: t('Edit the address inside the parentheses.'), canDelete: true }
      : { title: t('Edit Macro'), hint: '', canDelete: true });
    macroBackdrop.hidden = false;
    macroTextarea.focus();
    macroTextarea.select();
  }

  // Insert-menu entry: ask for the address, then insert `![youtube](url)` etc.
  function openEmbedInsertModal(kind, modifier = '') {
    pendingMacroEl = null;
    pendingEmbedKind = { kind, modifier };
    macroTextarea.value = '';
    setMacroModalMode({
      title: kind === 'youtube' ? t('Insert YouTube Video') : t('Insert Website Embed'),
      hint: kind === 'youtube' ? t('Paste a YouTube link (youtu.be/… or youtube.com/watch?v=…).') : t('Paste the web address (https://…).'),
      canDelete: false
    });
    macroBackdrop.hidden = false;
    macroTextarea.focus();
  }

  function applyMacro() {
    if (!pendingMacroEl && !pendingEmbedKind) return;
    let newContent = macroTextarea.value.trim();
    if (!newContent) {
      closeMacroModal();
      return;
    }
    const insertKind = pendingEmbedKind;
    if (insertKind) {
      // The box holds just the address; wrap it as the embed line.
      newContent = `![${insertKind.kind}${insertKind.modifier ? `:${insertKind.modifier}` : ''}](${newContent})`;
    }
    const embed = parseEmbedLine(newContent);
    if (embed && !isValidEmbedUrl(embed.kind, embed.url)) {
      macroHint.textContent = embed.kind === 'youtube'
        ? t('That is not a recognised YouTube link.')
        : t('Enter a full web address starting with http:// or https://.');
      macroHint.hidden = false;
      macroHint.classList.add('is-error');
      return;
    }
    if (insertKind) {
      closeMacroModal();
      placeMarkdownCaretFromEditor();
      editor.blur();
      insertPending = Date.now() + 120000;
      window.RevelationInsert?.insertSnippet(newContent);
      return;
    }
    pendingMacroEl.setAttribute('data-macro-content', encodeURIComponent(newContent));
    pendingMacroEl.textContent = macroCardLabel(newContent);
    pendingMacroEl.classList.toggle('richbuilder-embed-token', !!embed);
    closeMacroModal();
    scheduleSync();
  }

  function closeMacroModal() {
    macroBackdrop.hidden = true;
    pendingMacroEl = null;
    pendingEmbedKind = null;
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

  // Fragment tokens (++ / ==) are offered to plugins first through the
  // onRichFragmentEdit(payload) hook (appearance opens its animation dialog).
  // payload: { marker, symbol, setMarker(newMarker) -> boolean, remove() }.
  // A plugin returns true (or a promise of true) when it handled the click;
  // otherwise the built-in marker text modal opens.
  const FRAGMENT_MARKER_RE = /^(\+\+|==)(:[A-Za-z0-9_-]+)*$/;
  async function editFragmentToken(el) {
    const raw = el.getAttribute('data-fragment-content') || '';
    const marker = raw ? decodeURIComponent(raw) : '';
    const payload = {
      marker,
      symbol: getFragmentMarkerSymbol(marker),
      setMarker(newMarker) {
        const value = String(newMarker || '').trim();
        if (!FRAGMENT_MARKER_RE.test(value) || !el.isConnected) return false;
        el.setAttribute('data-fragment-content', encodeURIComponent(value));
        el.textContent = getFragmentMarkerSymbol(value);
        scheduleSync();
        return true;
      },
      remove() {
        if (el.isConnected) deleteEditorToken(el);
      }
    };
    const plugins = Object.entries(window.RevelationPlugins || {})
      .map(([name, plugin]) => ({ name, plugin, priority: plugin?.priority ?? 999 }))
      .sort((a, b) => a.priority - b.priority);
    for (const { name, plugin } of plugins) {
      if (typeof plugin?.onRichFragmentEdit !== 'function') continue;
      try {
        if (await plugin.onRichFragmentEdit(payload)) return;
      } catch (err) {
        console.warn(`[richbuilder] onRichFragmentEdit failed for plugin '${name}':`, err);
      }
    }
    openFragmentModal(el);
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
        : card.classList.contains('richbuilder-fragment-token') ? editFragmentToken
          : isLink ? openLinkModal
            : null;
    const items = [];
    if (edit) items.push([isLink ? t('Edit Link…') : t('Edit…'), () => edit(card)]);
    if (isLink) items.push([t('Remove Link'), () => unwrapLinkToken(card)]);
    items.push([t('Delete'), () => deleteEditorToken(card), true]);
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
  // (the same getSlideTools items as the Slide Markdown Tools menu).
  function openTextMenu(x, y, tools) {
    const items = [];
    const hasSelection = !window.getSelection()?.isCollapsed;
    if (hasSelection) {
      items.push([t('Cut'), () => clipboard.cut()]);
      items.push([t('Copy'), () => clipboard.copy()]);
    }
    items.push([t('Paste'), () => clipboard.paste()]);
    items.push([t('Paste as Plain Text'), () => clipboard.pastePlain()]);
    items.push([t('Smart Paste…'), () => clipboard.smartPaste()]);
    // Fragment (++) sits with the plugin tools (appearance's "Appearance
    // Animation…") that sit next to it.
    items.push([t('Fragment (++)'), () => insertFragmentAtCaret(), false, true]);
    tools.forEach((tool) => {
      items.push([t(tool.label), () => {
        placeMarkdownCaretFromEditor();
        return window.RevelationSlideTools.run(tool);
      }]);
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
    if (role === 'anim-toggle') {
      event.preventDefault();
      setLayoutMenuOpen(false);
      setColorMenuOpen(false);
      setListMenuOpen(false);
      setTableMenuOpen(false);
      setClipMenuOpen(false);
      setInsertMenuOpen(false);
      setAnimMenuOpen(animControls.menu.hidden);
      return;
    }
    if (role === 'anim-item') {
      event.preventDefault();
      const row = animActions[Number(btn.dataset.index)];
      setAnimMenuOpen(false);
      if (row) Promise.resolve(row.action()).catch((err) => console.error('[richbuilder] Animation action failed:', err));
      return;
    }
    if (role === 'insert-toggle') {
      event.preventDefault();
      setLayoutMenuOpen(false);
      setColorMenuOpen(false);
      setListMenuOpen(false);
      setTableMenuOpen(false);
      setClipMenuOpen(false);
      setAnimMenuOpen(false);
      setInsertMenuOpen(insertControls.menu.hidden);
      return;
    }
    if (role === 'insert-item') {
      event.preventDefault();
      const row = insertActions[Number(btn.dataset.index)];
      if (!row || row.disabled) return;
      if (row.keepOpen) {
        // The re-render detaches this button; keep the document click handler
        // from mistaking that for a click outside the menu.
        event.stopPropagation();
        row.fn();
        return;
      }
      setInsertMenuOpen(false);
      Promise.resolve(row.action()).catch((err) => console.error('[richbuilder] Insert failed:', err));
      return;
    }
    if (role === 'clip-toggle') {
      event.preventDefault();
      setLayoutMenuOpen(false);
      setColorMenuOpen(false);
      setListMenuOpen(false);
      setTableMenuOpen(false);
      setInsertMenuOpen(false);
      setClipMenuOpen(clipControls.menu.hidden);
      return;
    }
    if (role.startsWith('clip-')) {
      event.preventDefault();
      setClipMenuOpen(false);
      const run = {
        'clip-cut': clipboard.cut,
        'clip-copy': clipboard.copy,
        'clip-paste': clipboard.paste,
        'clip-paste-plain': clipboard.pastePlain,
        'clip-smart': clipboard.smartPaste
      }[role];
      Promise.resolve(run?.()).catch((err) => console.error('[richbuilder] Clipboard action failed:', err));
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
    if (role === 'ul' || role === 'ol' || role === 'checklist') {
      setListMenuOpen(false);
    }
    if (role === 'twocol') {
      setTableMenuOpen(false);
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
    else if (value === 'quote' || value === 'code') applyBlockTag(value);
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
    if (!event.composedPath().includes(animControls.group) && animControls.menu && !animControls.menu.hidden) {
      setAnimMenuOpen(false);
    }
    if (!event.composedPath().includes(insertControls.group) && insertControls.menu && !insertControls.menu.hidden) {
      setInsertMenuOpen(false);
    }
    if (!clipControls.group?.contains(target) && clipControls.menu && !clipControls.menu.hidden) {
      setClipMenuOpen(false);
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

  // Tools that insert at the markdown textarea's caret (right-click slide
  // tools) first flush pending edits and put that caret at the end of the
  // block holding the rich editor's caret, so inserts land after it instead of
  // at the slide end.
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
  const clipboard = createClipboardController({
    editor,
    isActive: () => isActive,
    scheduleSync,
    placeMarkdownCaret: placeMarkdownCaretFromEditor,
    resync: () => { if (isActive) syncFromCurrentSlide(); }
  });
  editor.addEventListener('copy', clipboard.handleCopyEvent);
  editor.addEventListener('cut', clipboard.handleCopyEvent);
  editor.addEventListener('paste', clipboard.handlePasteEvent);
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
      editFragmentToken(target);
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
    if (editor.contains(document.activeElement)) {
      if (!(insertPending > Date.now() && payload?.source === 'builder')) return;
      editor.blur();
    }
    insertPending = 0;
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
    title: t('Rich Editor'),
    tooltip: t('Rich Editor'),
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
