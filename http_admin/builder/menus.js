/*
 * Dropdown menus and slide tools picker.
 *
 * Sections:
 * - Slide tools menu
 * - Table picker
 * - Column/slide menus
 */
import {
  tr,
  trFormat,
  columnMenuBtn,
  columnMenu,
  presentationMenuBtn,
  presentationMenu,
  slideMenuBtn,
  slideMenu,
  slideToolsBtn,
  slideToolsMenu,
  tablePicker,
  tablePickerGrid,
  tablePickerSize
} from './context.js';
import {
  applyTwoColumnLayout,
  applyInsertToEditor,
  applyLinePrefix
} from './editor-actions.js';
import { buildTableMarkdown } from './markdown.js';
import { editorEl } from './context.js';

let activeToolsMenu = null;
let activeToolsButton = null;
let tablePickerSelection = { rows: 0, cols: 0 };
let tablePickerInitialized = false;

// --- Slide tools menu ---
function renderSlideToolsMenu() {
  if (!slideToolsMenu) return;
  slideToolsMenu.innerHTML = '';
  const addItem = (label, onClick) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'builder-dropdown-item';
    item.textContent = label;
    item.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    slideToolsMenu.appendChild(item);
  };

  addItem(tr('2 column layout'), () => {
    closeSlideToolsMenu();
    applyTwoColumnLayout();
  });
  addItem(tr('Table'), () => {
    closeSlideToolsMenu();
    openTablePicker();
  });
  addItem(tr('Link'), () => {
    closeSlideToolsMenu();
    applyInsertToEditor(editorEl, 'body', '[Example](https://www.example.com)');
  });
  addItem(tr('Heading 1'), () => {
    closeSlideToolsMenu();
    applyLinePrefix(editorEl, 'body', '# ');
  });
  addItem(tr('Heading 2'), () => {
    closeSlideToolsMenu();
    applyLinePrefix(editorEl, 'body', '## ');
  });
  addItem(tr('Heading 3'), () => {
    closeSlideToolsMenu();
    applyLinePrefix(editorEl, 'body', '### ');
  });
  addItem(tr('Blockquote'), () => {
    closeSlideToolsMenu();
    applyLinePrefix(editorEl, 'body', '> ');
  });
  addItem(tr('Ordered List'), () => {
    closeSlideToolsMenu();
    applyInsertToEditor(editorEl, 'body', '1. Item one\n2. Item two\n3. Item three');
  });
  addItem(tr('Unordered List'), () => {
    closeSlideToolsMenu();
    applyInsertToEditor(editorEl, 'body', '- Item one\n- Item two\n- Item three');
  });
  addItem(tr('Code Block'), () => {
    closeSlideToolsMenu();
    applyInsertToEditor(editorEl, 'body', '```\ncode\n```');
  });
}

function openSlideToolsMenu() {
  if (!slideToolsMenu || !slideToolsBtn) return;
  closeSlideToolsMenu();
  closeTablePicker();
  renderSlideToolsMenu();
  slideToolsMenu.hidden = false;
  slideToolsBtn.classList.add('is-active');
  activeToolsMenu = slideToolsMenu;
  activeToolsButton = slideToolsBtn;
  document.addEventListener('click', handleSlideToolsOutsideClick);
  document.addEventListener('keydown', handleSlideToolsKeydown);
}

function closeSlideToolsMenu() {
  if (!activeToolsMenu || !activeToolsButton) return;
  activeToolsMenu.hidden = true;
  activeToolsButton.classList.remove('is-active');
  document.removeEventListener('click', handleSlideToolsOutsideClick);
  document.removeEventListener('keydown', handleSlideToolsKeydown);
  activeToolsMenu = null;
  activeToolsButton = null;
}

function handleSlideToolsOutsideClick(event) {
  if (!activeToolsMenu || !activeToolsButton) return;
  if (activeToolsMenu.contains(event.target) || activeToolsButton.contains(event.target)) return;
  closeSlideToolsMenu();
}

function handleSlideToolsKeydown(event) {
  if (event.key === 'Escape') {
    closeSlideToolsMenu();
  }
}

// --- Table picker ---
function setTablePickerSelection(rows, cols) {
  tablePickerSelection = { rows, cols };
  if (tablePickerSize) {
    tablePickerSize.textContent = `${rows} x ${cols}`;
  }
  if (!tablePickerGrid) return;
  tablePickerGrid.querySelectorAll('.builder-table-cell').forEach((cell) => {
    const cellRow = Number(cell.dataset.row || 0);
    const cellCol = Number(cell.dataset.col || 0);
    cell.classList.toggle('is-active', cellRow <= rows && cellCol <= cols);
  });
}

function renderTablePickerGrid(maxRows = 8, maxCols = 8) {
  if (!tablePickerGrid || tablePickerInitialized) return;
  const fragment = document.createDocumentFragment();
  for (let row = 1; row <= maxRows; row += 1) {
    for (let col = 1; col <= maxCols; col += 1) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'builder-table-cell';
      cell.dataset.row = String(row);
      cell.dataset.col = String(col);
      cell.setAttribute('aria-label', trFormat('Select {rows} by {cols} table', { rows: row, cols: col }));
      fragment.appendChild(cell);
    }
  }
  tablePickerGrid.appendChild(fragment);
  tablePickerInitialized = true;
  setTablePickerSelection(0, 0);
}

function openTablePicker() {
  if (!tablePicker) return;
  renderTablePickerGrid();
  tablePicker.hidden = false;
  setTablePickerSelection(0, 0);
  document.addEventListener('click', handleTablePickerOutsideClick);
  document.addEventListener('keydown', handleTablePickerKeydown);
}

function closeTablePicker() {
  if (!tablePicker || tablePicker.hidden) return;
  tablePicker.hidden = true;
  document.removeEventListener('click', handleTablePickerOutsideClick);
  document.removeEventListener('keydown', handleTablePickerKeydown);
}

function handleTablePickerOutsideClick(event) {
  if (!tablePicker || tablePicker.hidden) return;
  if (tablePicker.contains(event.target) || slideToolsBtn?.contains(event.target)) return;
  closeTablePicker();
}

function handleTablePickerKeydown(event) {
  if (event.key === 'Escape') {
    closeTablePicker();
  }
}

// --- Column/slide menus ---
function openColumnMenu() {
  if (!columnMenu || !columnMenuBtn) return;
  columnMenu.hidden = false;
  columnMenuBtn.classList.add('is-active');
  document.addEventListener('click', handleColumnMenuOutsideClick);
  document.addEventListener('keydown', handleColumnMenuKeydown);
}

function closeColumnMenu() {
  if (!columnMenu || !columnMenuBtn) return;
  columnMenu.hidden = true;
  columnMenuBtn.classList.remove('is-active');
  document.removeEventListener('click', handleColumnMenuOutsideClick);
  document.removeEventListener('keydown', handleColumnMenuKeydown);
}

function handleColumnMenuOutsideClick(event) {
  if (!columnMenu || !columnMenuBtn) return;
  if (columnMenu.contains(event.target) || columnMenuBtn.contains(event.target)) return;
  closeColumnMenu();
}

function handleColumnMenuKeydown(event) {
  if (event.key === 'Escape') {
    closeColumnMenu();
  }
}

function openPresentationMenu() {
  if (!presentationMenu || !presentationMenuBtn) return;
  presentationMenu.hidden = false;
  presentationMenuBtn.classList.add('is-active');
  document.addEventListener('click', handlePresentationMenuOutsideClick);
  document.addEventListener('keydown', handlePresentationMenuKeydown);
}

function closePresentationMenu() {
  if (!presentationMenu || !presentationMenuBtn) return;
  presentationMenu.hidden = true;
  presentationMenuBtn.classList.remove('is-active');
  document.removeEventListener('click', handlePresentationMenuOutsideClick);
  document.removeEventListener('keydown', handlePresentationMenuKeydown);
}

function handlePresentationMenuOutsideClick(event) {
  if (!presentationMenu || !presentationMenuBtn) return;
  if (presentationMenu.contains(event.target) || presentationMenuBtn.contains(event.target)) return;
  closePresentationMenu();
}

function handlePresentationMenuKeydown(event) {
  if (event.key === 'Escape') {
    closePresentationMenu();
  }
}

function openSlideMenu() {
  if (!slideMenu || !slideMenuBtn) return;
  slideMenu.hidden = false;
  slideMenuBtn.classList.add('is-active');
  document.addEventListener('click', handleSlideMenuOutsideClick);
  document.addEventListener('keydown', handleSlideMenuKeydown);
}

function closeSlideMenu() {
  if (!slideMenu || !slideMenuBtn) return;
  slideMenu.hidden = true;
  slideMenuBtn.classList.remove('is-active');
  document.removeEventListener('click', handleSlideMenuOutsideClick);
  document.removeEventListener('keydown', handleSlideMenuKeydown);
}

function handleSlideMenuOutsideClick(event) {
  if (!slideMenu || !slideMenuBtn) return;
  if (slideMenu.contains(event.target) || slideMenuBtn.contains(event.target)) return;
  closeSlideMenu();
}

function handleSlideMenuKeydown(event) {
  if (event.key === 'Escape') {
    closeSlideMenu();
  }
}

function handleTablePickerGridClick(event) {
  const cell = event.target.closest('.builder-table-cell');
  if (!cell) return;
  event.preventDefault();
  event.stopPropagation();
  const rows = Number(cell.dataset.row || 0);
  const cols = Number(cell.dataset.col || 0);
  if (rows <= 0 || cols <= 0) return;
  const tableMarkdown = buildTableMarkdown(rows, cols);
  applyInsertToEditor(editorEl, 'body', tableMarkdown);
  closeTablePicker();
}

function handleTablePickerGridMove(event) {
  const cell = event.target.closest('.builder-table-cell');
  if (!cell) return;
  const rows = Number(cell.dataset.row || 0);
  const cols = Number(cell.dataset.col || 0);
  setTablePickerSelection(rows, cols);
}

function handleTablePickerCancel(event) {
  event.preventDefault();
  event.stopPropagation();
  closeTablePicker();
}

export {
  openSlideToolsMenu,
  closeSlideToolsMenu,
  openTablePicker,
  closeTablePicker,
  openColumnMenu,
  closeColumnMenu,
  openPresentationMenu,
  closePresentationMenu,
  openSlideMenu,
  closeSlideMenu,
  handleTablePickerGridClick,
  handleTablePickerGridMove,
  handleTablePickerCancel
};
