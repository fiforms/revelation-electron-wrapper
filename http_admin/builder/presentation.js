/*
 * Presentation load/save/reparse operations.
 *
 * Sections:
 * - Save
 * - Load
 * - Re-parse from temp preview
 */
import {
  trFormat,
  slug,
  dir,
  mdFile,
  tempFile,
  fileLabel,
  state
} from './context.js';
import { setStatus, setSaveIndicator, setSaveState, updatePresentationPropertiesState } from './app-state.js';
import { extractFrontMatter, parseSlides, createEmptySlide, getNoteSeparatorFromFrontmatter } from './markdown.js';
import { updatePreview } from './preview.js';
import { selectSlide, applyCurrentColumnMarkdown } from './slides.js';
import { getFullMarkdown } from './document.js';

// --- Save ---
async function savePresentation() {
  if (!window.electronAPI?.savePresentationMarkdown) {
    setStatus(tr('Save unavailable outside of Electron.'));
    return false;
  }
  applyCurrentColumnMarkdown();
  const content = getFullMarkdown();
  setSaveIndicator(tr('Saving…'));
  const res = await window.electronAPI.savePresentationMarkdown({
    slug,
    mdFile,
    content
  });
  if (res?.success) {
    state.dirty = false;
    setSaveIndicator(tr('Saved'));
    setSaveState(false);
    updatePresentationPropertiesState();
    setStatus(tr('Presentation saved.'));
    if (state.columnMarkdownMode) {
      await updatePreview({ force: true, silent: true });
    }
    return true;
  } else {
    setSaveIndicator(tr('Save failed'));
  }
  return false;
}

// --- Load ---
async function loadPresentation() {
  if (!slug || !dir) {
    setStatus(tr('Missing presentation metadata.'));
    return;
  }
  const fileUrl = `/${dir}/${slug}/${mdFile}`;
  fileLabel.textContent = `${slug}/${mdFile}`;

  const response = await fetch(fileUrl);
  if (!response.ok) {
    throw new Error(trFormat('Failed to load {path}', { path: fileUrl }));
  }
  const raw = await response.text();
  const { frontmatter, body } = extractFrontMatter(raw);
  state.frontmatter = frontmatter;
  state.noteSeparator = getNoteSeparatorFromFrontmatter(frontmatter);
  state.stacks = parseSlides(body, state.noteSeparator);
  if (!state.stacks.length) {
    state.stacks = [[createEmptySlide()]];
  }
  selectSlide(0, 0);
  setSaveState(false);
  updatePresentationPropertiesState();
  await updatePreview();
  setStatus(tr('Presentation loaded.'));
}

// --- Re-parse from temp preview ---
async function reparseFromFile() {
  if (!window.electronAPI?.savePresentationMarkdown) {
    setStatus(tr('Re-parse unavailable outside of Electron.'));
    return;
  }
  applyCurrentColumnMarkdown();
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
    throw new Error(trFormat('Failed to load {path}', { path: fileUrl }));
  }
  const raw = await response.text();
  const { frontmatter, body } = extractFrontMatter(raw);
  const { h, v } = state.selected;
  state.frontmatter = frontmatter;
  state.noteSeparator = getNoteSeparatorFromFrontmatter(frontmatter);
  state.stacks = parseSlides(body, state.noteSeparator);
  if (!state.stacks.length) {
    state.stacks = [[createEmptySlide()]];
  }
  selectSlide(h, v);
  await updatePreview({ force: true, silent: true });
  setStatus(tr('Slides re-parsed from preview file.'));
}

export { savePresentation, loadPresentation, reparseFromFile };
