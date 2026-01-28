import { pluginLoader } from '/js/pluginloader.js';

const statusText = document.getElementById('status-text');
const saveIndicator = document.getElementById('save-indicator');
const slideListEl = document.getElementById('slide-list');
const editorEl = document.getElementById('slide-editor');
const topEditorEl = document.getElementById('top-editor');
const notesEditorEl = document.getElementById('notes-editor');
const previewFrame = document.getElementById('preview-frame');
const saveBtn = document.getElementById('save-btn');
const addContentBtn = document.getElementById('add-content-btn');
const addContentMenu = document.getElementById('add-content-menu');
const refreshBtn = document.getElementById('refresh-btn');
const reparseBtn = document.getElementById('reparse-btn');
const fileLabel = document.getElementById('builder-file');
const addSlideBtn = document.getElementById('add-slide-btn');
const combineColumnBtn = document.getElementById('combine-column-btn');
const deleteSlideBtn = document.getElementById('delete-slide-btn');
const prevColumnBtn = document.getElementById('prev-column-btn');
const nextColumnBtn = document.getElementById('next-column-btn');
const columnMarkdownBtn = document.getElementById('column-md-btn');
const addColumnBtn = document.getElementById('add-column-btn');
const deleteColumnBtn = document.getElementById('delete-column-btn');
const columnLabel = document.getElementById('column-label');
const slideCountLabel = document.getElementById('slide-count-label');
const previewSlideBtn = document.getElementById('preview-slide-btn');
const previewOverviewBtn = document.getElementById('preview-overview-btn');
const collapsiblePanels = document.querySelectorAll('.panel-collapsible');
const addTopImageBtn = document.getElementById('add-top-image-btn');
const addSlideImageBtn = document.getElementById('add-slide-image-btn');
const addTopMediaBtn = document.getElementById('add-top-media-btn');
const addSlideMediaBtn = document.getElementById('add-slide-media-btn');
const addTopMediaMenu = document.getElementById('add-top-media-menu');
const addSlideMediaMenu = document.getElementById('add-slide-media-menu');
const addTopFormatBtn = document.getElementById('add-top-format-btn');
const addTopFormatMenu = document.getElementById('add-top-format-menu');
const addTopTintBtn = document.getElementById('add-top-tint-btn');
const addTopTintMenu = document.getElementById('add-top-tint-menu');
const columnMarkdownPanel = document.getElementById('column-markdown-panel');
const columnMarkdownEditor = document.getElementById('column-markdown-editor');

const urlParams = new URLSearchParams(window.location.search);
const slug = urlParams.get('slug');
const mdFile = urlParams.get('md') || 'presentation.md';
const dir = urlParams.get('dir');
const tempFile = '__builder_temp.md';
const pendingAddMedia = new Map();
const pendingContentInsert = new Map();

let contentCreators = [];
let contentCreatorsReady = false;
let contentCreatorsLoading = false;
let activeMediaMenu = null;
let activeMediaButton = null;
let activeFormatMenu = null;
let activeFormatButton = null;
let activeTintMenu = null;
let activeTintButton = null;

const state = {
  frontmatter: '',
  stacks: [],
  selected: { h: 0, v: 0 },
  dirty: false,
  columnMarkdownMode: false,
  columnMarkdownColumn: 0,
  previewReady: false,
  previewSyncing: false,
  previewPoller: null
};

function setStatus(message) {
  statusText.textContent = message;
}

function setSaveIndicator(message) {
  saveIndicator.textContent = message;
}

function splitByMarkerLines(text, marker) {
  const lines = text.split(/\r?\n/);
  const chunks = [[]];
  for (const line of lines) {
    if (line.trim() === marker) {
      const current = chunks[chunks.length - 1];
      while (current.length && current[current.length - 1].trim() === '') {
        current.pop();
      }
      chunks.push([]);
    } else {
      chunks[chunks.length - 1].push(line);
    }
  }
  const cleaned = chunks.map((chunk) => {
    while (chunk.length && chunk[0].trim() === '') {
      chunk.shift();
    }
    while (chunk.length && chunk[chunk.length - 1].trim() === '') {
      chunk.pop();
    }
    return chunk.join('\n');
  });
  return cleaned;
}

function parseSlides(body) {
  const horizontal = splitByMarkerLines(body, '***');
  return horizontal.map((h) => splitByMarkerLines(h, '---').map((slide) => parseSlide(slide)));
}

function joinSlides(stacks) {
  const joinerV = '\n\n---\n\n';
  const joinerH = '\n\n***\n\n';
  return stacks
    .map((vertical) => vertical.map((slide) => buildSlide(slide)).join(joinerV))
    .join(joinerH);
}

function titleFromSlide(md) {
  const lines = md.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) {
      return trimmed.replace(/^#+\s*/, '').slice(0, 60);
    }
    return trimmed.slice(0, 60);
  }
  return '(blank slide)';
}

function renderSlideList() {
  slideListEl.innerHTML = '';
  const hIndex = state.selected.h;
  const column = state.stacks[hIndex] || [];
  const total = Math.max(column.length, 0);
  const current = Math.min(state.selected.v + 1, total || 1);
  if (slideCountLabel) {
    slideCountLabel.textContent = `(${current} of ${total || 1})`;
  }
  column.forEach((slide, vIndex) => {
    const item = document.createElement('div');
    item.className = 'slide-item';
    if (state.selected.v === vIndex) {
      item.classList.add('active');
    }

    const id = document.createElement('div');
    id.className = 'slide-id';
    id.textContent = `V${vIndex + 1}`;

    const title = document.createElement('div');
    title.className = 'slide-title';
    title.textContent = titleFromSlide(slide.body || '');

    item.appendChild(id);
    item.appendChild(title);
    item.addEventListener('click', () => selectSlide(hIndex, vIndex));

    slideListEl.appendChild(item);
  });
  updateColumnLabel();
  updateColumnSplitButton();
  updateColumnMarkdownButton();
}

function selectSlide(hIndex, vIndex) {
  const maxH = Math.max(state.stacks.length - 1, 0);
  const safeH = Math.min(Math.max(hIndex, 0), maxH);
  const column = state.stacks[safeH] || [createEmptySlide()];
  const maxV = Math.max(column.length - 1, 0);
  const safeV = Math.min(Math.max(vIndex, 0), maxV);
  state.selected = { h: hIndex, v: vIndex };
  state.selected.h = safeH;
  state.selected.v = safeV;
  const slide = state.stacks[safeH][safeV] || createEmptySlide();
  topEditorEl.value = slide.top || '';
  editorEl.value = slide.body || '';
  notesEditorEl.value = slide.notes || '';
  renderSlideList();
  syncPreviewToEditor();
}

function markDirty(message = 'Unsaved changes') {
  state.dirty = true;
  setSaveIndicator(message);
  setSaveState(true);
}

function setSaveState(needsSave) {
  if (state.columnMarkdownMode) {
    saveBtn.disabled = true;
    saveBtn.textContent = needsSave ? 'Save Now' : 'Already Saved';
    return;
  }
  if (needsSave) {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Now';
  } else {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Already Saved';
  }
}

function getYaml() {
  return window.jsyaml || null;
}

function parseFrontMatterText(frontmatter) {
  const yaml = getYaml();
  if (!yaml) return null;
  if (!frontmatter) return {};
  const match = frontmatter.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?$/);
  const yamlText = match ? match[1] : frontmatter.replace(/^---\r?\n/, '').replace(/\r?\n---\r?\n?$/, '');
  try {
    return yaml.load(yamlText) || {};
  } catch (err) {
    console.warn('Failed to parse frontmatter:', err);
    return null;
  }
}

function stringifyFrontMatter(data) {
  const yaml = getYaml();
  if (!yaml) return '';
  return `---\n${yaml.dump(data)}---\n`;
}

function createEmptySlide() {
  return { top: '', body: '', notes: '' };
}

function isTopMatterLine(trimmed) {
  const prefixes = [
    '![background:sticky',
    '{{bgtint',
    '{{darkbg}}',
    '{{lightbg}}',
    '{{lowerthird}}',
    '{{upperthird}}',
    '{{audio',
    '{{}}'
  ];
  return prefixes.some((prefix) => trimmed.startsWith(prefix));
}

function trimEmptyEdges(lines) {
  const cleaned = [...lines];
  while (cleaned.length && cleaned[0].trim() === '') {
    cleaned.shift();
  }
  while (cleaned.length && cleaned[cleaned.length - 1].trim() === '') {
    cleaned.pop();
  }
  return cleaned;
}

function parseSlide(raw) {
  const lines = raw.split(/\r?\n/);
  let idx = 0;
  let sawTop = false;
  const topLines = [];

  while (idx < lines.length) {
    const line = lines[idx];
    const trimmed = line.trim();
    if (trimmed === '') {
      if (sawTop) topLines.push(line);
      idx += 1;
      continue;
    }
    if (isTopMatterLine(trimmed)) {
      sawTop = true;
      topLines.push(line);
      idx += 1;
      continue;
    }
    break;
  }

  if (!sawTop) {
    idx = 0;
    topLines.length = 0;
  }

  const remaining = lines.slice(idx);
  const noteIndex = remaining.findIndex((line) => line.trim() === 'Note:');
  let bodyLines = [];
  let notesLines = [];
  if (noteIndex >= 0) {
    bodyLines = remaining.slice(0, noteIndex);
    notesLines = remaining.slice(noteIndex + 1);
  } else {
    bodyLines = remaining;
  }

  bodyLines = trimEmptyEdges(bodyLines);
  notesLines = trimEmptyEdges(notesLines);

  return {
    top: topLines.join('\n'),
    body: bodyLines.join('\n'),
    notes: notesLines.join('\n')
  };
}

function buildSlide(slide) {
  const top = slide.top ? slide.top.trimEnd() : '';
  const body = slide.body ? slide.body.trim() : '';
  const notes = slide.notes ? slide.notes.trim() : '';
  const parts = [];
  if (top) parts.push(top);
  if (body) parts.push(body);
  if (notes) parts.push(`Note:\n${notes}`);
  return parts.join('\n\n');
}

function buildMediaMarkdown(tagType, tag) {
  if (!tag) return '';
  const prefix = `media:${tag}`;
  if (tagType === 'background') return `![background](${prefix})`;
  if (tagType === 'backgroundsticky') return `![background:sticky](${prefix})`;
  if (tagType === 'fit') return `![fit](${prefix})`;
  if (tagType === 'normal') return `![](${prefix})`;
  return '';
}

function buildFileMarkdown(tagType, encoded) {
  if (!encoded) return '';
  if (tagType === 'background') return `![background](${encoded})`;
  if (tagType === 'backgroundsticky') return `![background:sticky](${encoded})`;
  if (tagType === 'fit') return `![fit](${encoded})`;
  if (tagType === 'normal') return `![](${encoded})`;
  return '';
}

function applyInsertToEditor(editor, field, insertText) {
  if (!editor || !insertText) return;
  const { value, selectionStart, selectionEnd } = editor;
  const before = value.slice(0, selectionStart);
  const after = value.slice(selectionEnd);
  const prefix = before && !before.endsWith('\n') ? '\n' : '';
  const suffix = after && !after.startsWith('\n') ? '\n' : '';
  const insertion = `${prefix}${insertText}${suffix}`;
  const newValue = `${before}${insertion}${after}`;
  editor.value = newValue;
  const caret = before.length + insertion.length;
  editor.selectionStart = caret;
  editor.selectionEnd = caret;
  const { h, v } = state.selected;
  state.stacks[h][v][field] = newValue;
  markDirty();
  if (field === 'body') {
    renderSlideList();
  }
  schedulePreviewUpdate();
}

function stripBackgroundLines(text, selectionStart, selectionEnd) {
  const lines = text.match(/.*(?:\n|$)/g) || [''];
  let pos = 0;
  let cleaned = '';
  let keptBeforeStart = 0;
  let keptBeforeEnd = 0;

  for (const line of lines) {
    const lineStart = pos;
    const lineEnd = pos + line.length;
    pos = lineEnd;
    const trimmed = line.replace(/\r?\n$/, '').trim();
    const isBackgroundLine =
      trimmed.startsWith('![background:sticky') ||
      trimmed.startsWith('![background]');

    if (!isBackgroundLine) {
      cleaned += line;
      if (selectionStart > lineEnd) {
        keptBeforeStart += line.length;
      } else if (selectionStart >= lineStart) {
        keptBeforeStart += Math.max(0, selectionStart - lineStart);
      }
      if (selectionEnd > lineEnd) {
        keptBeforeEnd += line.length;
      } else if (selectionEnd >= lineStart) {
        keptBeforeEnd += Math.max(0, selectionEnd - lineStart);
      }
    }
  }

  return {
    text: cleaned,
    selectionStart: Math.min(keptBeforeStart, cleaned.length),
    selectionEnd: Math.min(keptBeforeEnd, cleaned.length)
  };
}

function applyBackgroundInsertToEditor(editor, field, insertText) {
  if (!editor || !insertText) return;
  const cleaned = stripBackgroundLines(editor.value, editor.selectionStart, editor.selectionEnd);
  if (cleaned.text !== editor.value) {
    editor.value = cleaned.text;
    editor.selectionStart = cleaned.selectionStart;
    editor.selectionEnd = cleaned.selectionEnd;
  }
  applyInsertToEditor(editor, field, insertText);
}

function stripMacroLines(text, selectionStart, selectionEnd, macroPrefixes) {
  const lines = text.match(/.*(?:\n|$)/g) || [''];
  let pos = 0;
  let cleaned = '';
  let keptBeforeStart = 0;
  let keptBeforeEnd = 0;

  for (const line of lines) {
    const lineStart = pos;
    const lineEnd = pos + line.length;
    pos = lineEnd;
    const trimmed = line.replace(/\r?\n$/, '').trim();
    const isMacroLine = macroPrefixes.some((prefix) => trimmed.startsWith(prefix));

    if (!isMacroLine) {
      cleaned += line;
      if (selectionStart > lineEnd) {
        keptBeforeStart += line.length;
      } else if (selectionStart >= lineStart) {
        keptBeforeStart += Math.max(0, selectionStart - lineStart);
      }
      if (selectionEnd > lineEnd) {
        keptBeforeEnd += line.length;
      } else if (selectionEnd >= lineStart) {
        keptBeforeEnd += Math.max(0, selectionEnd - lineStart);
      }
    }
  }

  return {
    text: cleaned,
    selectionStart: Math.min(keptBeforeStart, cleaned.length),
    selectionEnd: Math.min(keptBeforeEnd, cleaned.length)
  };
}

function applyMacroInsertToTopEditor(macro) {
  if (!topEditorEl || !macro) return;
  const macroPrefixes = macro === '{{lightbg}}' || macro === '{{darkbg}}'
    ? ['{{lightbg}}', '{{darkbg}}']
    : ['{{lowerthird}}', '{{upperthird}}'];
  const cleaned = stripMacroLines(
    topEditorEl.value,
    topEditorEl.selectionStart,
    topEditorEl.selectionEnd,
    macroPrefixes
  );
  if (cleaned.text !== topEditorEl.value) {
    topEditorEl.value = cleaned.text;
    topEditorEl.selectionStart = cleaned.selectionStart;
    topEditorEl.selectionEnd = cleaned.selectionEnd;
  }
  applyInsertToEditor(topEditorEl, 'top', macro);
}

function applyBgtintInsertToTopEditor(rgba) {
  if (!topEditorEl || !rgba) return;
  const cleaned = stripMacroLines(
    topEditorEl.value,
    topEditorEl.selectionStart,
    topEditorEl.selectionEnd,
    ['{{bgtint']
  );
  if (cleaned.text !== topEditorEl.value) {
    topEditorEl.value = cleaned.text;
    topEditorEl.selectionStart = cleaned.selectionStart;
    topEditorEl.selectionEnd = cleaned.selectionEnd;
  }
  applyInsertToEditor(topEditorEl, 'top', `{{bgtint:${rgba}}}`);
}

function addMediaToFrontmatter(tag, item) {
  const yaml = getYaml();
  if (!yaml) {
    window.alert('Media insert requires YAML support.');
    return false;
  }
  const normalized = tag.toLowerCase();
  if (!/^[a-z0-9_]+$/.test(normalized)) {
    window.alert('Media tag must use lowercase letters, numbers, and underscores only.');
    return false;
  }
  const data = parseFrontMatterText(state.frontmatter);
  if (data === null) {
    window.alert('Failed to parse front matter. Please fix it before inserting media.');
    return false;
  }
  if (!data.media) data.media = {};
  const existing = data.media[normalized];
  if (existing && existing.filename && existing.filename !== item.filename) {
    window.alert(`Media tag "${normalized}" already exists.`);
    return false;
  }
  data.media[normalized] = {
    filename: item.filename || '',
    title: item.title || '',
    mediatype: item.mediatype || '',
    description: item.description || '',
    attribution: item.attribution || '',
    license: item.license || '',
    url_origin: item.url_origin || '',
    url_library: item.url_library || '',
    url_direct: item.url_direct || ''
  };
  state.frontmatter = stringifyFrontMatter(data);
  markDirty();
  schedulePreviewUpdate();
  return true;
}

function openAddMediaDialog(insertTarget) {
  if (!window.electronAPI?.pluginTrigger) {
    window.alert('Media insert is only available in the desktop app.');
    return;
  }
  if (!slug || !mdFile) {
    window.alert('Missing presentation metadata.');
    return;
  }
  const returnKey = `addmedia:builder:${slug}:${mdFile}:${Date.now()}`;
  pendingAddMedia.set(returnKey, { insertTarget });
  localStorage.removeItem(returnKey);
  const tagType = insertTarget === 'top' ? 'backgroundsticky' : 'normal';
  window.electronAPI.pluginTrigger('addmedia', 'add-media', {
    slug,
    mdFile,
    returnKey,
    insertTarget,
    tagType,
    origin: 'builder'
  }).catch((err) => {
    console.error(err);
    window.alert(`Failed to open media dialog: ${err.message}`);
  });
}

function updateAddContentState() {
  if (!addContentBtn) return;
  const disabled = !window.electronAPI?.pluginTrigger;
  addContentBtn.disabled = disabled;
  addContentBtn.title = disabled ? 'Add Content is only available in the desktop app.' : '';
}

function renderAddContentMenu() {
  if (!addContentMenu) return;
  addContentMenu.innerHTML = '';
  const addItem = (label, onClick, disabled = false) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'builder-dropdown-item';
    item.textContent = label;
    if (disabled) {
      item.classList.add('is-disabled');
      item.disabled = true;
    } else {
      item.addEventListener('click', onClick);
    }
    addContentMenu.appendChild(item);
  };

  if (!contentCreatorsReady) {
    addItem('Loading plugins…', null, true);
    return;
  }
  if (!contentCreators.length) {
    addItem('No content plugins available.', null, true);
    return;
  }

  contentCreators.forEach((creator) => {
    addItem(creator.label, () => {
      closeAddContentMenu();
      const insertAt = { ...state.selected };
      const returnKey = `addcontent:builder:${slug}:${mdFile}:${Date.now()}`;
      pendingContentInsert.set(returnKey, { insertAt });
      localStorage.removeItem(returnKey);
      try {
        creator.action({
          slug,
          mdFile,
          returnKey,
          origin: 'builder'
        });
      } catch (err) {
        console.error('Add content failed:', err);
        window.alert(`Failed to start ${creator.label}: ${err.message}`);
      }
    });
  });
}

function getLinkedMediaTags() {
  const data = parseFrontMatterText(state.frontmatter);
  if (!data) return null;
  const media = data.media;
  if (!media || typeof media !== 'object') return [];
  return Object.keys(media)
    .filter((tag) => typeof tag === 'string' && tag.trim() !== '')
    .sort((a, b) => a.localeCompare(b));
}

function renderMediaMenu(menuEl, insertTarget) {
  if (!menuEl) return;
  menuEl.innerHTML = '';
  const addItem = (label, onClick, disabled = false) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'builder-dropdown-item';
    item.textContent = label;
    if (disabled) {
      item.classList.add('is-disabled');
      item.disabled = true;
    } else {
      item.addEventListener('click', onClick);
    }
    menuEl.appendChild(item);
  };

  if (!getYaml()) {
    addItem('YAML support unavailable.', null, true);
    return;
  }

  const tags = getLinkedMediaTags();
  if (tags === null) {
    addItem('Invalid front matter.', null, true);
    return;
  }
  if (!tags.length) {
    addItem('No linked media in front matter.', null, true);
    return;
  }

  tags.forEach((tag) => {
    addItem(tag, () => {
      closeMediaMenu();
      const tagType = insertTarget === 'top' ? 'backgroundsticky' : 'background';
      const snippet = buildMediaMarkdown(tagType, tag);
      if (!snippet) return;
      if (insertTarget === 'top') {
        applyBackgroundInsertToEditor(topEditorEl, 'top', snippet);
      } else {
        applyBackgroundInsertToEditor(editorEl, 'body', snippet);
      }
    });
  });
}

function renderFormatMenu(menuEl) {
  if (!menuEl) return;
  menuEl.innerHTML = '';
  const addItem = (label, macro) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'builder-dropdown-item';
    item.textContent = label;
    item.addEventListener('click', () => {
      closeFormatMenu();
      applyMacroInsertToTopEditor(macro);
    });
    menuEl.appendChild(item);
  };

  addItem('Clear Inherited Macros', '{{}}');
  addItem('Light Background', '{{lightbg}}');
  addItem('Dark Background', '{{darkbg}}');
  addItem('Lower Third', '{{lowerthird}}');
  addItem('Upper Third', '{{upperthird}}');
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function hexToRgb(hex) {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 6) return null;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return null;
  return { r, g, b };
}

function rgbToHex({ r, g, b }) {
  const toHex = (value) => value.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function parseExistingBgtint() {
  const match = topEditorEl?.value.match(/{{bgtint:rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*([0-9.]+)\s*\)\s*}}/i);
  if (!match) return null;
  const r = clamp(parseInt(match[1], 10), 0, 255);
  const g = clamp(parseInt(match[2], 10), 0, 255);
  const b = clamp(parseInt(match[3], 10), 0, 255);
  const a = clamp(parseFloat(match[4]), 0, 1);
  if ([r, g, b, a].some((value) => Number.isNaN(value))) return null;
  return { r, g, b, a };
}

function renderTintMenu(menuEl) {
  if (!menuEl) return;
  menuEl.innerHTML = '';

  const existing = parseExistingBgtint();
  const initialColor = existing ? rgbToHex(existing) : '#405f5f';
  const initialAlpha = existing ? existing.a : 0.6;

  const header = document.createElement('div');
  header.className = 'builder-tint-row';
  header.textContent = 'Background tint';

  const colorRow = document.createElement('div');
  colorRow.className = 'builder-tint-row';
  const colorLabel = document.createElement('span');
  colorLabel.textContent = 'Color';
  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.value = initialColor;
  colorRow.appendChild(colorLabel);
  colorRow.appendChild(colorInput);

  const alphaRow = document.createElement('div');
  alphaRow.className = 'builder-tint-row';
  const alphaLabel = document.createElement('span');
  alphaLabel.textContent = `Alpha ${initialAlpha.toFixed(2)}`;
  const alphaInput = document.createElement('input');
  alphaInput.type = 'range';
  alphaInput.min = '0';
  alphaInput.max = '1';
  alphaInput.step = '0.05';
  alphaInput.value = initialAlpha.toString();
  alphaRow.appendChild(alphaLabel);
  alphaRow.appendChild(alphaInput);

  const preview = document.createElement('div');
  preview.className = 'builder-tint-preview';

  const actions = document.createElement('div');
  actions.className = 'builder-tint-actions';
  const insertBtn = document.createElement('button');
  insertBtn.type = 'button';
  insertBtn.className = 'panel-button';
  insertBtn.textContent = 'Insert';
  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'panel-button';
  clearBtn.textContent = 'Clear';
  actions.appendChild(clearBtn);
  actions.appendChild(insertBtn);

  const updatePreview = () => {
    const rgb = hexToRgb(colorInput.value) || { r: 64, g: 96, b: 96 };
    const alpha = clamp(parseFloat(alphaInput.value), 0, 1);
    alphaLabel.textContent = `Alpha ${alpha.toFixed(2)}`;
    preview.style.background = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
  };

  colorInput.addEventListener('input', updatePreview);
  alphaInput.addEventListener('input', updatePreview);
  updatePreview();

  insertBtn.addEventListener('click', () => {
    const rgb = hexToRgb(colorInput.value) || { r: 64, g: 96, b: 96 };
    const alpha = clamp(parseFloat(alphaInput.value), 0, 1);
    closeTintMenu();
    applyBgtintInsertToTopEditor(`rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`);
  });

  clearBtn.addEventListener('click', () => {
    closeTintMenu();
    const cleaned = stripMacroLines(
      topEditorEl.value,
      topEditorEl.selectionStart,
      topEditorEl.selectionEnd,
      ['{{bgtint']
    );
    if (cleaned.text !== topEditorEl.value) {
      topEditorEl.value = cleaned.text;
      topEditorEl.selectionStart = cleaned.selectionStart;
      topEditorEl.selectionEnd = cleaned.selectionEnd;
      const { h, v } = state.selected;
      state.stacks[h][v].top = topEditorEl.value;
      markDirty();
      schedulePreviewUpdate();
    }
  });

  menuEl.appendChild(header);
  menuEl.appendChild(colorRow);
  menuEl.appendChild(alphaRow);
  menuEl.appendChild(preview);
  menuEl.appendChild(actions);
}

function openMediaMenu(menuEl, buttonEl, insertTarget) {
  if (!menuEl || !buttonEl) return;
  closeMediaMenu();
  renderMediaMenu(menuEl, insertTarget);
  menuEl.hidden = false;
  buttonEl.classList.add('is-active');
  activeMediaMenu = menuEl;
  activeMediaButton = buttonEl;
  document.addEventListener('click', handleMediaOutsideClick);
  document.addEventListener('keydown', handleMediaKeydown);
}

function closeMediaMenu() {
  if (!activeMediaMenu || !activeMediaButton) return;
  activeMediaMenu.hidden = true;
  activeMediaButton.classList.remove('is-active');
  document.removeEventListener('click', handleMediaOutsideClick);
  document.removeEventListener('keydown', handleMediaKeydown);
  activeMediaMenu = null;
  activeMediaButton = null;
}

function handleMediaOutsideClick(event) {
  if (!activeMediaMenu || !activeMediaButton) return;
  if (activeMediaMenu.contains(event.target) || activeMediaButton.contains(event.target)) return;
  closeMediaMenu();
}

function handleMediaKeydown(event) {
  if (event.key === 'Escape') {
    closeMediaMenu();
  }
}

function openFormatMenu(menuEl, buttonEl) {
  if (!menuEl || !buttonEl) return;
  closeFormatMenu();
  renderFormatMenu(menuEl);
  menuEl.hidden = false;
  buttonEl.classList.add('is-active');
  activeFormatMenu = menuEl;
  activeFormatButton = buttonEl;
  document.addEventListener('click', handleFormatOutsideClick);
  document.addEventListener('keydown', handleFormatKeydown);
}

function closeFormatMenu() {
  if (!activeFormatMenu || !activeFormatButton) return;
  activeFormatMenu.hidden = true;
  activeFormatButton.classList.remove('is-active');
  document.removeEventListener('click', handleFormatOutsideClick);
  document.removeEventListener('keydown', handleFormatKeydown);
  activeFormatMenu = null;
  activeFormatButton = null;
}

function handleFormatOutsideClick(event) {
  if (!activeFormatMenu || !activeFormatButton) return;
  if (activeFormatMenu.contains(event.target) || activeFormatButton.contains(event.target)) return;
  closeFormatMenu();
}

function handleFormatKeydown(event) {
  if (event.key === 'Escape') {
    closeFormatMenu();
  }
}

function openTintMenu(menuEl, buttonEl) {
  if (!menuEl || !buttonEl) return;
  closeTintMenu();
  renderTintMenu(menuEl);
  menuEl.hidden = false;
  buttonEl.classList.add('is-active');
  activeTintMenu = menuEl;
  activeTintButton = buttonEl;
  document.addEventListener('click', handleTintOutsideClick);
  document.addEventListener('keydown', handleTintKeydown);
}

function closeTintMenu() {
  if (!activeTintMenu || !activeTintButton) return;
  activeTintMenu.hidden = true;
  activeTintButton.classList.remove('is-active');
  document.removeEventListener('click', handleTintOutsideClick);
  document.removeEventListener('keydown', handleTintKeydown);
  activeTintMenu = null;
  activeTintButton = null;
}

function handleTintOutsideClick(event) {
  if (!activeTintMenu || !activeTintButton) return;
  if (activeTintMenu.contains(event.target) || activeTintButton.contains(event.target)) return;
  closeTintMenu();
}

function handleTintKeydown(event) {
  if (event.key === 'Escape') {
    closeTintMenu();
  }
}

function openAddContentMenu() {
  if (!addContentMenu || !addContentBtn || addContentBtn.disabled) return;
  renderAddContentMenu();
  addContentMenu.hidden = false;
  addContentBtn.classList.add('is-active');
  document.addEventListener('click', handleAddContentOutsideClick);
  document.addEventListener('keydown', handleAddContentKeydown);
}

function closeAddContentMenu() {
  if (!addContentMenu || !addContentBtn) return;
  addContentMenu.hidden = true;
  addContentBtn.classList.remove('is-active');
  document.removeEventListener('click', handleAddContentOutsideClick);
  document.removeEventListener('keydown', handleAddContentKeydown);
}

function handleAddContentOutsideClick(event) {
  if (!addContentMenu || !addContentBtn) return;
  if (addContentMenu.contains(event.target) || addContentBtn.contains(event.target)) return;
  closeAddContentMenu();
}

function handleAddContentKeydown(event) {
  if (event.key === 'Escape') {
    closeAddContentMenu();
  }
}

function handleContentInsertStorage(event) {
  if (!event.key || !pendingContentInsert.has(event.key) || !event.newValue) return false;
  let payload;
  try {
    payload = JSON.parse(event.newValue);
  } catch (err) {
    console.warn('Invalid content payload:', err);
    return false;
  }
  const pending = pendingContentInsert.get(event.key);
  pendingContentInsert.delete(event.key);
  localStorage.removeItem(event.key);

  let inserted = false;
  if (Array.isArray(payload?.stacks)) {
    inserted = insertSlideStacksAtPosition(payload.stacks, pending?.insertAt);
  } else if (Array.isArray(payload?.slides)) {
    inserted = insertSlideStacksAtPosition([payload.slides], pending?.insertAt);
  } else {
    const markdown = payload?.markdown || payload?.content || '';
    inserted = insertSlidesFromMarkdown(markdown, pending?.insertAt);
  }

  if (!inserted) {
    window.alert('No content was returned from the plugin.');
  } else {
    setStatus('Content inserted.');
  }
  return true;
}

function addSlideAfterCurrent() {
  const { h, v } = state.selected;
  if (!state.stacks[h]) return;
  state.stacks[h].splice(v + 1, 0, createEmptySlide());
  selectSlide(h, v + 1);
  renderSlideList();
  markDirty();
  schedulePreviewUpdate();
}

function deleteCurrentSlide() {
  const { h, v } = state.selected;
  if (!state.stacks[h]) return;
  if (state.stacks.length === 1 && state.stacks[h].length === 1) {
    state.stacks[0][0] = createEmptySlide();
    selectSlide(0, 0);
    renderSlideList();
    markDirty();
    schedulePreviewUpdate();
    return;
  }
  state.stacks[h].splice(v, 1);
  if (state.stacks[h].length === 0) {
    state.stacks.splice(h, 1);
  }
  const nextH = Math.min(h, state.stacks.length - 1);
  const nextV = Math.min(v, state.stacks[nextH].length - 1);
  selectSlide(nextH, nextV);
  renderSlideList();
  markDirty();
  schedulePreviewUpdate();
}

function updateColumnLabel() {
  const total = Math.max(state.stacks.length, 1);
  const current = Math.min(state.selected.h + 1, total);
  columnLabel.textContent = `Column ${current} of ${total}`;
}

function updateColumnSplitButton() {
  if (!combineColumnBtn) return;
  const { h, v } = state.selected;
  if (v === 0) {
    combineColumnBtn.textContent = 'Combine Columns';
    combineColumnBtn.disabled = h === 0;
    combineColumnBtn.title =
      h === 0 ? 'Already at the first column.' : 'Merge this column into the previous column.';
  } else {
    combineColumnBtn.textContent = 'Break Column';
    combineColumnBtn.disabled = false;
    combineColumnBtn.title = 'Start a new column at this slide.';
  }
}

function updateColumnMarkdownButton() {
  if (!columnMarkdownBtn) return;
  if (state.columnMarkdownMode) {
    columnMarkdownBtn.textContent = '👁️';
    columnMarkdownBtn.title = 'Return to slide editor.';
  } else {
    columnMarkdownBtn.textContent = '# MD';
    columnMarkdownBtn.title = 'Edit this column as raw markdown.';
  }
}

function applyColumnMarkdownMode() {
  const isActive = state.columnMarkdownMode;
  document.body.classList.toggle('is-column-md-mode', isActive);
  if (columnMarkdownPanel) {
    columnMarkdownPanel.hidden = !isActive;
  }
  updateColumnMarkdownButton();
  const toggleButtons = [
    addContentBtn,
    addSlideBtn,
    deleteSlideBtn,
    combineColumnBtn,
    refreshBtn,
    reparseBtn
  ];
  toggleButtons.forEach((btn) => {
    if (!btn) return;
    btn.disabled = isActive;
  });
  if (isActive) {
    closeAddContentMenu();
  }
  if (saveBtn) {
    if (isActive) {
      saveBtn.disabled = true;
    } else {
      setSaveState(state.dirty);
    }
  }
}

function getColumnMarkdown(hIndex) {
  const column = state.stacks[hIndex] || [createEmptySlide()];
  const joinerV = '\n\n---\n\n';
  return column.map((slide) => buildSlide(slide)).join(joinerV);
}

function parseColumnMarkdown(markdown) {
  if (!markdown || typeof markdown !== 'string') return [createEmptySlide()];
  const trimmed = markdown.trim();
  if (!trimmed) return [createEmptySlide()];
  return splitByMarkerLines(markdown, '---').map((slide) => parseSlide(slide));
}

function enterColumnMarkdownMode() {
  if (state.columnMarkdownMode || !columnMarkdownEditor) return;
  state.columnMarkdownMode = true;
  state.columnMarkdownColumn = state.selected.h;
  columnMarkdownEditor.value = getColumnMarkdown(state.columnMarkdownColumn);
  if (previewTimer) clearTimeout(previewTimer);
  applyColumnMarkdownMode();
  columnMarkdownEditor.focus();
  setStatus('Column markdown mode enabled. Preview updates are paused.');
}

function applyCurrentColumnMarkdown() {
  if (!state.columnMarkdownMode || !columnMarkdownEditor) return;
  const targetH = state.columnMarkdownColumn;
  const parsedSlides = parseColumnMarkdown(columnMarkdownEditor.value);
  state.stacks[targetH] = parsedSlides.length ? parsedSlides : [createEmptySlide()];
  markDirty();
}

function setColumnMarkdownColumn(nextH) {
  if (!state.columnMarkdownMode || !columnMarkdownEditor) return;
  applyCurrentColumnMarkdown();
  state.columnMarkdownColumn = nextH;
  columnMarkdownEditor.value = getColumnMarkdown(nextH);
  selectSlide(nextH, 0);
  columnMarkdownEditor.focus();
}

function addColumnInMarkdownMode() {
  if (!state.columnMarkdownMode) return;
  applyCurrentColumnMarkdown();
  const insertAt = state.columnMarkdownColumn + 1;
  state.stacks.splice(insertAt, 0, [createEmptySlide()]);
  state.columnMarkdownColumn = insertAt;
  columnMarkdownEditor.value = getColumnMarkdown(insertAt);
  selectSlide(insertAt, 0);
  renderSlideList();
  markDirty();
  columnMarkdownEditor.focus();
}

function deleteColumnInMarkdownMode() {
  if (!state.columnMarkdownMode) return;
  applyCurrentColumnMarkdown();
  if (state.stacks.length === 1) {
    state.stacks[0] = [createEmptySlide()];
    state.columnMarkdownColumn = 0;
    columnMarkdownEditor.value = getColumnMarkdown(0);
    selectSlide(0, 0);
    renderSlideList();
    markDirty();
    columnMarkdownEditor.focus();
    return;
  }
  state.stacks.splice(state.columnMarkdownColumn, 1);
  const nextH = Math.min(state.columnMarkdownColumn, state.stacks.length - 1);
  state.columnMarkdownColumn = nextH;
  columnMarkdownEditor.value = getColumnMarkdown(nextH);
  selectSlide(nextH, 0);
  renderSlideList();
  markDirty();
  columnMarkdownEditor.focus();
}

function exitColumnMarkdownMode() {
  if (!state.columnMarkdownMode || !columnMarkdownEditor) return;
  const targetH = state.columnMarkdownColumn;
  applyCurrentColumnMarkdown();
  state.columnMarkdownMode = false;
  applyColumnMarkdownMode();
  selectSlide(targetH, 0);
  renderSlideList();
  markDirty();
  updatePreview().catch((err) => {
    console.error(err);
    setStatus(`Preview update failed: ${err.message}`);
  });
}

function goToColumn(targetH) {
  const maxH = Math.max(state.stacks.length - 1, 0);
  const nextH = Math.min(Math.max(targetH, 0), maxH);
  selectSlide(nextH, 0);
}

function addColumnAfterCurrent() {
  const { h } = state.selected;
  state.stacks.splice(h + 1, 0, [createEmptySlide()]);
  selectSlide(h + 1, 0);
  renderSlideList();
  markDirty();
  schedulePreviewUpdate();
}

function deleteCurrentColumn() {
  const { h } = state.selected;
  if (state.stacks.length === 1) {
    state.stacks[0] = [createEmptySlide()];
    selectSlide(0, 0);
    renderSlideList();
    markDirty();
    schedulePreviewUpdate();
    return;
  }
  state.stacks.splice(h, 1);
  const nextH = Math.min(h, state.stacks.length - 1);
  selectSlide(nextH, 0);
  renderSlideList();
  markDirty();
  schedulePreviewUpdate();
}

function combineColumnWithPrevious() {
  const { h, v } = state.selected;
  if (h <= 0 || v !== 0) return;
  const current = state.stacks[h];
  const prev = state.stacks[h - 1];
  if (!current || !prev) return;
  const mergedIndex = prev.length + v;
  state.stacks[h - 1] = [...prev, ...current];
  state.stacks.splice(h, 1);
  selectSlide(h - 1, mergedIndex);
  renderSlideList();
  markDirty();
  schedulePreviewUpdate();
}

function breakColumnAtCurrentSlide() {
  const { h, v } = state.selected;
  const column = state.stacks[h];
  if (!column || v <= 0) return;
  const before = column.slice(0, v);
  const after = column.slice(v);
  state.stacks[h] = before;
  state.stacks.splice(h + 1, 0, after);
  selectSlide(h + 1, 0);
  renderSlideList();
  markDirty();
  schedulePreviewUpdate();
}

function getBodyMarkdown() {
  return joinSlides(state.stacks);
}

function getFullMarkdown() {
  return `${state.frontmatter}${getBodyMarkdown()}`;
}

function extractFrontMatter(raw) {
  const match = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (!match) return { frontmatter: '', body: raw };
  return { frontmatter: match[0], body: raw.slice(match[0].length) };
}

function getPluginKey() {
  if (!dir) return null;
  const match = dir.match(/^presentations_(.+)$/);
  return match ? match[1] : null;
}

function isSlideEmpty(slide) {
  if (!slide) return true;
  return [slide.top, slide.body, slide.notes].every((value) => !value || !value.trim());
}

function sanitizeStacks(stacks) {
  if (!Array.isArray(stacks)) return [];
  return stacks
    .map((column) => (Array.isArray(column) ? column.filter((slide) => !isSlideEmpty(slide)) : []))
    .filter((column) => column.length > 0);
}

function insertSlideStacksAtPosition(stacks, insertAt) {
  const cleaned = sanitizeStacks(stacks);
  if (!cleaned.length) return false;
  const targetH = insertAt?.h ?? state.selected.h;
  const targetV = insertAt?.v ?? state.selected.v;
  if (!state.stacks[targetH]) {
    state.stacks[targetH] = [createEmptySlide()];
  }
  const column = state.stacks[targetH];
  const before = column.slice(0, targetV + 1);
  const after = column.slice(targetV + 1);
  const [firstColumn, ...restColumns] = cleaned;
  state.stacks[targetH] = [...before, ...firstColumn, ...after];
  if (restColumns.length) {
    state.stacks.splice(targetH + 1, 0, ...restColumns);
  }
  const insertedIndex = before.length;
  selectSlide(targetH, insertedIndex);
  renderSlideList();
  markDirty();
  schedulePreviewUpdate();
  return true;
}

function insertSlidesFromMarkdown(rawMarkdown, insertAt) {
  if (!rawMarkdown || typeof rawMarkdown !== 'string') return false;
  const { body } = extractFrontMatter(rawMarkdown);
  const trimmed = body.trim();
  if (!trimmed) return false;
  const stacks = parseSlides(trimmed);
  return insertSlideStacksAtPosition(stacks, insertAt);
}

function collectContentCreators() {
  if (!window.RevelationPlugins) return [];
  const plugins = Object.entries(window.RevelationPlugins)
    .map(([name, plugin]) => ({
      name,
      plugin,
      priority: plugin.priority ?? 999
    }))
    .sort((a, b) => a.priority - b.priority);
  const creators = [];
  for (const { name, plugin } of plugins) {
    if (typeof plugin.getContentCreators === 'function') {
      const items = plugin.getContentCreators({ slug, md: mdFile, mdFile, dir });
      if (Array.isArray(items)) {
        items.forEach((item) => {
          if (!item || typeof item.label !== 'string' || typeof item.action !== 'function') return;
          creators.push({ ...item, pluginName: name });
        });
      }
    }
  }
  return creators;
}

async function loadContentCreators() {
  if (contentCreatorsLoading) return;
  contentCreatorsLoading = true;
  try {
    const key = getPluginKey();
    await pluginLoader('builder', key ? `/plugins_${key}` : '');
    contentCreators = collectContentCreators();
    contentCreatorsReady = true;
  } catch (err) {
    console.warn('Failed to load builder plugins:', err);
    contentCreators = [];
    contentCreatorsReady = true;
  } finally {
    contentCreatorsLoading = false;
    updateAddContentState();
  }
}

let previewTimer = null;
function schedulePreviewUpdate() {
  if (state.columnMarkdownMode) return;
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    updatePreview().catch((err) => {
      console.error(err);
      setStatus(`Preview update failed: ${err.message}`);
    });
  }, 400);
}

async function updatePreview() {
  if (state.columnMarkdownMode) {
    setStatus('Preview updates are paused in column markdown mode.');
    return;
  }
  if (!window.electronAPI?.savePresentationMarkdown) return;
  const content = getFullMarkdown();
  await window.electronAPI.savePresentationMarkdown({
    slug,
    mdFile,
    content,
    targetFile: tempFile
  });
  const previewUrl = `/${dir}/${slug}/index.html?p=${tempFile}&forceControls=1`;
  previewFrame.src = previewUrl;
  setStatus('Preview updated.');
}

function syncPreviewToEditor() {
  if (state.columnMarkdownMode) return;
  if (!state.previewReady || state.previewSyncing) return;
  const deck = getPreviewDeck();
  if (!deck) return;
  const { h, v } = state.selected;
  const current = deck.getIndices ? deck.getIndices() : { h: 0, v: 0 };
  if (current.h === h && current.v === v) return;
  state.previewSyncing = true;
  try {
    deck.slide(h, v);
  } catch (err) {
    console.warn('Failed to sync preview to editor:', err);
  } finally {
    setTimeout(() => {
      state.previewSyncing = false;
    }, 0);
  }
}

function getPreviewDeck() {
  const win = previewFrame?.contentWindow;
  return win?.deck || win?.Reveal || null;
}

function setPreviewMode(isOverview) {
  previewSlideBtn.classList.toggle('is-active', !isOverview);
  previewOverviewBtn.classList.toggle('is-active', !!isOverview);
}

function attachPreviewBridge() {
  const deck = getPreviewDeck();
  if (!deck || state.previewReady) return;
  state.previewReady = true;

  if (typeof deck.isOverview === 'function') {
    setPreviewMode(deck.isOverview());
  }

  deck.on('slidechanged', () => {
    if (state.previewSyncing || state.columnMarkdownMode) return;
    const indices = deck.getIndices ? deck.getIndices() : null;
    if (!indices) return;
    if (indices.h === state.selected.h && indices.v === state.selected.v) return;
    selectSlide(indices.h, indices.v);
  });

  deck.on('overviewshown', () => setPreviewMode(true));
  deck.on('overviewhidden', () => setPreviewMode(false));

  deck.on('ready', () => {
    setPreviewMode(deck.isOverview ? deck.isOverview() : false);
    syncPreviewToEditor();
  });
}

function startPreviewPolling() {
  if (state.previewPoller) clearInterval(state.previewPoller);
  state.previewReady = false;
  state.previewPoller = setInterval(() => {
    if (state.previewReady) return;
    const deck = getPreviewDeck();
    if (deck && typeof deck.on === 'function') {
      clearInterval(state.previewPoller);
      state.previewPoller = null;
      attachPreviewBridge();
    }
  }, 250);
}

async function savePresentation() {
  if (!window.electronAPI?.savePresentationMarkdown) {
    setStatus('Save unavailable outside of Electron.');
    return;
  }
  const content = getFullMarkdown();
  setSaveIndicator('Saving…');
  const res = await window.electronAPI.savePresentationMarkdown({
    slug,
    mdFile,
    content
  });
  if (res?.success) {
    state.dirty = false;
    setSaveIndicator('Saved');
    setSaveState(false);
    setStatus('Presentation saved.');
  } else {
    setSaveIndicator('Save failed');
  }
}

async function loadPresentation() {
  if (!slug || !dir) {
    setStatus('Missing presentation metadata.');
    return;
  }
  const fileUrl = `/${dir}/${slug}/${mdFile}`;
  fileLabel.textContent = `${slug}/${mdFile}`;

  const response = await fetch(fileUrl);
  if (!response.ok) {
    throw new Error(`Failed to load ${fileUrl}`);
  }
  const raw = await response.text();
  const { frontmatter, body } = extractFrontMatter(raw);
  state.frontmatter = frontmatter;
  state.stacks = parseSlides(body);
  if (!state.stacks.length) {
    state.stacks = [[createEmptySlide()]];
  }
  selectSlide(0, 0);
  setSaveState(false);
  await updatePreview();
  setStatus('Presentation loaded.');
}

async function reparseFromFile() {
  if (state.columnMarkdownMode) {
    setStatus('Exit column markdown mode before re-parsing.');
    return;
  }
  if (!window.electronAPI?.savePresentationMarkdown) {
    setStatus('Re-parse unavailable outside of Electron.');
    return;
  }
  /*
  const ok = window.confirm(
    'Re-parse will rebuild slides from the temporary preview file and will not touch the saved file. Continue?'
  );
  if (!ok) return;
  */
  const content = getFullMarkdown();
  await window.electronAPI.savePresentationMarkdown({
    slug,
    mdFile,
    content,
    targetFile: tempFile
  });
  const fileUrl = `/${dir}/${slug}/${tempFile}`;
  const response = await fetch(fileUrl);
  if (!response.ok) {
    throw new Error(`Failed to load ${fileUrl}`);
  }
  const raw = await response.text();
  const { frontmatter, body } = extractFrontMatter(raw);
  const { h, v } = state.selected;
  state.frontmatter = frontmatter;
  state.stacks = parseSlides(body);
  if (!state.stacks.length) {
    state.stacks = [[createEmptySlide()]];
  }
  selectSlide(h, v);
  setStatus('Slides re-parsed from preview file.');
}

editorEl.addEventListener('input', () => {
  const { h, v } = state.selected;
  state.stacks[h][v].body = editorEl.value;
  markDirty();
  renderSlideList();
  schedulePreviewUpdate();
});

topEditorEl.addEventListener('input', () => {
  const { h, v } = state.selected;
  state.stacks[h][v].top = topEditorEl.value;
  markDirty();
  schedulePreviewUpdate();
});

notesEditorEl.addEventListener('input', () => {
  const { h, v } = state.selected;
  state.stacks[h][v].notes = notesEditorEl.value;
  markDirty();
  schedulePreviewUpdate();
});

addSlideBtn.addEventListener('click', () => {
  addSlideAfterCurrent();
});

if (columnMarkdownBtn) {
  columnMarkdownBtn.addEventListener('click', () => {
    if (state.columnMarkdownMode) {
      exitColumnMarkdownMode();
    } else {
      enterColumnMarkdownMode();
    }
  });
}

if (combineColumnBtn) {
  combineColumnBtn.addEventListener('click', () => {
    if (state.selected.v === 0) {
      combineColumnWithPrevious();
    } else {
      breakColumnAtCurrentSlide();
    }
  });
}

deleteSlideBtn.addEventListener('click', () => {
  deleteCurrentSlide();
});

prevColumnBtn.addEventListener('click', () => {
  if (state.columnMarkdownMode) {
    const nextH = Math.max(state.columnMarkdownColumn - 1, 0);
    setColumnMarkdownColumn(nextH);
  } else {
    goToColumn(state.selected.h - 1);
  }
});

nextColumnBtn.addEventListener('click', () => {
  if (state.columnMarkdownMode) {
    const nextH = Math.min(state.columnMarkdownColumn + 1, state.stacks.length - 1);
    setColumnMarkdownColumn(nextH);
  } else {
    goToColumn(state.selected.h + 1);
  }
});

addColumnBtn.addEventListener('click', () => {
  if (state.columnMarkdownMode) {
    addColumnInMarkdownMode();
  } else {
    addColumnAfterCurrent();
  }
});

deleteColumnBtn.addEventListener('click', () => {
  if (state.columnMarkdownMode) {
    deleteColumnInMarkdownMode();
  } else {
    deleteCurrentColumn();
  }
});

previewSlideBtn.addEventListener('click', () => {
  const deck = getPreviewDeck();
  if (!deck || typeof deck.toggleOverview !== 'function') return;
  if (deck.isOverview && deck.isOverview()) {
    deck.toggleOverview();
  }
});

previewOverviewBtn.addEventListener('click', () => {
  const deck = getPreviewDeck();
  if (!deck || typeof deck.toggleOverview !== 'function') return;
  if (!deck.isOverview || !deck.isOverview()) {
    deck.toggleOverview();
  }
});

saveBtn.addEventListener('click', () => {
  savePresentation().catch((err) => {
    console.error(err);
    setSaveIndicator('Save failed');
    setStatus(`Save failed: ${err.message}`);
  });
});

if (addContentBtn) {
  addContentBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (addContentMenu?.hidden) {
      openAddContentMenu();
    } else {
      closeAddContentMenu();
    }
  });
}

refreshBtn.addEventListener('click', () => {
  updatePreview().catch((err) => {
    console.error(err);
    setStatus(`Preview update failed: ${err.message}`);
  });
});

reparseBtn.addEventListener('click', () => {
  reparseFromFile().catch((err) => {
    console.error(err);
    setStatus(`Re-parse failed: ${err.message}`);
  });
});

previewFrame.addEventListener('load', () => {
  startPreviewPolling();
});

if (addTopImageBtn) {
  addTopImageBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    openAddMediaDialog('top');
  });
}

if (addSlideImageBtn) {
  addSlideImageBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    openAddMediaDialog('body');
  });
}

if (addTopMediaBtn) {
  addTopMediaBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!addTopMediaMenu) return;
    if (addTopMediaMenu.hidden) {
      openMediaMenu(addTopMediaMenu, addTopMediaBtn, 'top');
    } else {
      closeMediaMenu();
    }
  });
}

if (addSlideMediaBtn) {
  addSlideMediaBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!addSlideMediaMenu) return;
    if (addSlideMediaMenu.hidden) {
      openMediaMenu(addSlideMediaMenu, addSlideMediaBtn, 'body');
    } else {
      closeMediaMenu();
    }
  });
}

if (addTopFormatBtn) {
  addTopFormatBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!addTopFormatMenu) return;
    if (addTopFormatMenu.hidden) {
      openFormatMenu(addTopFormatMenu, addTopFormatBtn);
    } else {
      closeFormatMenu();
    }
  });
}

if (addTopTintBtn) {
  addTopTintBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!addTopTintMenu) return;
    if (addTopTintMenu.hidden) {
      openTintMenu(addTopTintMenu, addTopTintBtn);
    } else {
      closeTintMenu();
    }
  });
}

updateAddContentState();
loadContentCreators().catch((err) => {
  console.error(err);
});

function handleAddMediaStorage(event) {
  if (!event.key || !pendingAddMedia.has(event.key) || !event.newValue) return false;
  let payload;
  try {
    payload = JSON.parse(event.newValue);
  } catch (err) {
    console.warn('Invalid media payload:', err);
    return false;
  }
  const pending = pendingAddMedia.get(event.key);
  pendingAddMedia.delete(event.key);
  localStorage.removeItem(event.key);
  if (!payload?.item || !payload?.tag) {
    if (payload?.mode !== 'file') {
      window.alert('Media selection was incomplete.');
      return true;
    }
  }
  if (payload?.mode !== 'file') {
    const ok = addMediaToFrontmatter(payload.tag, payload.item);
    if (!ok) return true;
  }
  const insertTarget = payload.insertTarget || pending?.insertTarget;
  const snippet = payload?.mode === 'file'
    ? buildFileMarkdown(payload.tagType, payload.encoded || payload.filename)
    : buildMediaMarkdown(payload.tagType, payload.tag);
  if (!snippet) return true;
  const useBackgroundInsert = snippet.trim().startsWith('![background');
  if (insertTarget === 'top') {
    if (useBackgroundInsert) {
      applyBackgroundInsertToEditor(topEditorEl, 'top', snippet);
    } else {
      applyInsertToEditor(topEditorEl, 'top', snippet);
    }
  } else {
    if (useBackgroundInsert) {
      applyBackgroundInsertToEditor(editorEl, 'body', snippet);
    } else {
      applyInsertToEditor(editorEl, 'body', snippet);
    }
  }
  return true;
}

window.addEventListener('storage', (event) => {
  if (!event.key || !event.newValue) return;
  if (handleContentInsertStorage(event)) return;
  handleAddMediaStorage(event);
});

loadPresentation().catch((err) => {
  console.error(err);
  setStatus(`Error: ${err.message}`);
});

collapsiblePanels.forEach((panel) => {
  const toggle = panel.querySelector('.panel-toggle');
  if (!toggle) return;
  const syncToggle = () => {
    const isCollapsed = panel.classList.contains('is-collapsed');
    toggle.setAttribute('aria-expanded', String(!isCollapsed));
  };
  syncToggle();
  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    panel.classList.toggle('is-collapsed');
    syncToggle();
  });
});

window.addEventListener('beforeunload', (event) => {
  if (window.electronAPI?.cleanupPresentationTemp) {
    window.electronAPI.cleanupPresentationTemp({ slug, tempFile }).catch((err) => {
      console.warn('Failed to remove temp file:', err);
    });
  }
});

window.__builderGetDirty = () => !!state.dirty;
