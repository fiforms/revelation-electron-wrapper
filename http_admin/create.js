let schema = {};
await fetch('./presentation-schema.json')
  .then(res => res.json())
  .then(data => {
    schema = data;
  });

let lang = navigator.language || navigator.userLanguage || 'en';
lang = lang.split('-')[0];

const form = document.getElementById('create-form');

form.appendChild(buildForm(schema));

const submitBtn = document.createElement('button');
submitBtn.type = 'submit';
submitBtn.class = 'submit-button';
submitBtn.setAttribute('data-translate','true');
if(window.editMode) {
  submitBtn.textContent = 'Save Metadata';
} else {
  submitBtn.textContent = 'Create Presentation';
}
form.appendChild(submitBtn);

form.addEventListener('submit', submitForm); 

const advancedCheckbox = document.getElementById('show-advanced');
advancedCheckbox.addEventListener('change',toggleAdvanced);

const createTitle = document.getElementById('create-title-slide');

if(window.editMode) {
  const urlParams = new URLSearchParams(window.location.search);
  const slug = urlParams.get('slug');
  const mdFile = urlParams.get('md');
  const presentation_dir = urlParams.get('dir');
  const fullPath = `/${presentation_dir}/${slug}/${mdFile}`;

  if(slug && mdFile && presentation_dir) {
    document.getElementById('presentation-file-path').textContent = `${slug}/${mdFile}`;
    form.setAttribute('data-slug', slug);
    form.setAttribute('data-mdfile', mdFile);
  } else {
    document.getElementById('presentation-file-path').textContent = 'No slug or mdFile specified';
  }

  fetch(fullPath)
    .then(res => res.text())
    .then(md => {
      const match = md.match(/^---\n([\s\S]*?)\n---/);
      if (match) {
        const yamlText = match[1];
        const metadata = jsyaml.load(yamlText);

        setValues(metadata, '');

        // Populate macros
        if (metadata.macros) {
          for (const [name, val] of Object.entries(metadata.macros)) {
            addDynamicItem("macros", { name, value: val });
          }
        }
      }
    })
    .catch(err => console.error("Failed to load metadata", err));

}

function setValues(metadata, prefix = '') {
  for (const key in metadata) {
    const value = metadata[key];

    if (prefix === '' && key === 'media') {
      const list = document.getElementById('media-list');
      const hidden = document.getElementById('media-json');
      list.innerHTML = '';

      for (const mkey in value) {
        const filename = value[mkey].filename || '(no file)';
        const item = document.createElement('li');
        item.textContent = `${mkey} → ${filename}`;
        list.appendChild(item);
      }

      hidden.value = JSON.stringify(value, null, 2);
      list.dataset.populated = 'true';
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
            syncThemePickerInput(input);
          }
        }
      }
    }
  }
}

function buildForm(schema, parentKey = '') {
  const fragment = document.createDocumentFragment();
  for (const key in schema) {
    const fullKey = parentKey ? `${parentKey}.${key}` : key;
    const field = schema[key];

    if (parentKey === '' && key === 'media') {
      // Needs special handling for media set
      fragment.appendChild(createMedia(field))
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

function buildDynamicArrayField(fragment, key, field) {

  const section = document.createElement('div');
  section.className = 'advanced';
  section.appendChild(document.createElement('hr'));
  
  const arrayLabel = document.createElement('label');
  arrayLabel.textContent = (field.label && field.label[lang]) ? field.label[lang] : key;
  section.appendChild(arrayLabel);

  const list = document.createElement('div');
  list.id = `${key}.list`;

  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.textContent = `Add ${key}`;

  addButton.onclick = () => addDynamicItem(key, field);

  section.appendChild(list);
  section.appendChild(addButton);
  return section;
}

function addDynamicItem(fullKey, field) {
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
  removeBtn.textContent = 'Remove';
  removeBtn.onclick = () => wrapper.remove();

  wrapper.appendChild(nameInput);
  wrapper.appendChild(valueInput);
  wrapper.appendChild(removeBtn);
  list.appendChild(wrapper);
}

function createField(key, def) {
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
      return createThemePicker(key, def, appDefault);
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

    const macroItems = document.querySelectorAll("div[class='macros.listitem']");
    const macros = {};

    Array.from(macroItems).forEach(item => {
      const name = item.querySelector('input[name="macros.name"]').value.trim();
      const value = item.querySelector('textarea[name="macros.value"]').value.trim();
      if (name) {
        macros[name] = value;
      }
    });

    if (Object.keys(macros).length > 0) {
      filtered.macros = macros;
    }

    const mediaRaw = userInput['media'];
    if(mediaRaw) {
      const mediaParsed = JSON.parse(mediaRaw);
      filtered.media = mediaParsed;
    }
    else {
      delete(filtered.media);
    }

    let res;
    if (window.editMode) {
      const slug = form.getAttribute('data-slug');
      const mdFile = form.getAttribute('data-mdfile');
      res = await window.electronAPI.savePresentationMetadata(slug, mdFile, filtered);
    } else {
      const newFiltered = {...filtered, 'createTitleSlide' : createTitle.checked };
      res = await window.electronAPI.createPresentation(newFiltered);
    }
    result.textContent = res.message;
    result.style.color = 'limegreen';

    if (res.success && res.slug) {
      if (!window.editMode) {
        if (window.electronAPI?.openPresentationBuilder) {
          await window.electronAPI.openPresentationBuilder(res.slug, 'presentation.md');
        }
      } else {
        const slug = form.getAttribute('data-slug');
        const mdFile = form.getAttribute('data-mdfile');
        if (slug && mdFile && window.electronAPI?.openPresentationBuilder) {
          await window.electronAPI.openPresentationBuilder(slug, mdFile);
        }
      }

      // Close the current window (only works in Electron)
      window.close();
    }

  } catch (err) {
    console.error('Submission error:', err);
    result.innerHTML = `
      <div style="color: red; font-weight: bold;">
        ❌ Error: ${err.message || 'Unknown error'}<br>
        <pre>${(err.stack || err).toString()}</pre>
      </div>
    `;
  }  
}

function getValidatedStructure(schemaPart, inputData, parentKey = '') {
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

function coerceType(value, type) {
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
} // function coerceType

function createThemePicker(key, def, appDefault) {
  const wrapper = document.createElement('div');
  wrapper.className = 'theme-picker';
  wrapper.dataset.expanded = 'false';
  if (def.advanced) {
    wrapper.classList.add('advanced');
  }

  const label = document.createElement('label');
  label.textContent = (def.label && def.label[lang]) ? def.label[lang] : key;
  if (def.doc && def.doc[lang]) label.title = def.doc[lang];
  wrapper.appendChild(label);

  const subtitle = document.createElement('div');
  subtitle.className = 'theme-picker-subtitle';
  subtitle.textContent = 'Choose a visual theme';
  wrapper.appendChild(subtitle);

  const input = document.createElement('input');
  input.type = 'hidden';
  input.name = key;
  input.value = appDefault || '';
  input.dataset.themePicker = 'true';
  wrapper.appendChild(input);

  const header = document.createElement('div');
  header.className = 'theme-picker-header';

  const summary = document.createElement('div');
  summary.className = 'theme-picker-summary';

  const summaryPreview = document.createElement('div');
  summaryPreview.className = 'theme-summary-preview';
  const summaryImg = document.createElement('img');
  summaryImg.alt = 'Theme preview';
  summaryPreview.appendChild(summaryImg);
  summary.appendChild(summaryPreview);

  const summaryText = document.createElement('div');
  summaryText.className = 'theme-summary-text';
  const summaryTitle = document.createElement('div');
  summaryTitle.className = 'theme-summary-title';
  const summaryMeta = document.createElement('div');
  summaryMeta.className = 'theme-summary-meta';
  summaryText.appendChild(summaryTitle);
  summaryText.appendChild(summaryMeta);
  summary.appendChild(summaryText);

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'theme-picker-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.textContent = 'Change theme';

  header.appendChild(summary);
  header.appendChild(toggle);
  wrapper.appendChild(header);

  const grid = document.createElement('div');
  grid.className = 'theme-picker-grid';
  grid.setAttribute('role', 'listbox');
  grid.setAttribute('aria-label', label.textContent);
  wrapper.appendChild(grid);

  const footer = document.createElement('div');
  footer.className = 'theme-picker-footer';
  footer.textContent = 'Previews come from /css/theme-thumbnails. Use Debug → Generate Theme Thumbnails if missing.';
  wrapper.appendChild(footer);

  populateThemePicker(grid, input, appDefault);
  toggle.addEventListener('click', () => {
    const isOpen = wrapper.dataset.expanded === 'true';
    wrapper.dataset.expanded = isOpen ? 'false' : 'true';
    toggle.setAttribute('aria-expanded', String(!isOpen));
    toggle.textContent = isOpen ? 'Change theme' : 'Hide themes';
  });
  return wrapper;
}

function buildThemeCard(theme, index, onSelect) {
  const themeBase = theme.replace(/\.css$/i, '');
  const themeLabel = themeBase
    .split(/[-_]+/g)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'theme-card';
  card.dataset.themeValue = theme;
  card.style.animationDelay = `${index * 30}ms`;
  card.setAttribute('role', 'option');
  card.setAttribute('aria-selected', 'false');

  const preview = document.createElement('div');
  preview.className = 'theme-card-preview';

  const img = document.createElement('img');
  img.loading = 'lazy';
  img.alt = `${themeLabel} preview`;
  img.src = `/css/theme-thumbnails/${themeBase}.jpg`;
  img.onerror = () => {
    img.remove();
    preview.classList.add('theme-card-preview--missing');
    const placeholder = document.createElement('span');
    placeholder.className = 'theme-card-placeholder';
    placeholder.textContent = 'No preview';
    preview.appendChild(placeholder);
  };

  preview.appendChild(img);

  const title = document.createElement('div');
  title.className = 'theme-card-title';
  title.textContent = themeLabel;

  const meta = document.createElement('div');
  meta.className = 'theme-card-meta';
  meta.textContent = theme;

  card.appendChild(preview);
  card.appendChild(title);
  card.appendChild(meta);

  card.addEventListener('click', () => onSelect(theme));
  return card;
}

async function populateThemePicker(grid, input, appDefault) {
  let themes = await window.electronAPI.getAvailableThemes();
  const selected = input.value || appDefault || '';

  if (selected && !themes.includes(selected)) {
    themes = [selected, ...themes];
  }

  grid.innerHTML = '';
  themes.forEach((theme, index) => {
    const card = buildThemeCard(theme, index, (value) => {
      setThemePickerValue(grid, input, value, true);
    });
    if (theme === selected && !grid.dataset.selected) {
      card.classList.add('is-selected');
      card.setAttribute('aria-selected', 'true');
      grid.dataset.selected = theme;
    }
    grid.appendChild(card);
  });

  if (!grid.dataset.selected && themes.length) {
    setThemePickerValue(grid, input, selected || themes[0], false);
  }
  updateThemePickerSummary(input);
}

function setThemePickerValue(grid, input, value, emitChange) {
  if (!value) return;
  input.value = value;
  grid.dataset.selected = value;
  Array.from(grid.querySelectorAll('.theme-card')).forEach(card => {
    const isSelected = card.dataset.themeValue === value;
    card.classList.toggle('is-selected', isSelected);
    card.setAttribute('aria-selected', isSelected ? 'true' : 'false');
  });
  if (emitChange) {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  updateThemePickerSummary(input);
}

function syncThemePickerInput(input) {
  const wrapper = input.closest('.theme-picker');
  if (!wrapper) return;
  const grid = wrapper.querySelector('.theme-picker-grid');
  if (!grid) return;
  setThemePickerValue(grid, input, input.value, false);
}

function updateThemePickerSummary(input) {
  const wrapper = input.closest('.theme-picker');
  if (!wrapper) return;
  const summaryTitle = wrapper.querySelector('.theme-summary-title');
  const summaryMeta = wrapper.querySelector('.theme-summary-meta');
  const summaryImg = wrapper.querySelector('.theme-summary-preview img');
  if (!summaryTitle || !summaryMeta || !summaryImg) return;

  const theme = input.value || '';
  const themeBase = theme.replace(/\.css$/i, '');
  const themeLabel = themeBase
    .split(/[-_]+/g)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

  summaryTitle.textContent = themeLabel || 'No theme selected';
  summaryMeta.textContent = theme || '—';
  summaryImg.src = theme ? `/css/theme-thumbnails/${themeBase}.jpg` : '';
  summaryImg.onerror = () => {
    summaryImg.removeAttribute('src');
  };
}

function createMedia(field) {
  // Show a list of media elements and preserve the data in read-only format
  const wrapper = document.createElement('div');
  wrapper.className = 'advanced';

  const label = document.createElement('label');
  label.textContent = field.label && field.label[lang] ? field.label[lang] : 'Media';
  label.style = 'font-weight: bold; display: block; margin-bottom: 0.5rem;';
  wrapper.appendChild(label);

  const list = document.createElement('ul');
  list.id = 'media-list';
  list.style = 'padding-left: 1.2rem;';

  // mediaData will be filled later via `setValues()` (same as macros)
  list.dataset.populated = 'false';
  wrapper.appendChild(list);

  const hidden = document.createElement('textarea');
  hidden.name = 'media';
  hidden.id = 'media-json';
  hidden.style = 'display: none;';
  wrapper.appendChild(hidden);

  return wrapper;
}

function toggleAdvanced() {
  // FIXME: show all elements with class="advanced" (hidden now with css)
  const advanced = document.getElementById('show-advanced').checked;
  document.querySelectorAll('.advanced').forEach(el => {
    el.style.display = advanced ? 'block' : 'none';
  });
}

window.translationsources.push('/admin/locales/translations.json');
