/**
 * builder-table.js — Table DOM Operations
 *
 * All structural edits to markdown tables inside the rich editor.
 * Tables are represented as standard `<table><thead><tbody>` HTML; column
 * alignment is stored as `data-align` on each `<th>` / `<td>` and as an
 * inline `style="text-align:..."` so it renders immediately and survives
 * round-trips through `serializeTableToMarkdown`.
 *
 * `insertTable` always attaches the new table as a *direct child* of the
 * editor element (walking up from the cursor if needed) so that
 * `htmlToMarkdown` in builder-serialize.js can detect it at the top level.
 */

/**
 * getSelectionTableCell — Return the `<td>` or `<th>` at the current selection.
 *
 * Walks up from the selection anchor node to find the nearest table cell
 * element.  Returns `null` if the cursor is not inside a cell.
 */
export function getSelectionTableCell() {
  const selection = window.getSelection();
  let node = selection?.anchorNode || null;
  if (node && node.nodeType !== Node.ELEMENT_NODE) node = node.parentElement;
  return node instanceof Element ? node.closest('td, th') : null;
}

/**
 * insertTable — Insert a new 2×2 table at the cursor position.
 *
 * Builds a `<table>` with a `<thead>` (two `<th>` cells) and a `<tbody>` (two
 * rows of two `<td>` cells).  Inserts the table as a direct child of `editor`
 * by walking up from the cursor selection.  Places focus in the first header
 * cell after insertion.
 */
export function insertTable(editor) {
  if (!editor) return;
  const colCount = 2;
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  for (let c = 0; c < colCount; c++) {
    const th = document.createElement('th');
    th.dataset.align = 'left';
    th.textContent = `Header ${c + 1}`;
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  const tbody = document.createElement('tbody');
  for (let r = 0; r < 2; r++) {
    const tr = document.createElement('tr');
    for (let c = 0; c < colCount; c++) {
      const td = document.createElement('td');
      td.innerHTML = '<br>';
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(thead);
  table.appendChild(tbody);
  // Always insert as a direct child of the editor so htmlToMarkdown can detect it.
  // Walk up from the cursor to find the direct-child-of-editor block, then insert after it.
  let refNode = null;
  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0) {
    let node = selection.getRangeAt(0).commonAncestorContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    while (node && node.parentElement !== editor) node = node.parentElement;
    if (node && node.parentElement === editor) refNode = node;
  }
  if (refNode) {
    editor.insertBefore(table, refNode.nextSibling);
  } else {
    editor.appendChild(table);
  }
  const firstTh = table.querySelector('th');
  if (firstTh) {
    const sel = window.getSelection();
    const r = document.createRange();
    r.selectNodeContents(firstTh);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  }
}

/**
 * addTableRowAfter — Append a new row after the currently focused row.
 *
 * Finds the focused cell's parent row and inserts a new row of empty `<td>`
 * cells immediately after it in the `<tbody>`.  Places focus in the first
 * cell of the new row.  Returns `false` if no cell is focused.
 */
export function addTableRowAfter() {
  const cell = getSelectionTableCell();
  if (!cell) return false;
  const table = cell.closest('table');
  if (!table) return false;
  const headerRow = table.querySelector('thead tr');
  const colCount = headerRow ? headerRow.querySelectorAll('th, td').length : 1;
  const newRow = document.createElement('tr');
  for (let c = 0; c < colCount; c++) {
    const td = document.createElement('td');
    td.innerHTML = '<br>';
    newRow.appendChild(td);
  }
  const tbody = table.querySelector('tbody') || table;
  const currentRow = cell.closest('tbody tr');
  if (currentRow && currentRow.parentNode === tbody) {
    tbody.insertBefore(newRow, currentRow.nextSibling);
  } else {
    tbody.appendChild(newRow);
  }
  const firstCell = newRow.querySelector('td');
  if (firstCell) {
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(firstCell);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }
  return true;
}

/**
 * addTableColumnAfter — Append a new column after the currently focused column.
 *
 * Determines the column index from the focused cell, then inserts a new
 * `<th>` (in the header row) or `<td>` (in body rows) after that column
 * index in every row.  Returns `false` if no cell is focused.
 */
export function addTableColumnAfter() {
  const cell = getSelectionTableCell();
  if (!cell) return false;
  const table = cell.closest('table');
  if (!table) return false;
  const currentRow = cell.parentElement;
  const colIndex = Array.from(currentRow.querySelectorAll('td, th')).indexOf(cell);
  Array.from(table.querySelectorAll('tr')).forEach((row) => {
    const isHeaderRow = !!row.closest('thead');
    const cells = Array.from(row.querySelectorAll('td, th'));
    const newCell = document.createElement(isHeaderRow ? 'th' : 'td');
    if (isHeaderRow) {
      newCell.dataset.align = 'left';
      newCell.textContent = `Header ${colIndex + 2}`;
    } else {
      newCell.innerHTML = '<br>';
    }
    const afterCell = cells[colIndex];
    if (afterCell) {
      row.insertBefore(newCell, afterCell.nextSibling);
    } else {
      row.appendChild(newCell);
    }
  });
  return true;
}

/**
 * deleteTableRow — Delete the currently focused body row.
 *
 * Refuses to delete the last remaining body row (a table must have at least
 * one data row).  Moves focus to an adjacent row after deletion.  Returns
 * `false` if no body row is focused or deletion is refused.
 */
export function deleteTableRow() {
  const cell = getSelectionTableCell();
  if (!cell) return false;
  const row = cell.closest('tbody tr');
  if (!row) return false;
  const table = cell.closest('table');
  if (table.querySelectorAll('tbody tr').length <= 1) return false;
  const sibling = row.nextElementSibling || row.previousElementSibling;
  row.remove();
  if (sibling) {
    const nextCell = sibling.querySelector('td, th');
    if (nextCell) {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(nextCell);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }
  return true;
}

/**
 * deleteTableColumn — Delete the column containing the focused cell.
 *
 * Refuses to delete the last remaining column.  Removes the cell at the same
 * column index from every row in the table.  Returns `false` if no cell is
 * focused or deletion is refused.
 */
export function deleteTableColumn() {
  const cell = getSelectionTableCell();
  if (!cell) return false;
  const table = cell.closest('table');
  if (!table) return false;
  const headerCells = table.querySelectorAll('thead tr th, thead tr td');
  if (headerCells.length <= 1) return false;
  const currentRow = cell.parentElement;
  const colIndex = Array.from(currentRow.querySelectorAll('td, th')).indexOf(cell);
  Array.from(table.querySelectorAll('tr')).forEach((row) => {
    const cells = Array.from(row.querySelectorAll('td, th'));
    if (cells[colIndex]) cells[colIndex].remove();
  });
  return true;
}

/**
 * deleteTable — Remove the entire table containing the focused cell.
 *
 * Returns `false` if the cursor is not inside a table cell.
 */
export function deleteTable() {
  const cell = getSelectionTableCell();
  if (!cell) return false;
  const table = cell.closest('table');
  if (!table) return false;
  table.remove();
  return true;
}

/**
 * alignTableColumn — Set the text alignment for the focused column.
 *
 * Applies `data-align` and `style.textAlign` to every cell (header and body)
 * in the focused column.  `alignment` should be `'left'`, `'center'`, or
 * `'right'`.  Returns `false` if no cell is focused.
 */
export function alignTableColumn(alignment) {
  const cell = getSelectionTableCell();
  if (!cell) return false;
  const table = cell.closest('table');
  if (!table) return false;
  const currentRow = cell.parentElement;
  const colIndex = Array.from(currentRow.querySelectorAll('td, th')).indexOf(cell);
  Array.from(table.querySelectorAll('tr')).forEach((row) => {
    const cells = Array.from(row.querySelectorAll('td, th'));
    const target = cells[colIndex];
    if (!target) return;
    target.dataset.align = alignment;
    target.style.textAlign = alignment;
  });
  return true;
}

/**
 * navigateTableCell — Move the cursor to the next or previous table cell.
 *
 * Used by the Tab key handler to move forward (Tab) or backward (Shift+Tab)
 * through the cells of a table.  Does nothing if the cursor is already at the
 * first or last cell.
 */
export function navigateTableCell(cell, backwards) {
  const table = cell.closest('table');
  if (!table) return;
  const cells = Array.from(table.querySelectorAll('th, td'));
  const idx = cells.indexOf(cell);
  const nextIdx = backwards ? idx - 1 : idx + 1;
  if (nextIdx < 0 || nextIdx >= cells.length) return;
  const target = cells[nextIdx];
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(target);
  range.collapse(!backwards);
  sel.removeAllRanges();
  sel.addRange(range);
}
