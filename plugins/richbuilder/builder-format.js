/**
 * builder-format.js — Editor Formatting Commands and Block Insertions
 *
 * Implements the toolbar's formatting actions that operate on the live
 * contenteditable DOM:
 *
 * - Heading / blockquote / cite: use document.execCommand or direct DOM
 *   manipulation to wrap the current block.
 * - List operations: Tab indent/outdent, checklist toggle, bare-item repair
 *   (the browser sometimes creates bare <li> elements when Enter is pressed
 *   inside a checklist; `fixBareChecklistItems` corrects them).
 * - Two-column insertion: creates a `data-twocol` block as a direct child of
 *   the editor so `htmlToMarkdown` can detect and serialize it.
 */

import { createChecklistLabel } from './builder-markdown.js';

/**
 * applyHeadingTag — Apply a heading level to the current block via execCommand.
 *
 * Uses `document.execCommand('formatBlock', …)` to change the current block
 * element to `H1`–`H5`.  Passing `level === 0` (or any unrecognised value)
 * converts the block back to a plain `<div>`.
 */
export function applyHeadingTag(level) {
  const tag = level === 1
    ? 'H1'
    : level === 2
      ? 'H2'
      : level === 3
        ? 'H3'
        : level === 4
          ? 'H4'
          : level === 5
            ? 'H5'
            : 'DIV';
  document.execCommand('formatBlock', false, tag);
}

/**
 * applyBlockquoteTag — Toggle the current block between `<blockquote>` and `<div>`.
 *
 * If the cursor is already inside a `<blockquote>`, the block is converted
 * back to a plain `<div>`.  Otherwise the current block is wrapped in
 * `<blockquote>`.
 */
export function applyBlockquoteTag() {
  const activeTag = String(document.queryCommandValue('formatBlock') || '').replace(/[<>]/g, '').toLowerCase();
  document.execCommand('formatBlock', false, activeTag === 'blockquote' ? 'DIV' : 'BLOCKQUOTE');
}

/**
 * applyCiteTag — Convert the current block element to a `<cite>` element.
 *
 * Finds the nearest ancestor block element that is inside `editor` and
 * replaces it with a `<cite>` wrapping all its children.  Returns `true` if
 * the conversion was applied (or the cursor was already inside a `<cite>`),
 * `false` if no suitable block was found.
 */
export function applyCiteTag(editor) {
  if (!editor) return false;
  const selection = window.getSelection?.();
  let node = selection?.anchorNode || null;
  if (node && node.nodeType !== Node.ELEMENT_NODE) {
    node = node.parentElement;
  }
  if (!(node instanceof Element)) return false;

  const block = node.closest('cite, div, p, h1, h2, h3, h4, h5');
  if (!(block instanceof Element) || !editor.contains(block)) return false;
  if (block.tagName.toLowerCase() === 'cite') return true;

  const cite = document.createElement('cite');
  while (block.firstChild) {
    cite.appendChild(block.firstChild);
  }
  block.replaceWith(cite);

  const range = document.createRange();
  range.selectNodeContents(cite);
  range.collapse(false);
  selection?.removeAllRanges();
  selection?.addRange(range);
  return true;
}

/**
 * getSelectionListItem — Return the `<li>` ancestor of the current selection.
 *
 * Walks up from the selection anchor node to find the nearest `<li>` element.
 * Returns `null` if the cursor is not inside a list item.
 */
export function getSelectionListItem() {
  const selection = window.getSelection();
  let node = selection?.anchorNode || null;
  if (node && node.nodeType !== Node.ELEMENT_NODE) {
    node = node.parentElement;
  }
  return node && typeof node.closest === 'function' ? node.closest('li') : null;
}

// After the browser auto-creates a new <li> on Enter inside a checklist, that new
// <li> won't have the .richbuilder-check-item label structure.  This pass finds any
// bare <li> elements whose sibling items ARE checklist items and wraps them correctly.
/**
 * fixBareChecklistItems — Repair bare `<li>` elements in a checklist context.
 *
 * When the browser creates a new `<li>` via Enter inside a checklist, the new
 * item lacks the `.richbuilder-check-item` label structure.  This function
 * scans the editor for any bare `<li>` elements whose siblings are checklist
 * items and wraps them with the correct label DOM.  Returns the array of fixed
 * elements (empty if nothing was changed).
 */
export function fixBareChecklistItems(editor) {
  const fixed = [];
  editor.querySelectorAll('ul, ol').forEach((list) => {
    const items = Array.from(list.children).filter((c) => c.tagName.toLowerCase() === 'li');
    const isChecklistContext = items.some((li) => li.querySelector(':scope > .richbuilder-check-item'));
    if (!isChecklistContext) return;

    items.forEach((li) => {
      if (li.querySelector(':scope > .richbuilder-check-item')) return; // already wrapped
      const label = createChecklistLabel('', false);
      const textSpan = label.querySelector('.richbuilder-check-text');
      // Move all existing child nodes into the text span
      while (li.firstChild) textSpan.appendChild(li.firstChild);
      li.appendChild(label);
      li.dataset.checklist = 'true';
      li.dataset.checked = 'false';
      fixed.push(li);
    });
  });
  return fixed;
}

/**
 * handleEditorTabIndent — Handle Tab key presses inside list items.
 *
 * When the cursor is inside an `<li>`, Tab indents the item and Shift+Tab
 * outdents it via `execCommand`.  Returns `true` if the event was handled
 * (and `event.preventDefault()` was called), `false` otherwise.
 */
export function handleEditorTabIndent(event) {
  if (!event || event.key !== 'Tab') return false;
  const activeLi = getSelectionListItem();
  if (!activeLi) return false;
  event.preventDefault();
  if (event.shiftKey) {
    document.execCommand('outdent', false);
  } else {
    document.execCommand('indent', false);
  }
  return true;
}

/**
 * toggleChecklistAtSelection — Toggle or create a checklist item at the cursor.
 *
 * If the cursor is inside an existing `<li>` with a checkbox, the checkbox is
 * toggled.  If the cursor is inside a plain `<li>`, that item is converted to
 * a checklist item.  If the cursor is not inside any list, an unordered list
 * is first created via `execCommand`.
 */
export function toggleChecklistAtSelection(editor) {
  if (!editor) return;
  let li = getSelectionListItem();

  if (!li) {
    document.execCommand('insertUnorderedList', false);
    li = getSelectionListItem();
  }
  if (!li) return;

  const existingInput = li.querySelector(':scope > .richbuilder-check-item > input[type="checkbox"]');
  if (existingInput) {
    existingInput.checked = !existingInput.checked;
    li.dataset.checklist = 'true';
    li.dataset.checked = existingInput.checked ? 'true' : 'false';
    return;
  }

  const nestedLists = Array.from(li.children).filter((child) => {
    const tag = child.tagName?.toLowerCase();
    return tag === 'ul' || tag === 'ol';
  });
  const inlineNodes = Array.from(li.childNodes).filter((child) => !nestedLists.includes(child));

  const label = createChecklistLabel('', false);
  const textSpan = label.querySelector('.richbuilder-check-text');
  inlineNodes.forEach((node) => textSpan.appendChild(node));
  li.insertBefore(label, li.firstChild);
  li.dataset.checklist = 'true';
  li.dataset.checked = 'false';
}

/**
 * insertTwoColumnBlock — Insert a two-column layout block at the cursor.
 *
 * Creates a `data-twocol` div with two `.richbuilder-col` children and inserts
 * it as a direct child of `editor` (walking up from the selection if needed).
 * Places the cursor in the left column after insertion.
 */
export function insertTwoColumnBlock(editor) {
  if (!editor) return;
  editor.focus();
  const emptyCol = '<div><br></div>';
  const template = document.createElement('div');
  template.innerHTML = `<div class="richbuilder-twocol" data-twocol="true"><div class="richbuilder-col" data-col="left">${emptyCol}</div><div class="richbuilder-col" data-col="right">${emptyCol}</div></div>`;
  const twocol = template.firstElementChild;
  // Always insert as a direct child of the editor (same pattern as insertTable).
  let refNode = null;
  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0) {
    let node = selection.getRangeAt(0).commonAncestorContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    while (node && node.parentElement !== editor) node = node.parentElement;
    if (node && node.parentElement === editor) refNode = node;
  }
  if (refNode) {
    editor.insertBefore(twocol, refNode.nextSibling);
  } else {
    editor.appendChild(twocol);
  }
  // Place cursor in left column
  const leftCol = twocol.querySelector('[data-col="left"]');
  if (leftCol) {
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(leftCol);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }
}
