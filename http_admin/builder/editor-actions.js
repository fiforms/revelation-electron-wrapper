/*
 * Editor insert/replace utilities for slide and top-matter editors.
 *
 * Sections:
 * - Core insert/replace helpers
 * - Layout/format helpers
 * - Macro/background helpers
 */
import { editorEl, topEditorEl, state } from './context.js';
import { markDirty } from './app-state.js';
import { schedulePreviewUpdate } from './preview.js';
import { renderSlideList } from './slides.js';
import { buildTwoColumnLayout } from './markdown.js';

// --- Core insert/replace helpers ---
// Insert text at the current selection with newline padding when needed.
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

// Replace a range with new content and move the caret to the end.
function applyReplacementToEditor(editor, field, start, end, insertText) {
  if (!editor) return;
  const value = editor.value || '';
  const safeStart = Math.max(0, Math.min(start, value.length));
  const safeEnd = Math.max(safeStart, Math.min(end, value.length));
  const nextValue = `${value.slice(0, safeStart)}${insertText}${value.slice(safeEnd)}`;
  editor.value = nextValue;
  const caret = safeStart + insertText.length;
  editor.selectionStart = caret;
  editor.selectionEnd = caret;
  const { h, v } = state.selected;
  state.stacks[h][v][field] = nextValue;
  markDirty();
  if (field === 'body') {
    renderSlideList();
  }
  schedulePreviewUpdate();
}

// Ensure the current line starts with a prefix (preserving indentation).
function applyLinePrefix(editor, field, prefix) {
  if (!editor || !prefix) return;
  const value = editor.value || '';
  const caret = editor.selectionStart ?? 0;
  const lineStart = value.lastIndexOf('\n', Math.max(caret - 1, 0)) + 1;
  const lineEndIndex = value.indexOf('\n', caret);
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
  const line = value.slice(lineStart, lineEnd);
  if (line.trim().startsWith(prefix.trim())) return;
  const leadingWhitespace = line.match(/^\s*/) ? line.match(/^\s*/)[0] : '';
  const insertAt = lineStart + leadingWhitespace.length;
  applyReplacementToEditor(editor, field, insertAt, insertAt, prefix);
}

// --- Layout/format helpers ---
// Build a two-column snippet using the existing content as the left column.
function buildTwoColumnLayoutForEditor(content) {
  return buildTwoColumnLayout(content);
}

// Apply two-column layout to the selection or entire editor body.
function applyTwoColumnLayout() {
  if (!editorEl) return;
  const { value, selectionStart, selectionEnd } = editorEl;
  const hasSelection = selectionStart !== selectionEnd;
  const baseContent = hasSelection ? value.slice(selectionStart, selectionEnd) : value;
  const layout = buildTwoColumnLayoutForEditor(baseContent);
  if (hasSelection) {
    applyReplacementToEditor(editorEl, 'body', selectionStart, selectionEnd, layout);
    return;
  }
  if (value.trim()) {
    applyReplacementToEditor(editorEl, 'body', 0, value.length, layout);
    return;
  }
  applyInsertToEditor(editorEl, 'body', layout);
}

// --- Macro/background helpers ---
// Remove background image lines while preserving selection offsets.
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

// Insert a background macro after stripping previous background lines.
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

// Remove macro lines with matching prefixes, tracking selection offsets.
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

// Insert top-matter macros (light/dark bg, lower/upper third), replacing existing.
function applyMacroInsertToTopEditor(macro) {
  if (!topEditorEl || !macro) return;

  // Here we re-use the stripMacroLines function to remove mutually exclusive macros.
  const macroPrefixes = 
    macro === '{{lightbg}}' || macro === '{{darkbg}}' || macro === '{{lighttext}}' || macro === '{{darktext}}'
          ? ['{{lightbg}}', '{{darkbg}}', '{{lighttext}}', '{{darktext}}']
    : macro === '{{lowerthird}}' || macro === '{{upperthird}}'
          ? ['{{lowerthird}}', '{{upperthird}}']
    : macro === '{{shiftleft}}' || macro === '{{shiftright}}'
          ? ['{{shiftleft}}', '{{shiftright}}']
    : [];
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

// Insert a background tint macro, replacing existing tint if present.
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

// Insert an audio macro, replacing any existing audio macro.
function applyAudioMacroToTopEditor(macro) {
  if (!topEditorEl || !macro) return;
  const cleaned = stripMacroLines(
    topEditorEl.value,
    topEditorEl.selectionStart,
    topEditorEl.selectionEnd,
    ['{{audio:']
  );
  if (cleaned.text !== topEditorEl.value) {
    topEditorEl.value = cleaned.text;
    topEditorEl.selectionStart = cleaned.selectionStart;
    topEditorEl.selectionEnd = cleaned.selectionEnd;
  }
  applyInsertToEditor(topEditorEl, 'top', macro);
}

export {
  applyInsertToEditor,
  applyReplacementToEditor,
  applyLinePrefix,
  applyTwoColumnLayout,
  stripBackgroundLines,
  applyBackgroundInsertToEditor,
  stripMacroLines,
  applyMacroInsertToTopEditor,
  applyBgtintInsertToTopEditor,
  applyAudioMacroToTopEditor
};
