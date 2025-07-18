import schema from './presentation-schema.json' assert { type: 'json' };

const form = document.getElementById('create-form');

function createField(key, def) {
  const wrapper = document.createElement('div');
  const label = document.createElement('label');
  label.textContent = def.label || key;

  // Show doc as a tooltip on the label
  if (def.doc) label.title = def.doc;

  let input;
  if (def.type === 'select') {
    input = document.createElement('select');
    def.options.forEach(opt => {
      const option = document.createElement('option');
      option.value = opt;
      option.textContent = String(opt);
      input.appendChild(option);
    });
    input.value = def.default;
  } else if (def.type === 'boolean') {
    input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = def.default;
  } else if (def.type === 'textarea') {
    input = document.createElement('textarea');
    input.value = def.default || '';
  } else {
    input = document.createElement('input');
    input.type = def.type === 'date' ? 'date' : 'text';
    input.value = def.default === 'today' ? new Date().toISOString().slice(0, 10) : def.default || '';
  }

  input.name = key;

  // Optional: also set doc as a tooltip on the input itself
  if (def.doc) input.title = def.doc;

  wrapper.appendChild(label);
  wrapper.appendChild(input);
  return wrapper;
}


function buildForm(schema, parentKey = '') {
  const fragment = document.createDocumentFragment();
  for (const key in schema) {
    const fullKey = parentKey ? `${parentKey}.${key}` : key;
    const field = schema[key];

    if (field.type === 'object') {
      const subFields = buildForm(field.fields, fullKey);
      fragment.appendChild(document.createElement('hr'));
      fragment.appendChild(subFields);
    } else if (field.type === 'array') {
      // Skip for now — will need dynamic UI for macros
    } else {
      fragment.appendChild(createField(fullKey, field));
    }
  }
  return fragment;
}

form.appendChild(buildForm(schema));

const submitBtn = document.createElement('button');
submitBtn.type = 'submit';
submitBtn.class = 'submit-button';
submitBtn.textContent = 'Create Presentation';
form.appendChild(submitBtn);

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const result = document.getElementById('result');
  result.textContent = ''; // clear previous message

  try {
    const formData = new FormData(form);
    const yamlData = {};

    for (const [key, value] of formData.entries()) {
      const keys = key.split('.');
      let cur = yamlData;
      while (keys.length > 1) {
        const part = keys.shift();
        cur[part] = cur[part] || {};
        cur = cur[part];
      }
      // Parse booleans and numbers intelligently
      const finalKey = keys[0];
      if (value === 'true') {
        cur[finalKey] = true;
      } else if (value === 'false') {
        cur[finalKey] = false;
      } else if (!isNaN(value) && value.trim() !== '') {
        cur[finalKey] = parseFloat(value);
      } else {
        cur[finalKey] = value;
      }
    }

    // Special-case checkboxes (not included in FormData if unchecked)
    form.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      const keys = cb.name.split('.');
      let cur = yamlData;
      while (keys.length > 1) {
        const part = keys.shift();
        cur[part] = cur[part] || {};
        cur = cur[part];
      }
      cur[keys[0]] = cb.checked;
    });

    const res = await window.electronAPI.createPresentation(yamlData);
    result.textContent = res.message;
    result.style.color = 'limegreen';

    if (res.success && res.slug) {
      // Open the folder after successful creation
      await window.electronAPI.showPresentationFolder(res.slug);

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
});

