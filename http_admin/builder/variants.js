/*
 * Variant menu support for multi-language markdown files.
 *
 * Sections:
 * - Variant state loading
 * - Variant menu rendering
 * - Variant creation
 */
import {
  trFormat,
  variantMenuBtn,
  variantMenu,
  slug,
  mdFile,
  state
} from './context.js';
import { setStatus } from './app-state.js';
import { savePresentation } from './presentation.js';

let variantState = { entries: [], masterFile: mdFile };

function promptForLanguageCode() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.background = 'rgba(0, 0, 0, 0.45)';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '2000';

    const panel = document.createElement('div');
    panel.style.background = '#1f1f24';
    panel.style.border = '1px solid #3a3a44';
    panel.style.borderRadius = '10px';
    panel.style.padding = '14px';
    panel.style.width = 'min(92vw, 420px)';
    panel.style.color = '#fff';

    const title = document.createElement('div');
    title.textContent = tr('Language code for new variant (example: es)');
    title.style.marginBottom = '8px';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'es';
    input.autocomplete = 'off';
    input.style.width = '100%';
    input.style.boxSizing = 'border-box';
    input.style.marginBottom = '10px';
    input.style.padding = '8px';
    input.style.borderRadius = '6px';
    input.style.border = '1px solid #555';
    input.style.background = '#111';
    input.style.color = '#fff';

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.justifyContent = 'flex-end';
    actions.style.gap = '8px';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'panel-button';
    cancelBtn.textContent = tr('Cancel');

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'panel-button';
    addBtn.textContent = tr('Add Variant…');

    const close = (value) => {
      overlay.remove();
      resolve(value);
    };

    cancelBtn.addEventListener('click', () => close(null));
    addBtn.addEventListener('click', () => close(input.value));
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close(null);
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(null);
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        close(input.value);
      }
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(addBtn);
    panel.appendChild(title);
    panel.appendChild(input);
    panel.appendChild(actions);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    input.focus();
    input.select();
  });
}

function formatVariantLabel(entry) {
  const language = entry.language || tr('unknown');
  const marker = entry.isCurrent ? ` (${tr('current')})` : '';
  const role = entry.isMaster ? ` ${tr('[master]')}` : '';
  return `${language}${role} - ${entry.mdFile}${marker}`;
}

function setVariantMenuDisabled(disabled, title = '') {
  if (!variantMenuBtn) return;
  variantMenuBtn.disabled = disabled;
  variantMenuBtn.classList.toggle('is-disabled', disabled);
  variantMenuBtn.title = title;
}

async function loadVariantState() {
  if (!window.electronAPI?.getPresentationVariants) {
    setVariantMenuDisabled(true, tr('Variants are only available in the desktop app.'));
    return;
  }
  if (!slug || !mdFile) {
    setVariantMenuDisabled(true, tr('Missing presentation metadata.'));
    return;
  }
  try {
    const result = await window.electronAPI.getPresentationVariants({ slug, mdFile });
    variantState = {
      entries: Array.isArray(result?.entries) ? result.entries : [],
      masterFile: result?.masterFile || mdFile
    };
    setVariantMenuDisabled(false, '');
  } catch (err) {
    setVariantMenuDisabled(true, trFormat('Variant load failed: {message}', { message: err.message }));
  }
}

async function openVariantFile(targetMdFile) {
  if (!targetMdFile || targetMdFile === mdFile) return;
  if (!window.electronAPI?.openPresentationBuilder) return;
  const saved = state.dirty ? await savePresentation() : true;
  if (!saved) return;
  await window.electronAPI.openPresentationBuilder(slug, targetMdFile);
  window.close();
}

async function handleAddVariant() {
  if (!window.electronAPI?.addPresentationVariant) {
    window.alert(tr('Variants are only available in the desktop app.'));
    return;
  }
  const language = await promptForLanguageCode();
  if (language === null) return;
  const code = String(language || '').trim().toLowerCase();
  if (!code) {
    window.alert(tr('Language code is required.'));
    return;
  }
  const saved = state.dirty ? await savePresentation() : true;
  if (!saved) return;
  const result = await window.electronAPI.addPresentationVariant({
    slug,
    mdFile,
    language: code
  });
  await loadVariantState();
  setStatus(trFormat('Variant created: {file}', { file: result?.mdFile || '' }));
}

function renderVariantMenu() {
  if (!variantMenu) return;
  variantMenu.innerHTML = '';

  const addItem = (label, onClick, disabled = false) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'builder-dropdown-item';
    item.textContent = label;
    if (disabled) {
      item.classList.add('is-disabled');
      item.disabled = true;
    } else if (typeof onClick === 'function') {
      item.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        try {
          await onClick();
        } catch (err) {
          console.error(err);
          window.alert(trFormat('Variant action failed: {message}', { message: err.message }));
        }
      });
    }
    variantMenu.appendChild(item);
  };

  if (!variantState.entries.length) {
    addItem(tr('No variants configured.'), null, true);
  } else {
    variantState.entries.forEach((entry) => {
      addItem(formatVariantLabel(entry), () => openVariantFile(entry.mdFile), entry.isCurrent);
    });
  }

  addItem(tr('Add Variant…'), handleAddVariant);
}

function openVariantMenu() {
  renderVariantMenu();
}

export {
  loadVariantState,
  openVariantMenu
};
