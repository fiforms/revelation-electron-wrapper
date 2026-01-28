const statusText = document.getElementById('status-text');
const saveIndicator = document.getElementById('save-indicator');
const slideListEl = document.getElementById('slide-list');
const editorEl = document.getElementById('slide-editor');
const topEditorEl = document.getElementById('top-editor');
const notesEditorEl = document.getElementById('notes-editor');
const previewFrame = document.getElementById('preview-frame');
const saveBtn = document.getElementById('save-btn');
const refreshBtn = document.getElementById('refresh-btn');
const reparseBtn = document.getElementById('reparse-btn');
const fileLabel = document.getElementById('builder-file');
const addSlideBtn = document.getElementById('add-slide-btn');
const deleteSlideBtn = document.getElementById('delete-slide-btn');
const prevColumnBtn = document.getElementById('prev-column-btn');
const nextColumnBtn = document.getElementById('next-column-btn');
const addColumnBtn = document.getElementById('add-column-btn');
const deleteColumnBtn = document.getElementById('delete-column-btn');
const columnLabel = document.getElementById('column-label');
const slideCountLabel = document.getElementById('slide-count-label');
const previewSlideBtn = document.getElementById('preview-slide-btn');
const previewOverviewBtn = document.getElementById('preview-overview-btn');
const collapsiblePanels = document.querySelectorAll('.panel-collapsible');
const addTopImageBtn = document.getElementById('add-top-image-btn');
const addSlideImageBtn = document.getElementById('add-slide-image-btn');

const urlParams = new URLSearchParams(window.location.search);
const slug = urlParams.get('slug');
const mdFile = urlParams.get('md') || 'presentation.md';
const dir = urlParams.get('dir');
const tempFile = '__builder_temp.md';
const pendingAddMedia = new Map();

const state = {
  frontmatter: '',
  stacks: [],
  selected: { h: 0, v: 0 },
  dirty: false,
  lastPreviewToken: 0,
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

let previewTimer = null;
function schedulePreviewUpdate() {
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    updatePreview().catch((err) => {
      console.error(err);
      setStatus(`Preview update failed: ${err.message}`);
    });
  }, 400);
}

async function updatePreview() {
  if (!window.electronAPI?.savePresentationMarkdown) return;
  const token = Date.now();
  state.lastPreviewToken = token;
  const content = getFullMarkdown();
  await window.electronAPI.savePresentationMarkdown({
    slug,
    mdFile,
    content,
    targetFile: tempFile
  });
  if (state.lastPreviewToken !== token) return;
  const previewUrl = `/${dir}/${slug}/index.html?p=${tempFile}&v=${token}&forceControls=1`;
  previewFrame.src = previewUrl;
  setStatus('Preview updated.');
}

function syncPreviewToEditor() {
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
    if (state.previewSyncing) return;
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
  if (state.dirty) {
    const ok = window.confirm('You have unsaved changes. Re-parse will discard them. Continue?');
    if (!ok) return;
  }
  await loadPresentation();
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

deleteSlideBtn.addEventListener('click', () => {
  deleteCurrentSlide();
});

prevColumnBtn.addEventListener('click', () => {
  goToColumn(state.selected.h - 1);
});

nextColumnBtn.addEventListener('click', () => {
  goToColumn(state.selected.h + 1);
});

addColumnBtn.addEventListener('click', () => {
  addColumnAfterCurrent();
});

deleteColumnBtn.addEventListener('click', () => {
  deleteCurrentColumn();
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

window.addEventListener('storage', (event) => {
  if (!event.key || !pendingAddMedia.has(event.key) || !event.newValue) return;
  let payload;
  try {
    payload = JSON.parse(event.newValue);
  } catch (err) {
    console.warn('Invalid media payload:', err);
    return;
  }
  const pending = pendingAddMedia.get(event.key);
  pendingAddMedia.delete(event.key);
  localStorage.removeItem(event.key);
  if (!payload?.item || !payload?.tag) {
    if (payload?.mode !== 'file') {
      window.alert('Media selection was incomplete.');
      return;
    }
  }
  if (payload?.mode !== 'file') {
    const ok = addMediaToFrontmatter(payload.tag, payload.item);
    if (!ok) return;
  }
  const insertTarget = payload.insertTarget || pending?.insertTarget;
  const snippet = payload?.mode === 'file'
    ? buildFileMarkdown(payload.tagType, payload.encoded || payload.filename)
    : buildMediaMarkdown(payload.tagType, payload.tag);
  if (!snippet) return;
  if (insertTarget === 'top') {
    applyInsertToEditor(topEditorEl, 'top', snippet);
  } else {
    applyInsertToEditor(editorEl, 'body', snippet);
  }
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
