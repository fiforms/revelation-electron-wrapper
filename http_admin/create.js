/*
 * Create Presentation / Edit Metadata form (create.html and edit-metadata.html): entry point.
 *
 * One module graph serves both pages; edit-metadata.html sets `window.editMode = true` first
 * and loads /admin/vendor/js-yaml.js (global `jsyaml`) because edit mode reads the existing
 * front matter from /<dir>/<slug>/<md>. URL params in edit mode: slug, md, dir.
 *
 * This file only wires things together: init (schema + translations), buildFormWithTabs,
 * tab switching, submitForm, the help/back buttons and the edit-mode load. The pieces live in
 * ./create/ (relative ES modules):
 *   templates.html         all fixed markup as <template id="tpl-..."> elements (fetched by initCore())
 *   metadata-form-core.js  loadTemplates()/cloneTemplate()/applyTemplateI18n(), t()/tf(), `formState` (shared mutable state), slugify/countMediaUsage,
 *                          schema-driven field builders, setValues, getValidatedStructure/coerceType,
 *                          registerFieldBuilder() registry (core never imports the tabs)
 *   tab-presentation.js    slug field, theme picker (shown in the Theme tab), "Create a Title Slide" option
 *   tab-setup.js           Setup tab: aspect/zoom sliders, auto mode, transition/easing selects, preview
 *   tab-advanced.js        Advanced tab table layout (condenseIntoTable)
 *   tab-media.js           media tile editor (hidden #media-json)
 *   tab-macros.js          macro tile editor (hidden #macros-json), RESERVED_MACRO_NAMES
 *   tab-imports.js         imports file field, save/import shared macros+media files
 *
 * The form is generated from presentation-schema.json (a custom field schema, not JSON
 * Schema: type/default/options/fields). Fields are grouped into the tabs Presentation, Theme,
 * Setup, Advanced, Media, Macros and Imports (see `tabFields`); Setup (transitions, aspect
 * ratio, zoom, auto-animate) mirrors some Advanced `config.*` fields. Media, macros and
 * imports use tile editors that keep their data as JSON in hidden inputs.
 * The slide transition list comes from /js/transitions.js, easings from /js/easings.js.
 *
 * Preload API (window.electronAPI): createPresentation, savePresentationMetadata,
 * openPresentationBuilder, getAvailableThemes, openHandoutView, selectMacroFile,
 * loadMacrosFromFile, saveMacrosToFile, openFileWithEditor.
 * Submit: only values that differ from the schema default are sent (getValidatedStructure).
 * i18n: the English keys live in locales/translations.json ("es"); core pushes that
 * source onto window.translationsources at import time, initCore() awaits window.loadTranslations()
 * before the form is built, and visible strings use the t()/tf() helpers (tf fills
 * {placeholders}). Not translated: data (aliases, filenames, macro code, theme names, ratios),
 * schema labels/docs (already per-language in presentation-schema.json) and res.message from main.
 * Static page text uses data-translate in the HTML; cloned templates are translated by
 * cloneTemplate() (data-translate / data-i18n-<attr>); everything else built here uses t().
 */
import { transitionNames } from '/js/transitions.js';
import { splitFrontMatter } from '/js/frontmatter.js';
import {
  formState, t, tf, initCore, markDirty, setValues, buildForm, buildDynamicArrayField,
  createField, countMediaUsage, getValidatedStructure
} from './create/metadata-form-core.js';
import { buildTitleSlideOption, injectSlugField } from './create/tab-presentation.js';
import { buildSetupTab, syncSetupFromInputs } from './create/tab-setup.js';
import { condenseIntoTable } from './create/tab-advanced.js';
import { createMedia } from './create/tab-media.js';
import { createMacros, renderMacroTiles } from './create/tab-macros.js';
import { createImports } from './create/tab-imports.js';

await initCore();

// The registry is the single list of slide transitions (built-in and custom)
if (formState.schema.config?.fields?.transition) {
  formState.schema.config.fields.transition.options = transitionNames();
}

const schema = formState.schema;
const form = formState.form;

// Define which fields go in which tabs
const tabFields = {
  presentation: ['title', 'slug', 'description', 'author'],
  theme: ['theme'],
  advanced: ['stylesheet', 'thumbnail', 'created', 'newSlideOnHeading', 'scrollspeed', 'config', 'confidence'],
  media: ['media'],
  macros: ['macros'],
  imports: ['imports']
};

// Build form with tabs
buildFormWithTabs(schema, tabFields);

// Set up tab switching
setupTabSwitching();

injectSlugField();

// Add submit button to form-buttons container
const submitBtn = document.createElement('button');
submitBtn.type = 'submit';
submitBtn.className = 'submit-button';
if(window.editMode) {
  submitBtn.textContent = t('Save Metadata');
} else {
  submitBtn.textContent = t('Create Presentation');
}
const buttonContainer = form.querySelector('.form-buttons');
if (buttonContainer) {
  buttonContainer.appendChild(submitBtn);
}

form.addEventListener('submit', submitForm); 


const createTitle = document.getElementById('create-title-slide');
const metadataHelpBtn = document.getElementById('metadata-help-btn');
if (metadataHelpBtn) metadataHelpBtn.title = t('Help');

if (metadataHelpBtn) {
  metadataHelpBtn.addEventListener('click', () => {
    if (!window.electronAPI?.openHandoutView) {
      window.alert(t('Help is only available in the desktop app.'));
      return;
    }
    window.electronAPI.openHandoutView('readme', 'revelation-doc-metadata_reference.md').catch((err) => {
      console.error(err);
      window.alert(tf('Failed to open help: {message}', { message: err.message || err }));
    });
  });
}

if(window.editMode) {
  const urlParams = new URLSearchParams(window.location.search);
  formState.slug_editMode = urlParams.get('slug');
  formState.mdFile_editMode = urlParams.get('md');
  formState.presentation_dir = urlParams.get('dir');
  const fullPath = `/${formState.presentation_dir}/${formState.slug_editMode}/${formState.mdFile_editMode}`;

  if(formState.slug_editMode && formState.mdFile_editMode && formState.presentation_dir) {
    document.getElementById('presentation-file-path').textContent = `${formState.slug_editMode}/${formState.mdFile_editMode}`;
    form.setAttribute('data-slug', formState.slug_editMode);
    form.setAttribute('data-mdfile', formState.mdFile_editMode);
  } else {
    document.getElementById('presentation-file-path').textContent = t('No slug or mdFile specified');
  }

  // Show back button in edit mode
  const backBtn = document.getElementById('back-to-builder-btn');
  if (backBtn) {
    backBtn.title = t('Back to Builder');
    backBtn.hidden = false;
    backBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (formState.formDirty) {
        if (confirm(t('You have unsaved changes. Discard them and go back to the presentation?'))) {
          const params = new URLSearchParams({
            dir: formState.presentation_dir,
            slug: formState.slug_editMode,
            md: formState.mdFile_editMode
          });
          window.location.href = `/admin/builder.html?${params.toString()}`;
        }
      } else {
        const params = new URLSearchParams({
          dir: formState.presentation_dir,
          slug: formState.slug_editMode,
          md: formState.mdFile_editMode
        });
        window.location.href = `/admin/builder.html?${params.toString()}`;
      }
    });
  }

  fetch(fullPath)
    .then(res => res.text())
    .then(md => {
      const { hasFrontMatter, yamlText } = splitFrontMatter(md);
      if (hasFrontMatter) {
        const metadata = jsyaml.loadAll(yamlText)[0] ?? {}; // load() throws on empty/comment-only YAML in js-yaml 5

        // Count media usage BEFORE rendering tiles
        if (metadata.media) {
          formState.mediaUsageCounts = countMediaUsage(md, Object.keys(metadata.media));
        }

        setValues(metadata, '');
        syncSetupFromInputs();

        // Populate macros
        if (metadata.macros) {
          const macrosJson = document.getElementById('macros-json');
          if (macrosJson) {
            macrosJson.value = JSON.stringify(metadata.macros, null, 2);
            renderMacroTiles();
          }
        }

        // Populate imports file
        if (metadata.imports) {
          const importsInput = document.getElementById('imports-input');
          if (importsInput) {
            importsInput.value = metadata.imports;
            // Trigger UI update to show Edit/Clear buttons
            importsInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }

        // Reset dirty flag after loading initial values
        formState.formDirty = false;
      }
    })
    .catch(err => console.error("Failed to load metadata", err));

  // Track form changes
  form.addEventListener('input', () => {
    markDirty();
  }, true);
  form.addEventListener('change', () => {
    markDirty();
  }, true);

}

// Wire the tab buttons so clicking one shows its #tab-<name> panel and hides the others.
function setupTabSwitching() {
  const tabButtons = document.querySelectorAll('.tab-button');
  const tabContents = document.querySelectorAll('.tab-content');

  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      const tabName = button.getAttribute('data-tab');

      // Update button states
      tabButtons.forEach(btn => {
        btn.setAttribute('aria-selected', btn === button ? 'true' : 'false');
      });

      // Update content visibility
      tabContents.forEach(content => {
        if (content.id === `tab-${tabName}`) {
          content.removeAttribute('hidden');
        } else {
          content.setAttribute('hidden', '');
        }
      });
    });
  });
}


// Build every schema field into its tab panel (per tabFields), then lay out Advanced and Setup.
function buildFormWithTabs(schema, tabFields) {
  const tabs = {
    presentation: document.getElementById('tab-presentation'),
    theme: document.getElementById('tab-theme'),
    setup: document.getElementById('tab-setup'),
    advanced: document.getElementById('tab-advanced'),
    media: document.getElementById('tab-media'),
    macros: document.getElementById('tab-macros'),
    imports: document.getElementById('tab-imports')
  };

  // In create mode, add "Create a Title Slide" checkbox to Presentation tab
  if (!window.editMode) {
    buildTitleSlideOption(tabs.presentation);
  }

  // Categorize schema fields into tabs
  for (const key in schema) {
    let foundTab = null;
    for (const [tab, fields] of Object.entries(tabFields)) {
      if (fields.includes(key)) {
        foundTab = tab;
        break;
      }
    }

    if (foundTab && tabs[foundTab]) {
      const field = schema[key];
      if (key === 'media') {
        tabs[foundTab].appendChild(createMedia(field));
      } else if (key === 'macros') {
        tabs[foundTab].appendChild(createMacros(field));
      } else if (key === 'imports') {
        tabs[foundTab].appendChild(createImports(field));
      } else if (field.type === 'object') {
        const subFields = buildForm(field.fields, key);
        tabs[foundTab].appendChild(document.createElement('hr'));
        tabs[foundTab].appendChild(subFields);
      } else if (field.type === 'array') {
        tabs[foundTab].appendChild(buildDynamicArrayField(null, key, field));
      } else {
        tabs[foundTab].appendChild(createField(key, field));
      }
    }
  }

  condenseIntoTable(tabs.advanced);
  buildSetupTab(tabs.setup);
}

// Submit handler: validate fields into front matter, then create or save via electronAPI and navigate away.
async function submitForm(e) {
  e.preventDefault();

  const result = document.getElementById('result');
  result.textContent = ''; // clear previous message

  try {
    const formData = new FormData(form);
    const userInput = Object.fromEntries(formData.entries());

    // Add missing checkbox values
    form.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      userInput[cb.name] = cb.checked;
    });

    // Filtered config object
    const filtered = getValidatedStructure(schema, userInput);

    const macrosRaw = userInput['macros'];
    if(macrosRaw) {
      const macrosParsed = JSON.parse(macrosRaw);
      filtered.macros = macrosParsed;
    }
    else {
      delete(filtered.macros);
    }

    const mediaRaw = userInput['media'];
    if(mediaRaw) {
      const mediaParsed = JSON.parse(mediaRaw);
      filtered.media = mediaParsed;
    }
    else {
      delete(filtered.media);
    }

    // Handle imports field
    const importsRaw = userInput['imports'];
    if(importsRaw && importsRaw.trim()) {
      filtered.imports = importsRaw.trim();
    }
    else {
      delete(filtered.imports);
    }

    let res;
    if (window.editMode) {
      const slug = form.getAttribute('data-slug');
      const mdFile = form.getAttribute('data-mdfile');
      res = await window.electronAPI.savePresentationMetadata(slug, mdFile, filtered);
    } else {
      const requestedSlug = formState.slugInput ? formState.slugInput.value.trim() : '';
      const newFiltered = {...filtered, 'createTitleSlide' : createTitle.checked, slug: requestedSlug };
      res = await window.electronAPI.createPresentation(newFiltered);
    }
    result.textContent = res.message;
    result.classList.toggle('result-success', !!res.success);
    result.classList.toggle('result-error', !res.success);

    if (res.success && res.slug) {
      if (!window.editMode) {
        if (window.electronAPI?.openPresentationBuilder) {
          await window.electronAPI.openPresentationBuilder(res.slug, 'presentation.md');
        }
        // Close the current window (only works in Electron)
        window.close();
      } else {
        // In editMode, navigate back to builder after successful save
        const params = new URLSearchParams({
          dir: formState.presentation_dir,
          slug: formState.slug_editMode,
          md: formState.mdFile_editMode
        });
        window.location.href = `/admin/builder.html?${params.toString()}`;
      }
    }

  } catch (err) {
    console.error('Submission error:', err);
    const errDiv = document.createElement('div');
    errDiv.className = 'result-error-box';
    errDiv.textContent = tf('❌ Error: {message}', { message: err.message || t('Unknown error') });
    const pre = document.createElement('pre');
    pre.textContent = (err.stack || err).toString();
    errDiv.appendChild(document.createElement('br'));
    errDiv.appendChild(pre);
    result.innerHTML = '';
    result.appendChild(errDiv);
  }
}
