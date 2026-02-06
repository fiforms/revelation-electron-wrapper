/*
 * Event wiring for builder UI interactions.
 *
 * Sections:
 * - Editor input handlers
 * - Button/menu handlers
 * - Storage listeners
 * - Collapsible panels
 * - Keyboard shortcuts
 * - Translation watcher + init
 */
import {
  trFormat,
  editorEl,
  topEditorEl,
  notesEditorEl,
  addSlideBtn,
  columnMarkdownBtn,
  columnMarkdownEditor,
  combineColumnBtn,
  deleteSlideBtn,
  prevColumnBtn,
  nextColumnBtn,
  addColumnBtn,
  deleteColumnBtn,
  columnMenuBtn,
  columnMenu,
  slideMenuBtn,
  slideMenu,
  slideAddMenuItem,
  slideDuplicateMenuItem,
  slideCombineMenuItem,
  slideDeleteMenuItem,
  slideMoveUpMenuItem,
  slideMoveDownMenuItem,
  columnAddMenuItem,
  columnDeleteMenuItem,
  columnMoveLeftMenuItem,
  columnMoveRightMenuItem,
  previewSlideBtn,
  previewOverviewBtn,
  saveBtn,
  addContentBtn,
  addContentMenu,
  slideToolsBtn,
  slideToolsMenu,
  presentationMenuBtn,
  presentationMenu,
  presentationPropertiesBtn,
  editExternalBtn,
  presentationShowBtn,
  presentationShowFullBtn,
  openPresentationFolderBtn,
  reparseBtn,
  previewFrame,
  addTopImageBtn,
  addSlideImageBtn,
  addTopMediaBtn,
  addSlideMediaBtn,
  addSlideAudioBtn,
  addTopFormatBtn,
  addSlideFormatBtn,
  addTopTintBtn,
  addTopMediaMenu,
  addSlideMediaMenu,
  addSlideAudioMenu,
  addTopFormatMenu,
  addSlideFormatMenu,
  addTopTintMenu,
  tablePickerGrid,
  tablePickerCancel,
  collapsiblePanels,
  slug,
  mdFile,
  tempFile,
  state
} from './context.js';
import {
  markDirty,
  setStatus,
  setSaveIndicator,
  updatePresentationPropertiesState,
  updateEditExternalState,
  updateOpenFolderState
} from './app-state.js';
import {
  expandSlidesPanel,
  expandTopMatterPanel,
  updateTopMatterIndicator,
  renderSlideList,
  selectSlide,
  addSlideAfterCurrent,
  enterColumnMarkdownMode,
  exitColumnMarkdownMode,
  combineColumnWithPrevious,
  breakColumnAtCurrentSlide,
  deleteCurrentSlide,
  moveSlide,
  handleAddColumn,
  handleDeleteColumn,
  setColumnMarkdownColumn,
  goToColumn,
  moveColumn,
  duplicateCurrentSlide,
  breakCurrentSlide,
  addMarkdownLineBreak,
  getPreviewDeck,
  isEditableTarget
} from './slides.js';
import {
  openColumnMenu,
  closeColumnMenu,
  openPresentationMenu,
  closePresentationMenu,
  openSlideMenu,
  closeSlideMenu,
  closeTablePicker,
  openSlideToolsMenu,
  closeSlideToolsMenu,
  handleTablePickerGridClick,
  handleTablePickerGridMove,
  handleTablePickerCancel
} from './menus.js';
import { openAddContentMenu, closeAddContentMenu, updateAddContentState, loadContentCreators, handleContentInsertStorage } from './content.js';
import {
  openAddMediaDialog,
  openMediaMenu,
  closeMediaMenu,
  openAudioMenu,
  closeAudioMenu,
  openFormatMenu,
  closeFormatMenu,
  openTintMenu,
  closeTintMenu,
  handleAddMediaStorage
} from './media.js';
import { startPreviewPolling, schedulePreviewUpdate } from './preview.js';
import { savePresentation, loadPresentation, reparseFromFile } from './presentation.js';
import { applyStaticLabels } from './labels.js';

function closeAllBuilderMenus() {
  closeColumnMenu();
  closeSlideMenu();
  closePresentationMenu();
  closeSlideToolsMenu();
  closeTablePicker();
  closeAddContentMenu();
  closeMediaMenu();
  closeAudioMenu();
  closeFormatMenu();
  closeTintMenu();
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

// --- Editor input handlers ---
// Trigger save with consistent error handling.
function triggerSave() {
  savePresentation().catch((err) => {
    console.error(err);
    setSaveIndicator(tr('Save failed'));
    setStatus(trFormat('Save failed: {message}', { message: err.message }));
  });
}

// Wire text editor input events.
function setupEditorHandlers() {
  editorEl.addEventListener('input', () => {
    const { h, v } = state.selected;
    state.stacks[h][v].body = editorEl.value;
    markDirty();
    renderSlideList();
    schedulePreviewUpdate(800);
  });

  topEditorEl.addEventListener('input', () => {
    const { h, v } = state.selected;
    state.stacks[h][v].top = topEditorEl.value;
    markDirty();
    schedulePreviewUpdate(800);
    updateTopMatterIndicator();
    renderSlideList();
  });

  notesEditorEl.addEventListener('input', () => {
    const { h, v } = state.selected;
    state.stacks[h][v].notes = notesEditorEl.value;
    markDirty();
  });

  if (columnMarkdownEditor) {
    columnMarkdownEditor.addEventListener('input', () => {
      markDirty();
    });
  }
}

// --- Button/menu handlers ---
// Wire all toolbar and menu click handlers.
function setupButtonHandlers() {
  if (addSlideBtn) {
    addSlideBtn.addEventListener('click', () => {
      expandSlidesPanel();
      addSlideAfterCurrent();
    });
  }

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

  if (deleteSlideBtn) {
    deleteSlideBtn.addEventListener('click', () => {
      deleteCurrentSlide();
    });
  }

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

  if (addColumnBtn) {
    addColumnBtn.addEventListener('click', () => {
      handleAddColumn();
    });
  }

  if (deleteColumnBtn) {
    deleteColumnBtn.addEventListener('click', () => {
      handleDeleteColumn();
    });
  }

  if (columnMenuBtn) {
    columnMenuBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!columnMenu) return;
      if (columnMenu.hidden) {
        closeAllBuilderMenus();
        openColumnMenu();
      } else {
        closeColumnMenu();
      }
    });
  }

  if (slideMenuBtn) {
    slideMenuBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!slideMenu) return;
      if (slideMenu.hidden) {
        closeAllBuilderMenus();
        openSlideMenu();
      } else {
        closeSlideMenu();
      }
    });
  }

  if (slideAddMenuItem) {
    slideAddMenuItem.addEventListener('click', () => {
      if (slideAddMenuItem.classList.contains('is-disabled')) return;
      expandSlidesPanel();
      addSlideAfterCurrent();
      closeSlideMenu();
    });
  }

  if (slideDuplicateMenuItem) {
    slideDuplicateMenuItem.addEventListener('click', () => {
      if (slideDuplicateMenuItem.classList.contains('is-disabled')) return;
      expandSlidesPanel();
      duplicateCurrentSlide();
      closeSlideMenu();
    });
  }

  if (slideCombineMenuItem) {
    slideCombineMenuItem.addEventListener('click', () => {
      if (slideCombineMenuItem.classList.contains('is-disabled')) return;
      if (state.selected.v === 0) {
        combineColumnWithPrevious();
      } else {
        breakColumnAtCurrentSlide();
      }
      closeSlideMenu();
    });
  }

  if (slideDeleteMenuItem) {
    slideDeleteMenuItem.addEventListener('click', () => {
      if (slideDeleteMenuItem.classList.contains('is-disabled')) return;
      deleteCurrentSlide();
      closeSlideMenu();
    });
  }

  if (slideMoveUpMenuItem) {
    slideMoveUpMenuItem.addEventListener('click', () => {
      if (slideMoveUpMenuItem.classList.contains('is-disabled')) return;
      moveSlide(-1);
      closeSlideMenu();
    });
  }

  if (slideMoveDownMenuItem) {
    slideMoveDownMenuItem.addEventListener('click', () => {
      if (slideMoveDownMenuItem.classList.contains('is-disabled')) return;
      moveSlide(1);
      closeSlideMenu();
    });
  }

  if (columnAddMenuItem) {
    columnAddMenuItem.addEventListener('click', () => {
      handleAddColumn();
      closeColumnMenu();
    });
  }

  if (columnDeleteMenuItem) {
    columnDeleteMenuItem.addEventListener('click', () => {
      handleDeleteColumn();
      closeColumnMenu();
    });
  }

  if (columnMoveLeftMenuItem) {
    columnMoveLeftMenuItem.addEventListener('click', () => {
      if (columnMoveLeftMenuItem.classList.contains('is-disabled')) return;
      moveColumn(-1);
      closeColumnMenu();
    });
  }

  if (columnMoveRightMenuItem) {
    columnMoveRightMenuItem.addEventListener('click', () => {
      if (columnMoveRightMenuItem.classList.contains('is-disabled')) return;
      moveColumn(1);
      closeColumnMenu();
    });
  }

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
      setSaveIndicator(tr('Save failed'));
      setStatus(trFormat('Save failed: {message}', { message: err.message }));
    });
  });

  if (addContentBtn) {
    addContentBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (addContentMenu?.hidden) {
        closeAllBuilderMenus();
        openAddContentMenu();
      } else {
        closeAddContentMenu();
      }
    });
  }

  if (presentationMenuBtn) {
    presentationMenuBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (presentationMenu?.hidden) {
        closeAllBuilderMenus();
        openPresentationMenu();
      } else {
        closePresentationMenu();
      }
    });
  }

  if (slideToolsBtn) {
    slideToolsBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (slideToolsMenu?.hidden) {
        closeAllBuilderMenus();
        openSlideToolsMenu();
      } else {
        closeSlideToolsMenu();
      }
    });
  }

  if (presentationPropertiesBtn) {
    presentationPropertiesBtn.addEventListener('click', () => {
      if (presentationPropertiesBtn.disabled) return;
      closePresentationMenu();
      if (!window.electronAPI?.editPresentationMetadata) {
        window.alert(tr('Presentation Properties is only available in the desktop app.'));
        return;
      }
      if (!slug || !mdFile) {
        window.alert(tr('Missing presentation metadata.'));
        return;
      }
      window.electronAPI.editPresentationMetadata(slug, mdFile)
        .then(() => {
          window.close();
        })
        .catch((err) => {
          console.error(err);
          window.alert(trFormat('Failed to open presentation properties: {message}', { message: err.message }));
        });
    });
  }

  function showPresentation(fullscreen) {
    closePresentationMenu();
    if (!window.electronAPI?.openPresentation) {
      window.alert(tr('Show Presentation is only available in the desktop app.'));
      return;
    }
    if (!slug || !mdFile) {
      window.alert(tr('Missing presentation metadata.'));
      return;
    }
    window.electronAPI.openPresentation(slug, mdFile, fullscreen).catch((err) => {
      console.error(err);
      window.alert(trFormat('Failed to show presentation: {message}', { message: err.message }));
    });
  }

  if (presentationShowBtn) {
    presentationShowBtn.addEventListener('click', () => {
      showPresentation(false);
    });
  }

  if (presentationShowFullBtn) {
    presentationShowFullBtn.addEventListener('click', () => {
      showPresentation(true);
    });
  }

  if (editExternalBtn) {
    editExternalBtn.addEventListener('click', async () => {
      if (editExternalBtn.disabled) return;
      closePresentationMenu();
      if (!window.electronAPI?.editPresentation || !window.electronAPI?.openPresentation) {
        window.alert(tr('Edit External is only available in the desktop app.'));
        return;
      }
      if (!slug || !mdFile) {
        window.alert(tr('Missing presentation metadata.'));
        return;
      }
      const saved = await savePresentation();
      if (!saved) return;
      window.electronAPI.editPresentation(slug, mdFile).catch((err) => {
        console.error(err);
        setStatus(trFormat('External editor failed: {message}', { message: err.message || err }));
      });
      window.electronAPI.openPresentation(slug, mdFile, false).catch((err) => {
        console.error(err);
        setStatus(trFormat('Preview window failed: {message}', { message: err.message || err }));
      });
      window.close();
    });
  }

  if (openPresentationFolderBtn) {
    openPresentationFolderBtn.addEventListener('click', () => {
      if (openPresentationFolderBtn.disabled) return;
      closePresentationMenu();
      if (!window.electronAPI?.showPresentationFolder) {
        window.alert(tr('Open Folder is only available in the desktop app.'));
        return;
      }
      if (!slug) {
        window.alert(tr('Missing presentation metadata.'));
        return;
      }
      window.electronAPI.showPresentationFolder(slug).catch((err) => {
        console.error(err);
        window.alert(trFormat('Failed to open folder: {message}', { message: err.message }));
      });
    });
  }

  reparseBtn.addEventListener('click', () => {
    reparseFromFile().catch((err) => {
      console.error(err);
      setStatus(trFormat('Re-parse failed: {message}', { message: err.message }));
    });
  });

  previewFrame.addEventListener('load', () => {
    startPreviewPolling();
  });

  if (addTopImageBtn) {
    addTopImageBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      expandTopMatterPanel();
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

  if (tablePickerGrid) {
    tablePickerGrid.addEventListener('mousemove', handleTablePickerGridMove);
    tablePickerGrid.addEventListener('click', handleTablePickerGridClick);
  }

  if (tablePickerCancel) {
    tablePickerCancel.addEventListener('click', handleTablePickerCancel);
  }

  if (addTopMediaBtn) {
    addTopMediaBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      expandTopMatterPanel();
      if (!addTopMediaMenu) return;
      if (addTopMediaMenu.hidden) {
        closeAllBuilderMenus();
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
        closeAllBuilderMenus();
        openMediaMenu(addSlideMediaMenu, addSlideMediaBtn, 'body');
      } else {
        closeMediaMenu();
      }
    });
  }

  if (addSlideAudioBtn) {
    addSlideAudioBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!addSlideAudioMenu) return;
      if (addSlideAudioMenu.hidden) {
        closeAllBuilderMenus();
        openAudioMenu(addSlideAudioMenu, addSlideAudioBtn, 'body');
      } else {
        closeAudioMenu();
      }
    });
  }

  if (addTopFormatBtn) {
    addTopFormatBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      expandTopMatterPanel();
      if (!addTopFormatMenu) return;
      if (addTopFormatMenu.hidden) {
        closeAllBuilderMenus();
        openFormatMenu(addTopFormatMenu, addTopFormatBtn, 'top');
      } else {
        closeFormatMenu();
      }
    });
  }

  if (addSlideFormatBtn) {
    addSlideFormatBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!addSlideFormatMenu) return;
      if (addSlideFormatMenu.hidden) {
        closeAllBuilderMenus();
        openFormatMenu(addSlideFormatMenu, addSlideFormatBtn, 'body');
      } else {
        closeFormatMenu();
      }
    });
  }

  if (addTopTintBtn) {
    addTopTintBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      expandTopMatterPanel();
      if (!addTopTintMenu) return;
      if (addTopTintMenu.hidden) {
        closeAllBuilderMenus();
        openTintMenu(addTopTintMenu, addTopTintBtn);
      } else {
        closeTintMenu();
      }
    });
  }
}

// --- Storage listeners ---
// Listen for plugin responses pushed via localStorage events.
function setupStorageHandlers() {
  window.addEventListener('storage', (event) => {
    if (!event.key || !event.newValue) return;
    if (handleContentInsertStorage(event)) return;
    handleAddMediaStorage(event);
  });
}

// --- Collapsible panels ---
// Maintain aria-expanded sync for collapsible panels.
function setupCollapsiblePanels() {
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
}

// --- Keyboard shortcuts ---
// Global shortcuts for slide/column navigation and edits.
function setupKeyboardShortcuts() {
  window.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) return;

    const key = event.key.toLowerCase();
    const hasCommand = event.metaKey || event.ctrlKey;

    if(event.shiftKey && key === 'enter') {
      event.preventDefault();
      addMarkdownLineBreak();
      return;
    }

    if(hasCommand && key === 'enter') {
      event.preventDefault();
      breakCurrentSlide();
      return;
    }

    if (hasCommand && !event.altKey) {
      if (key === 's') {
        event.preventDefault();
        triggerSave();
        return;
      }
      if (key === 'm') {
        event.preventDefault();
        expandSlidesPanel();
        addSlideAfterCurrent();
        return;
      }
      if (key === 'd') {
        event.preventDefault();
        expandSlidesPanel();
        duplicateCurrentSlide();
        return;
      }
      if (event.key.startsWith('Arrow')) {
        const { h, v } = state.selected;
        const column = state.stacks[h] || [];
        const maxV = Math.max(column.length - 1, 0);
        switch (event.key) {
          case 'ArrowUp': {
            const nextV = clamp(v - 1, 0, maxV);
            selectSlide(h, nextV);
            event.preventDefault();
            return;
          }
          case 'ArrowDown': {
            const nextV = clamp(v + 1, 0, maxV);
            selectSlide(h, nextV);
            event.preventDefault();
            return;
          }
          case 'ArrowLeft': {
            goToColumn(h - 1);
            event.preventDefault();
            return;
          }
          case 'ArrowRight': {
            goToColumn(h + 1);
            event.preventDefault();
            return;
          }
          default:
            break;
        }
      }
    }

    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (isEditableTarget(document.activeElement)) return;

    const { h, v } = state.selected;
    const column = state.stacks[h] || [];
    const maxV = Math.max(column.length - 1, 0);

    switch (event.key) {
      case 'ArrowUp': {
        const nextV = clamp(v - 1, 0, maxV);
        selectSlide(h, nextV);
        event.preventDefault();
        break;
      }
      case 'ArrowDown': {
        const nextV = clamp(v + 1, 0, maxV);
        selectSlide(h, nextV);
        event.preventDefault();
        break;
      }
      case 'ArrowLeft': {
        goToColumn(h - 1);
        event.preventDefault();
        break;
      }
      case 'ArrowRight': {
        goToColumn(h + 1);
        event.preventDefault();
        break;
      }
      default:
        break;
    }
  });
}

// Cleanup temp preview file before the window closes.
function setupBeforeUnload() {
  window.addEventListener('beforeunload', () => {
    if (window.electronAPI?.cleanupPresentationTemp) {
      window.electronAPI.cleanupPresentationTemp({ slug, tempFile }).catch((err) => {
        console.warn('Failed to remove temp file:', err);
      });
    }
  });
}

// --- Translation watcher + init ---
// Delay static label updates until translations are loaded.
function setupTranslationWatcher() {
  window.addEventListener('DOMContentLoaded', () => {
    if (window.translationsources && !window.translationsources.includes('/admin/locales/translations.json')) {
      window.translationsources.push('/admin/locales/translations.json');
    }
    const waitForTranslations = () => {
      if (!window.translationsources || window.translationsources.length === 0) {
        applyStaticLabels();
        return;
      }
      setTimeout(waitForTranslations, 50);
    };
    waitForTranslations();
  });
}

// Initialize all builder UI wiring and initial load.
function initBuilderEvents() {
  setupEditorHandlers();
  setupButtonHandlers();
  setupStorageHandlers();
  setupCollapsiblePanels();
  setupKeyboardShortcuts();
  setupBeforeUnload();
  setupTranslationWatcher();

  updateAddContentState();
  updatePresentationPropertiesState();
  updateEditExternalState();
  updateOpenFolderState();
  loadContentCreators().catch((err) => {
    console.error(err);
  });

  loadPresentation().catch((err) => {
    console.error(err);
    setStatus(trFormat('Error: {message}', { message: err.message }));
  });

  window.__builderGetDirty = () => !!state.dirty;
}

export { initBuilderEvents };
