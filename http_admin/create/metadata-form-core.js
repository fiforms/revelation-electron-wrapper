/*
 * Shared pieces of the Create Presentation / Edit Metadata form (create.html, edit-metadata.html).
 *
 * Holds everything used by more than one tab module: the t()/tf() i18n helpers, `formState`
 * (the one mutable object for cross-module state), slugify/randomFourDigits/countMediaUsage,
 * the schema-driven field builders (buildForm, createField, buildDynamicArrayField,
 * addDynamicItem), setValues, getValidatedStructure and coerceType, plus the HTML-template helpers
 * loadTemplates()/cloneTemplate()/applyTemplateI18n() for create/templates.html.
 *
 * Callers: /admin/create.js (entry point) and the tab-*.js modules in this folder.
 * Browser ESM, but import-safe in Node: nothing here touches `document` at import time (the
 * only import-time side effect is pushing the translation source onto window.translationsources
 * when `window` exists), so tests/createFormCore.test.js can import it directly. The `/js/...`
 * modules (easings, transitions) are deliberately NOT imported here for the same reason.
 *
 * Gotchas:
 * - Cross-module state lives in `formState`; never copy its primitive fields into a local at
 *   import time (a stale copy would never see later assignments). Read `formState.x` when needed.
 * - `initCore()` must be awaited by create.js before any form is built: it fetches the schema,
 *   makes sure translations are loaded (strings go through t()) and looks up the form element.
 * - core must not import tab modules. Tabs register the builders core needs to call
 *   (theme picker, media tile renderer) with registerFieldBuilder(); buildForm/createField/
 *   setValues look them up with getFieldBuilder().
 * - cloneTemplate(id) needs loadTemplates() (called by initCore()) and throws if the id is missing;
 *   it translates the clone itself, so cloned markup is not left to translate.js's one-time pass.
 * - getValidatedStructure only emits values that differ from the schema default.
 */

// The English keys live in locales/translations.json; push the source before DOMContentLoaded
// so translate.js picks it up.
if (typeof window !== 'undefined') {
  window.translationsources ||= [];
  window.translationsources.push('/admin/locales/translations.json');
}

// Translate a key via window.tr, falling back to the key itself.
export function t(key) {
  if (typeof window !== 'undefined' && typeof window.tr === 'function') return window.tr(key);
  return key;
}

// Translate a template and fill {placeholders} from vars.
export function tf(key, vars = {}) {
  let out = t(key);
  for (const [name, value] of Object.entries(vars)) {
    out = out.split(`{${name}}`).join(String(value));
  }
  return out;
}

// Mutable state shared by the form modules.
export const formState = {
  schema: {},
  form: null,                // <form id="create-form">, set by initCore()
  mediaUsageCounts: {},      // how many times each media alias is referenced in the markdown
  formDirty: false,
  presentation_dir: '',      // edit mode: URL param `dir`
  slug_editMode: '',         // edit mode: URL param `slug`
  mdFile_editMode: '',       // edit mode: URL param `md`
  slugInput: null            // the injected slug <input> (tab-presentation.js)
};

let langCode = (typeof navigator !== 'undefined' && (navigator.language || navigator.userLanguage)) || 'en';
export const lang = langCode.split('-')[0];

// Flag the form as having unsaved changes (the Back button asks before discarding).
export function markDirty() {
  formState.formDirty = true;
}

// Fetch the schema, make sure translations are loaded, and find the form element.
// Call (and await) once from create.js before building the form.
export async function initCore() {
  formState.schema = await fetch('./presentation-schema.json').then(res => res.json());

  // Strings below go through t(); make sure the translation files are loaded first
  // (loadTranslations is safe to call before DOMContentLoaded's own run).
  if (!window.translationsLoaded && typeof window.loadTranslations === 'function') {
    await window.loadTranslations();
  }

  await loadTemplates();

  formState.form = document.getElementById('create-form');
}

// --- HTML <template> support -------------------------------------------------------------
// Fixed markup for the tab modules lives in /admin/create/templates.html (one <template id="tpl-...">
// per component). loadTemplates() fetches it once and appends the templates to <body>;
// cloneTemplate(id) returns a fresh, already-translated clone of the template's root element.
const templateRegistry = new Map();
let templatesLoaded = false;

// Fetch templates.html once and append its <template> elements to <body> for cloneTemplate().
export async function loadTemplates() {
  if (templatesLoaded) return;
  const res = await fetch('/admin/create/templates.html');
  if (!res.ok) throw new Error(`Could not load /admin/create/templates.html (HTTP ${res.status})`);
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
  for (const tpl of doc.querySelectorAll('template[id]')) {
    const imported = document.importNode(tpl, true);
    templateRegistry.set(imported.id, imported);
    document.body.appendChild(imported);
  }
  templatesLoaded = true;
}

// Translate a freshly cloned subtree: [data-translate] elements get their text (the key) replaced
// via t(); data-i18n-<attr>="key" sets <attr> to t(key). The data-* attributes are removed so
// translate.js's one-time DOMContentLoaded pass never translates a clone a second time.
export function applyTemplateI18n(root) {
  const nodes = [root, ...root.querySelectorAll('*')];
  for (const el of nodes) {
    if (el.hasAttribute('data-translate')) {
      el.removeAttribute('data-translate');
      el.textContent = t(el.textContent.trim());
    }
    for (const attr of Array.from(el.attributes)) {
      if (!attr.name.startsWith('data-i18n-')) continue;
      el.setAttribute(attr.name.slice('data-i18n-'.length), t(attr.value));
      el.removeAttribute(attr.name);
    }
  }
  return root;
}

// Clone the first element child of <template id="id"> and translate it.
export function cloneTemplate(id) {
  const tpl = templateRegistry.get(id);
  const first = tpl && tpl.content.firstElementChild;
  if (!first) throw new Error(`Template "${id}" not found (is it in /admin/create/templates.html and was loadTemplates() awaited?)`);
  return applyTemplateI18n(first.cloneNode(true));
}

// Registry for builders/hooks provided by tab modules (core cannot import them).
// Names used: 'theme' (createThemePicker), 'media' (createMedia), 'renderMediaTiles',
// 'syncThemePickerInput'.
const fieldBuilders = new Map();

// Register a builder/hook function under a name so core can call tab modules without importing them.
export function registerFieldBuilder(name, fn) {
  fieldBuilders.set(name, fn);
}

// Look up a registered builder by name; throws if the tab module has not registered it.
export function getFieldBuilder(name) {
  const fn = fieldBuilders.get(name);
  if (!fn) throw new Error(`No field builder registered for "${name}"`);
  return fn;
}

// Lowercase and collapse non-alphanumerics to single hyphens, trimming hyphens at the ends.
export function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Random four-digit string (1000-9999), used as the auto-slug suffix.
export function randomFourDigits() {
  return String(1000 + Math.floor(Math.random() * 9000));
}

// Count "media:alias" references per alias in the markdown body (front matter excluded).
export function countMediaUsage(markdown, mediaAliases) {
  // Extract content after the YAML frontmatter
  const match = markdown.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/);
  const content = match ? match[1] : '';

  const counts = {};
  for (const alias of mediaAliases) {
    // Count occurrences of "media:alias" (case-insensitive to be safe)
    const pattern = new RegExp(`media:\\s*${String(alias).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi');
    const matches = content.match(pattern);
    counts[alias] = matches ? matches.length : 0;
  }
  return counts;
}

// Fill form inputs from loaded metadata (dotted names for nested objects); media goes to #media-json.
export function setValues(metadata, prefix = '') {
  for (const key in metadata) {
    const value = metadata[key];

    if (prefix === '' && key === 'media') {
      const hidden = document.getElementById('media-json');
      hidden.value = JSON.stringify(value, null, 2);
      getFieldBuilder('renderMediaTiles')();
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      // Recursively set values for nested objects
      setValues(value, prefix ? `${prefix}.${key}` : key);
    } else if (typeof value === 'object' && Array.isArray(value)) {
      // Handle macros later
    } else {
      const input = document.querySelector(`[name="${prefix ? `${prefix}.` : ''}${key}"]`);
      if (input) {
        if (input.type === 'checkbox') {
          input.checked = !!value;
        } else {
          input.value = value;
          if (input.dataset.themePicker === 'true') {
            getFieldBuilder('syncThemePickerInput')(input);
          }
        }
      }
    }
  }
}

// Build form fields from a schema into a fragment, recursing into objects and routing media/arrays.
export function buildForm(schema, parentKey = '') {
  const fragment = document.createDocumentFragment();
  for (const key in schema) {
    const fullKey = parentKey ? `${parentKey}.${key}` : key;
    const field = schema[key];

    if (parentKey === '' && key === 'media') {
      // Needs special handling for media set
      fragment.appendChild(getFieldBuilder('media')(field))
    } else if (field.type === 'object') {
      const subFields = buildForm(field.fields, fullKey);
      fragment.appendChild(document.createElement('hr'));
      fragment.appendChild(subFields);
    } else if (field.type === 'array') {
      fragment.appendChild(buildDynamicArrayField(fragment, fullKey, field));
    } else {
      fragment.appendChild(createField(fullKey, field));
    }
  }
  return fragment;
}

// Build a labelled list with an "Add" button for an array-type schema field.
export function buildDynamicArrayField(fragment, key, field) {

  const section = document.createElement('div');
  section.className = 'advanced';
  if (key === 'media' || key === 'macros') {
    section.className = ''; // Don't hide media/macros behind advanced checkbox
  }
  section.appendChild(document.createElement('hr'));

  const arrayLabel = document.createElement('label');
  arrayLabel.textContent = (field.label && field.label[lang]) ? field.label[lang] : key;
  section.appendChild(arrayLabel);

  const list = document.createElement('div');
  list.id = `${key}.list`;

  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.textContent = tf('Add {name}', { name: key });

  addButton.onclick = () => addDynamicItem(key, field);

  section.appendChild(list);
  section.appendChild(addButton);
  return section;
}

// Append a name/value row with a Remove button to the array field's list.
export function addDynamicItem(fullKey, field) {
  const list = document.getElementById(`${fullKey}.list`);
  const wrapper = document.createElement('div');
  wrapper.className = `${fullKey}.listitem`;

  const nameInput = document.createElement('input');
  nameInput.name = `${fullKey}.name`;
  nameInput.placeholder = `${fullKey}.name`;
  nameInput.value = field.name || '';

  const valueInput = document.createElement('textarea');
  valueInput.name = `${fullKey}.value`;
  valueInput.placeholder = `${fullKey}.value`;
  valueInput.value = field.value || '';

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.textContent = t('Remove');
  removeBtn.onclick = () => wrapper.remove();

  wrapper.appendChild(nameInput);
  wrapper.appendChild(valueInput);
  wrapper.appendChild(removeBtn);
  list.appendChild(wrapper);
}

// Build one label + input wrapper for a schema field (select, checkbox, textarea, date or text).
export function createField(key, def) {
  const wrapper = document.createElement('div');
  const label = document.createElement('label');
  label.textContent = (def.label && def.label[lang]) ? def.label[lang] : key;

  // Show doc as a tooltip on the label
  if (def.doc && def.doc[lang]) label.title = def.doc[lang];

  if (def.advanced) wrapper.className = 'advanced';

  let input;
  let appDefault = def.default;
  if( def.appDefault !== undefined) {
    appDefault = def.appDefault;
  }
  if (appDefault === 'today') {
    appDefault = new Date().toISOString().slice(0, 10); // Format as YYYY-MM-DD
  }
  if (def.type === 'select') {
    if (key === 'theme') {
      return getFieldBuilder('theme')(key, def, appDefault);
    }
    input = document.createElement('select');
    def.options.forEach(opt => {
      const option = document.createElement('option');
      option.value = opt;
      if( opt === appDefault) {
        option.selected = true;
      }
      option.textContent = String(opt);
      input.appendChild(option);
    });
    input.value = appDefault;
  } else if (def.type === 'boolean') {
    input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = appDefault;
  } else if (def.type === 'textarea') {
    input = document.createElement('textarea');
    input.value = appDefault || '';
  } else {
    input = document.createElement('input');
    input.type = def.type === 'date' ? 'date' : 'text';
    input.value = appDefault;
  }

  input.name = key;

  // Optional: also set doc as a tooltip on the input itself
  if (def.doc) input.title = def.doc;

  wrapper.appendChild(label);
  wrapper.appendChild(input);
  return wrapper;
}

// Coerce submitted values per the schema into a front-matter object, omitting values equal to defaults.
export function getValidatedStructure(schemaPart, inputData, parentKey = '') {
  const result = {};
  for (const key in schemaPart) {
    const fullKey = parentKey ? `${parentKey}.${key}` : key;
    const field = schemaPart[key];
    if (field.type === 'object') {
      result[key] = getValidatedStructure(field.fields, inputData, fullKey);
    } 
    else {
      const value = inputData[fullKey];
      let valTyped = null;
      if (value !== undefined) {
        valTyped = coerceType(value, field.type);
      } else if (field.default !== undefined) {
        valTyped = coerceType(field.default, field.type);
      }
      const defaultTyped = coerceType(field.default, field.type);
      if (valTyped !== defaultTyped) {
        result[key] = valTyped;
      } else {
        // If the value matches the default, we skip it
        // This allows us to only include non-default values in the final object
      }
    }
  }
  return result;
}

// Convert a form string to the schema type (boolean, number, integer; "true"/"false"/"null" otherwise).
export function coerceType(value, type) {
  switch (type) {
    case "boolean":
      return value === "true" || value === true;
    case "number":
      return Number(value);
    case "integer":
      return parseInt(value, 10);
    default:
      if (typeof value === 'string') {
        return value === 'true' ? true: (value === 'false' ? false : (value === 'null' ? null : value));
      }
      return value;
  }
} // export function coerceType
