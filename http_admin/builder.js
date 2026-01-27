const statusText = document.getElementById('status-text');
const saveIndicator = document.getElementById('save-indicator');
const slideListEl = document.getElementById('slide-list');
const editorEl = document.getElementById('slide-editor');
const previewFrame = document.getElementById('preview-frame');
const saveBtn = document.getElementById('save-btn');
const refreshBtn = document.getElementById('refresh-btn');
const fileLabel = document.getElementById('builder-file');
const addSlideBtn = document.getElementById('add-slide-btn');
const deleteSlideBtn = document.getElementById('delete-slide-btn');
const prevColumnBtn = document.getElementById('prev-column-btn');
const nextColumnBtn = document.getElementById('next-column-btn');
const addColumnBtn = document.getElementById('add-column-btn');
const deleteColumnBtn = document.getElementById('delete-column-btn');
const columnLabel = document.getElementById('column-label');

const urlParams = new URLSearchParams(window.location.search);
const slug = urlParams.get('slug');
const mdFile = urlParams.get('md') || 'presentation.md';
const dir = urlParams.get('dir');
const tempFile = '__builder_temp.md';

const state = {
  frontmatter: '',
  stacks: [],
  selected: { h: 0, v: 0 },
  dirty: false,
  lastPreviewToken: 0
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
      chunks.push([]);
    } else {
      chunks[chunks.length - 1].push(line);
    }
  }
  return chunks.map((chunk) => chunk.join('\n'));
}

function parseSlides(body) {
  const horizontal = splitByMarkerLines(body, '***');
  return horizontal.map((h) => splitByMarkerLines(h, '---'));
}

function joinSlides(stacks) {
  return stacks
    .map((vertical) => vertical.join('\n---\n'))
    .join('\n***\n');
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
    title.textContent = titleFromSlide(slide);

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
  const column = state.stacks[safeH] || [''];
  const maxV = Math.max(column.length - 1, 0);
  const safeV = Math.min(Math.max(vIndex, 0), maxV);
  state.selected = { h: hIndex, v: vIndex };
  state.selected.h = safeH;
  state.selected.v = safeV;
  editorEl.value = state.stacks[safeH][safeV] ?? '';
  renderSlideList();
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

function addSlideAfterCurrent() {
  const { h, v } = state.selected;
  if (!state.stacks[h]) return;
  state.stacks[h].splice(v + 1, 0, '');
  selectSlide(h, v + 1);
  renderSlideList();
  markDirty();
  schedulePreviewUpdate();
}

function deleteCurrentSlide() {
  const { h, v } = state.selected;
  if (!state.stacks[h]) return;
  if (state.stacks.length === 1 && state.stacks[h].length === 1) {
    state.stacks[0][0] = '';
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
  state.stacks.splice(h + 1, 0, ['']);
  selectSlide(h + 1, 0);
  renderSlideList();
  markDirty();
  schedulePreviewUpdate();
}

function deleteCurrentColumn() {
  const { h } = state.selected;
  if (state.stacks.length === 1) {
    state.stacks[0] = [''];
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
  const previewUrl = `/${dir}/${slug}/index.html?p=${tempFile}&v=${token}`;
  previewFrame.src = previewUrl;
  setStatus('Preview updated.');
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
    state.stacks = [['']];
  }
  selectSlide(0, 0);
  setSaveState(false);
  await updatePreview();
  setStatus('Presentation loaded.');
}

editorEl.addEventListener('input', () => {
  const { h, v } = state.selected;
  state.stacks[h][v] = editorEl.value;
  markDirty();
  renderSlideList();
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

loadPresentation().catch((err) => {
  console.error(err);
  setStatus(`Error: ${err.message}`);
});

window.addEventListener('beforeunload', (event) => {
  if (window.electronAPI?.cleanupPresentationTemp) {
    window.electronAPI.cleanupPresentationTemp({ slug, tempFile }).catch((err) => {
      console.warn('Failed to remove temp file:', err);
    });
  }
});

window.__builderGetDirty = () => !!state.dirty;
