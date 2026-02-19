/*
 * Shared builder context.
 *
 * Sections:
 * - Translation helpers
 * - DOM references
 * - URL params + shared state
 */
import { pluginLoader } from '/js/pluginloader.js';

if (!window.translationsources) {
  window.translationsources = [];
}
window.translationsources.push('/admin/locales/translations.json');

// --- Translation helpers ---
const trFormat = (key, vars = {}) =>
  tr(key).replace(/\{(\w+)\}/g, (match, token) =>
    Object.prototype.hasOwnProperty.call(vars, token) ? vars[token] : match
  );

// --- DOM references ---
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
const variantMenuBtn = document.getElementById('variant-menu-btn');
const variantMenu = document.getElementById('variant-menu');
const presentationMenuBtn = document.getElementById('presentation-menu-btn');
const presentationMenu = document.getElementById('presentation-menu');
const presentationPropertiesBtn = document.getElementById('presentation-properties-btn');
const presentationShowBtn = document.getElementById('presentation-show-btn');
const presentationShowFullBtn = document.getElementById('presentation-show-full-btn');
const recordSlideTimingsBtn = document.getElementById('record-slide-timings-btn');
const editExternalBtn = document.getElementById('edit-external-btn');
const openPresentationFolderBtn = document.getElementById('open-presentation-folder-btn');
const reparseBtn = document.getElementById('reparse-btn');
const fileLabel = document.getElementById('builder-file');
const addSlideBtn = document.getElementById('add-slide-btn');
const combineColumnBtn = document.getElementById('combine-column-btn');
const deleteSlideBtn = document.getElementById('delete-slide-btn');
const prevColumnBtn = document.getElementById('prev-column-btn');
const nextColumnBtn = document.getElementById('next-column-btn');
const slideMenuBtn = document.getElementById('slide-menu-btn');
const slideMenu = document.getElementById('slide-menu');
const slideAddMenuItem = document.getElementById('slide-add-menu-item');
const slideDuplicateMenuItem = document.getElementById('slide-duplicate-menu-item');
const slideCombineMenuItem = document.getElementById('slide-combine-menu-item');
const slideDeleteMenuItem = document.getElementById('slide-delete-menu-item');
const slideMoveUpMenuItem = document.getElementById('slide-move-up-menu-item');
const slideMoveDownMenuItem = document.getElementById('slide-move-down-menu-item');
const columnMarkdownBtn = document.getElementById('column-md-btn');
const addColumnBtn = document.getElementById('add-column-btn');
const deleteColumnBtn = document.getElementById('delete-column-btn');
const columnMenuBtn = document.getElementById('column-menu-btn');
const columnMenu = document.getElementById('column-menu');
const columnAddMenuItem = document.getElementById('column-add-menu-item');
const columnDeleteMenuItem = document.getElementById('column-delete-menu-item');
const columnMoveLeftMenuItem = document.getElementById('column-move-left-menu-item');
const columnMoveRightMenuItem = document.getElementById('column-move-right-menu-item');
const columnLabel = document.getElementById('column-label');
const slideCountLabel = document.getElementById('slide-count-label');
const previewSlideBtn = document.getElementById('preview-slide-btn');
const previewOverviewBtn = document.getElementById('preview-overview-btn');
const collapsiblePanels = document.querySelectorAll('.panel-collapsible');
const topMatterIndicatorEl = document.getElementById('topmatter-indicator');
const addTopImageBtn = document.getElementById('add-top-image-btn');
const addSlideImageBtn = document.getElementById('add-slide-image-btn');
const addTopMediaBtn = document.getElementById('add-top-media-btn');
const addSlideMediaBtn = document.getElementById('add-slide-media-btn');
const addTopMediaMenu = document.getElementById('add-top-media-menu');
const addSlideMediaMenu = document.getElementById('add-slide-media-menu');
const addSlideAudioBtn = document.getElementById('add-slide-audio-btn');
const addSlideAudioMenu = document.getElementById('add-slide-audio-menu');
const addTopFormatBtn = document.getElementById('add-top-format-btn');
const addTopFormatMenu = document.getElementById('add-top-format-menu');
const addSlideFormatBtn = document.getElementById('add-slide-format-btn');
const addSlideFormatMenu = document.getElementById('add-slide-format-menu');
const addTopTintBtn = document.getElementById('add-top-tint-btn');
const addTopTintMenu = document.getElementById('add-top-tint-menu');
const columnMarkdownPanel = document.getElementById('column-markdown-panel');
const columnMarkdownEditor = document.getElementById('column-markdown-editor');
const slideToolsBtn = document.getElementById('slide-tools-btn');
const slideToolsMenu = document.getElementById('slide-tools-menu');
const tablePicker = document.getElementById('table-picker');
const tablePickerGrid = document.getElementById('table-picker-grid');
const tablePickerSize = document.getElementById('table-picker-size');
const tablePickerCancel = document.getElementById('table-picker-cancel');

// --- URL params + shared state ---
const urlParams = new URLSearchParams(window.location.search);
const slug = urlParams.get('slug');
const mdFile = urlParams.get('md') || 'presentation.md';
const dir = urlParams.get('dir');
const tempFile = '__builder_temp.md';
const pendingAddMedia = new Map();
const pendingContentInsert = new Map();

const state = {
  frontmatter: '',
  noteSeparator: ':note:',
  stacks: [],
  selected: { h: 0, v: 0 },
  dirty: false,
  columnMarkdownMode: false,
  columnMarkdownColumn: 0,
  previewReady: false,
  previewSyncing: false,
  previewPoller: null,
  timingRecorder: null,
  recordedSlideTimings: []
};

export {
  pluginLoader,
  trFormat,
  statusText,
  saveIndicator,
  slideListEl,
  editorEl,
  topEditorEl,
  notesEditorEl,
  previewFrame,
  saveBtn,
  addContentBtn,
  addContentMenu,
  variantMenuBtn,
  variantMenu,
  presentationMenuBtn,
  presentationMenu,
  presentationPropertiesBtn,
  presentationShowBtn,
  presentationShowFullBtn,
  recordSlideTimingsBtn,
  editExternalBtn,
  openPresentationFolderBtn,
  reparseBtn,
  fileLabel,
  addSlideBtn,
  combineColumnBtn,
  deleteSlideBtn,
  prevColumnBtn,
  nextColumnBtn,
  slideMenuBtn,
  slideMenu,
  slideAddMenuItem,
  slideDuplicateMenuItem,
  slideCombineMenuItem,
  slideDeleteMenuItem,
  slideMoveUpMenuItem,
  slideMoveDownMenuItem,
  columnMarkdownBtn,
  addColumnBtn,
  deleteColumnBtn,
  columnMenuBtn,
  columnMenu,
  columnAddMenuItem,
  columnDeleteMenuItem,
  columnMoveLeftMenuItem,
  columnMoveRightMenuItem,
  columnLabel,
  slideCountLabel,
  previewSlideBtn,
  previewOverviewBtn,
  collapsiblePanels,
  topMatterIndicatorEl,
  addTopImageBtn,
  addSlideImageBtn,
  addTopMediaBtn,
  addSlideMediaBtn,
  addTopMediaMenu,
  addSlideMediaMenu,
  addSlideAudioBtn,
  addSlideAudioMenu,
  addTopFormatBtn,
  addTopFormatMenu,
  addSlideFormatBtn,
  addSlideFormatMenu,
  addTopTintBtn,
  addTopTintMenu,
  columnMarkdownPanel,
  columnMarkdownEditor,
  slideToolsBtn,
  slideToolsMenu,
  tablePicker,
  tablePickerGrid,
  tablePickerSize,
  tablePickerCancel,
  urlParams,
  slug,
  mdFile,
  dir,
  tempFile,
  pendingAddMedia,
  pendingContentInsert,
  state
};
