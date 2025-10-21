let schema = {};
await fetch('./presentation-schema.json')
  .then(res => res.json())
  .then(data => {
    schema = data;
  });


const form = document.getElementById('create-form');

form.appendChild(buildForm(schema));

const submitBtn = document.createElement('button');
submitBtn.type = 'submit';
submitBtn.class = 'submit-button';
if(window.editMode) {
  submitBtn.textContent = 'Save Metadata';
} else {
  submitBtn.textContent = 'Create Presentation';
}
form.appendChild(submitBtn);

form.addEventListener('submit', submitForm); 

const advancedCheckbox = document.getElementById('show-advanced');
advancedCheckbox.addEventListener('change',toggleAdvanced);

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
  arrayLabel.textContent = field.label || key;
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
  label.textContent = def.label || key;

  // Show doc as a tooltip on the label
  if (def.doc) label.title = def.doc;

  if (def.advanced) wrapper.className = 'advanced';

  let input;
  let appDefault = def.default;
  if( def.appDefault !== undefined ) {
    appDefault = def.appDefault;
  }
  if (appDefault === 'today') {
    appDefault = new Date().toISOString().slice(0, 10); // Format as YYYY-MM-DD
  }
  if (def.type === 'select') {
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
    if( key === 'theme') {
      // Populate theme options if available
      populateThemeOptions(input);
    }
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
      res = await window.electronAPI.createPresentation(filtered);
    }
    result.textContent = res.message;
    result.style.color = 'limegreen';

    if (res.success && res.slug) {

      if(!window.editMode) {
        // Open the folder after successful creation
        await window.electronAPI.showPresentationFolder(res.slug);
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

// Populate theme options if available
async function populateThemeOptions(selectElement) {
  const themes = await window.electronAPI.getAvailableThemes();
  themes.forEach(theme => {
    const opt = document.createElement('option');
    opt.value = theme;
    opt.textContent = theme;
    selectElement.appendChild(opt);
  });
}

function createMedia(field) {
  // Show a list of media elements and preserve the data in read-only format
  const wrapper = document.createElement('div');
  wrapper.className = 'advanced';

  const label = document.createElement('label');
  label.textContent = field.label || 'Media';
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