/*
 * Slide Properties button + popover (visual front end for top matter).
 *
 * Sections:
 * - Inheritance resolution
 * - Token parsing
 * - Top matter writes
 * - Popover rendering
 * - Open/close + setup
 *
 * Inheritance mirrors the compiler (revelation/js/compiler/slide-compiler.js):
 * a slide with any sticky line other than `{{}}` replaces the inherited set,
 * `{{}}` alone clears it, and every other slide replays the last set. This runs
 * in deck order, so a source can sit in an earlier column.
 */
import { state, topEditorEl, trFormat } from './context.js';
import { selectSlide, expandTopMatterPanel } from './slides.js';
import { setBuilderView } from './layout.js';
import { addDirtyListener } from './app-state.js';

const propertiesBtn = document.getElementById('slide-properties-btn');
const propertiesPopover = document.getElementById('slide-properties-popover');

let popoverOpen = false;
let editingToken = false;
let borrowedActions = [];

// --- Inheritance resolution ---
const RESET_LINE_RE = /^\{\{\}\}$/;
const STICKY_BG_RE = /!\[background:sticky\]\(([^)]*)\)/i;
const MACRO_LINE_RE = /^\{\{([A-Za-z0-9_]+)(?::([^}]*))?\}\}$/;

function getTopLines(top) {
  return String(top || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function isStickyLine(line) {
  return STICKY_BG_RE.test(line) || (line.includes('{{') && line.includes('}}'));
}

function classifyTop(top) {
  const lines = getTopLines(top);
  return {
    setsOwn: lines.some((line) => !RESET_LINE_RE.test(line) && isStickyLine(line)),
    resets: lines.some((line) => RESET_LINE_RE.test(line))
  };
}

// Returns { status: 'own' | 'inherited' | 'reset' | 'none', source?: { h, v } }.
function resolvePropertyStatus(h, v) {
  let source = null;
  for (let ch = 0; ch < state.stacks.length; ch += 1) {
    const column = state.stacks[ch] || [];
    for (let cv = 0; cv < column.length; cv += 1) {
      const info = classifyTop(column[cv]?.top);
      if (ch === h && cv === v) {
        if (info.setsOwn) return { status: 'own', source: { h, v } };
        if (info.resets) return { status: 'reset' };
        if (source) return { status: 'inherited', source };
        return { status: 'none' };
      }
      if (info.setsOwn) {
        source = { h: ch, v: cv };
      } else if (info.resets) {
        source = null;
      }
    }
  }
  return { status: 'none' };
}

// Body-level commands that switch off inherited groups on just this slide.
function getLocalSuppressions(body) {
  const text = String(body || '');
  const groups = new Set();
  if (/^\s*:clearbg:\s*$/m.test(text) || /!\[background(?::(?!sticky)[^\]]*)?\]\(/i.test(text)) groups.add('background');
  if (/^\s*:nobg:\s*$/m.test(text)) groups.add('bgmode');
  if (/^\s*:shiftnone:\s*$/m.test(text)) groups.add('shift');
  if (/^\s*:nothird:\s*$/m.test(text)) groups.add('third');
  return groups;
}

// --- Token parsing ---
const MACRO_LABELS = {
  darkbg: { label: 'Dark background', group: 'bgmode' },
  lightbg: { label: 'Light background', group: 'bgmode' },
  darktext: { label: 'Dark text' },
  lighttext: { label: 'Light text' },
  upperthird: { label: 'Upper third', group: 'third' },
  lowerthird: { label: 'Lower third', group: 'third' },
  shiftleft: { label: 'Shift left', group: 'shift' },
  shiftright: { label: 'Shift right', group: 'shift' },
  bgtint: { label: 'Tint' },
  transition: { label: 'Transition' },
  animate: { label: 'Auto-animate' },
  autoslide: { label: 'Auto-advance' },
  attrib: { label: 'Attribution' },
  ai: { label: 'AI marker' },
  audio: { label: 'Audio' }
};

function describeLine(line) {
  const bgMatch = line.match(STICKY_BG_RE);
  if (bgMatch) {
    const src = bgMatch[1].trim();
    const detail = src.startsWith('media:') ? src.slice(6) : src.split('/').pop();
    return { kind: 'background', label: tr('Background'), detail, group: 'background' };
  }
  if (RESET_LINE_RE.test(line)) {
    return { kind: 'reset', label: tr('Reset inherited properties'), detail: '' };
  }
  const macroMatch = line.match(MACRO_LINE_RE);
  if (macroMatch) {
    const name = macroMatch[1].toLowerCase();
    const param = (macroMatch[2] || '').trim();
    const known = MACRO_LABELS[name];
    let detail = param;
    if (name === 'autoslide' && /^\d+$/.test(param)) detail = `${Number(param) / 1000}s`;
    return {
      kind: name === 'bgtint' ? 'tint' : 'macro',
      label: known ? tr(known.label) : macroMatch[1],
      detail,
      group: known?.group || '',
      swatch: name === 'bgtint' && !/url\s*\(/i.test(param) ? param : ''
    };
  }
  return { kind: 'raw', label: line, detail: '' };
}

// --- Top matter writes ---
// Route every change through the top editor's input handler so state, dirty
// tracking, the preview and the slide list all update the usual way.
function writeTop(nextTop) {
  if (!topEditorEl) return;
  topEditorEl.value = nextTop;
  topEditorEl.dispatchEvent(new Event('input', { bubbles: true }));
}

function replaceTopLine(lineIndex, replacement) {
  const lines = String(topEditorEl?.value || '').split(/\r?\n/);
  if (lineIndex < 0 || lineIndex >= lines.length) return;
  if (replacement === null) {
    lines.splice(lineIndex, 1);
  } else {
    lines[lineIndex] = replacement;
  }
  writeTop(lines.join('\n').replace(/^\n+|\n+$/g, ''));
}

// --- Popover rendering ---
function getStatusCopy(result) {
  switch (result.status) {
    case 'own':
      return {
        title: tr('This slide sets properties'),
        detail: tr('Following slides inherit these until another slide sets or resets properties.')
      };
    case 'inherited':
      return {
        title: tr('Inherited properties'),
        detail: trFormat('From column {column}, slide {slide}.', {
          column: result.source.h + 1,
          slide: result.source.v + 1
        })
      };
    case 'reset':
      return {
        title: tr('Inheritance cleared'),
        detail: tr('This slide clears inherited properties, so following slides start fresh.')
      };
    default:
      return {
        title: tr('No properties'),
        detail: tr('Add a background, tint or layout. Following slides will inherit it.')
      };
  }
}

function makeButton(label, onClick, className = 'panel-button') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick(event);
  });
  return button;
}

function startInlineEdit(tokenEl, lineIndex, rawLine) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'sp-token-input';
  input.value = rawLine;
  input.spellcheck = false;
  let done = false;
  const finish = (commit) => {
    if (done) return;
    done = true;
    editingToken = false;
    const next = input.value.trim();
    if (commit && next !== rawLine) {
      replaceTopLine(lineIndex, next || null);
    } else {
      renderPopover();
    }
  };
  input.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Enter') finish(true);
    if (event.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', (event) => event.stopPropagation());
  editingToken = true;
  tokenEl.replaceChildren(input);
  input.focus();
  input.select();
}

function buildToken({ line, lineIndex, editable, suppressed }) {
  const info = describeLine(line);
  const tokenEl = document.createElement('div');
  tokenEl.className = 'sp-token';
  tokenEl.dataset.kind = info.kind;
  if (suppressed) tokenEl.classList.add('is-suppressed');
  if (!editable) tokenEl.classList.add('is-readonly');

  const main = document.createElement(editable ? 'button' : 'div');
  if (editable) main.type = 'button';
  main.className = 'sp-token-main';
  main.title = suppressed ? `${line}\n${tr('Switched off on this slide')}` : line;
  if (info.kind === 'tint' && info.swatch) {
    const swatch = document.createElement('span');
    swatch.className = 'sp-token-swatch';
    swatch.style.background = info.swatch;
    main.appendChild(swatch);
  }
  const label = document.createElement('span');
  label.className = 'sp-token-label';
  label.textContent = info.label;
  main.appendChild(label);
  if (info.detail) {
    const detail = document.createElement('span');
    detail.className = 'sp-token-detail';
    detail.textContent = info.detail;
    main.appendChild(detail);
  }
  tokenEl.appendChild(main);

  if (editable) {
    main.addEventListener('click', (event) => {
      event.stopPropagation();
      // Tints get the full tint editor, which pre-fills from the current value.
      const tintBtn = document.getElementById('add-top-tint-btn');
      if (info.kind === 'tint' && tintBtn && propertiesPopover.contains(tintBtn)) {
        tintBtn.click();
        return;
      }
      startInlineEdit(tokenEl, lineIndex, line);
    });
    tokenEl.appendChild(makeButton('×', () => replaceTopLine(lineIndex, null), 'sp-token-remove'));
    tokenEl.lastChild.title = tr('Remove');
  }
  return tokenEl;
}

function renderTokens(container, top, { editable, suppressions }) {
  container.replaceChildren();
  String(top || '').split(/\r?\n/).forEach((rawLine, lineIndex) => {
    const line = rawLine.trim();
    if (!line) return;
    const group = describeLine(line).group;
    container.appendChild(buildToken({
      line,
      lineIndex,
      editable,
      suppressed: !editable && !!group && suppressions.has(group)
    }));
  });
  if (!container.childElementCount) {
    const empty = document.createElement('div');
    empty.className = 'sp-empty';
    empty.textContent = tr('Nothing set yet.');
    container.appendChild(empty);
  }
}

function ensurePopoverSkeleton() {
  if (propertiesPopover.querySelector('.sp-head')) return;
  propertiesPopover.innerHTML = `
    <div class="sp-head">
      <div class="sp-title"></div>
      <div class="sp-detail"></div>
    </div>
    <div class="sp-tokens"></div>
    <div class="sp-add">
      <span class="sp-add-label"></span>
    </div>
    <div class="sp-footer"></div>
  `;
  propertiesPopover.querySelector('.sp-add-label').textContent = tr('Add:');
}

function renderPopover() {
  if (!popoverOpen || !propertiesPopover) return;
  // Don't rebuild under an in-progress token edit.
  if (editingToken) return;
  ensurePopoverSkeleton();

  const { h, v } = state.selected;
  const slide = state.stacks[h]?.[v];
  const result = resolvePropertyStatus(h, v);
  const copy = getStatusCopy(result);
  propertiesPopover.dataset.state = result.status;
  propertiesPopover.querySelector('.sp-title').textContent = copy.title;
  propertiesPopover.querySelector('.sp-detail').textContent = copy.detail;

  const inherited = result.status === 'inherited';
  const sourceSlide = inherited ? state.stacks[result.source.h]?.[result.source.v] : null;
  renderTokens(propertiesPopover.querySelector('.sp-tokens'), inherited ? sourceSlide?.top : slide?.top, {
    editable: !inherited,
    suppressions: getLocalSuppressions(slide?.body)
  });

  // Adding to an inheriting slide would silently drop everything it inherits,
  // so inheriting slides must copy (or clear) first.
  propertiesPopover.querySelector('.sp-add').hidden = inherited;

  const footer = propertiesPopover.querySelector('.sp-footer');
  footer.replaceChildren();
  if (inherited) {
    footer.appendChild(makeButton(tr('Go to that slide'), () => {
      selectSlide(result.source.h, result.source.v);
    }));
    const copyBtn = makeButton(tr('Copy to this slide'), () => {
      const existing = String(slide?.top || '').trim();
      writeTop([String(sourceSlide?.top || '').trim(), existing].filter(Boolean).join('\n'));
    }, 'panel-button primary');
    copyBtn.title = tr('Copy these properties here so you can change them for this slide onwards');
    footer.appendChild(copyBtn);
    const clearBtn = makeButton(tr('Clear from here'), () => writeTop('{{}}'));
    clearBtn.title = tr('Stop inheriting on this slide and the slides after it');
    footer.appendChild(clearBtn);
  }
  const rawBtn = makeButton(tr('Edit as markdown'), () => {
    closePopover();
    setBuilderView('markdown');
    expandTopMatterPanel();
    topEditorEl?.focus();
  }, 'sp-link');
  footer.appendChild(rawBtn);
}

function refreshSlideProperties() {
  if (!propertiesBtn) return;
  const { h, v } = state.selected;
  if (!state.stacks[h]?.[v]) return;
  const result = resolvePropertyStatus(h, v);
  propertiesBtn.dataset.state = result.status;
  const copy = getStatusCopy(result);
  propertiesBtn.title = `${copy.title}. ${copy.detail}`;
  renderPopover();
}

// --- Open/close + setup ---
// The top-matter insert buttons (tint, format, media, image) keep their own
// handlers; they are borrowed into the popover while it is open.
function borrowTopActions() {
  const actions = document.querySelector('.builder-topmatter .panel-actions');
  const addRow = propertiesPopover.querySelector('.sp-add');
  if (!actions || !addRow) return;
  borrowedActions = [...actions.children].filter((el) => !el.classList.contains('panel-chevron'));
  borrowedActions.forEach((el) => addRow.appendChild(el));
}

function returnTopActions() {
  const actions = document.querySelector('.builder-topmatter .panel-actions');
  if (!actions) return;
  const chevron = actions.querySelector('.panel-chevron');
  borrowedActions.forEach((el) => actions.insertBefore(el, chevron));
  borrowedActions = [];
}

function openPopover() {
  if (popoverOpen || !propertiesPopover) return;
  popoverOpen = true;
  ensurePopoverSkeleton();
  borrowTopActions();
  propertiesPopover.hidden = false;
  propertiesBtn.setAttribute('aria-expanded', 'true');
  renderPopover();
  document.addEventListener('click', handleOutsideClick);
  document.addEventListener('keydown', handlePopoverKeydown);
}

function closePopover() {
  if (!popoverOpen) return;
  popoverOpen = false;
  editingToken = false;
  propertiesPopover.hidden = true;
  propertiesBtn.setAttribute('aria-expanded', 'false');
  returnTopActions();
  document.removeEventListener('click', handleOutsideClick);
  document.removeEventListener('keydown', handlePopoverKeydown);
}

function handleOutsideClick(event) {
  const target = event.target;
  if (!(target instanceof Node) || !target.isConnected) return;
  if (propertiesPopover.contains(target) || propertiesBtn.contains(target)) return;
  closePopover();
}

function handlePopoverKeydown(event) {
  if (event.key !== 'Escape') return;
  // Let an open tint/format/media menu inside the popover close first.
  if (propertiesPopover.querySelector('.builder-dropdown-menu:not([hidden])')) return;
  closePopover();
}

function setupSlideProperties() {
  if (!propertiesBtn || !propertiesPopover) return;
  propertiesBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    if (popoverOpen) {
      closePopover();
    } else {
      openPopover();
    }
  });
  // Insert helpers write top matter without touching the indicator, so also
  // refresh on every dirty mark.
  addDirtyListener(refreshSlideProperties);
  refreshSlideProperties();
}

export { setupSlideProperties, refreshSlideProperties, resolvePropertyStatus };
