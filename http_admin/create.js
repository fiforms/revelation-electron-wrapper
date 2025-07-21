import schema from './presentation-schema.json' assert { type: 'json' };

const form = document.getElementById('create-form');

function createField(key, def) {
  const wrapper = document.createElement('div');
  const label = document.createElement('label');
  label.textContent = def.label || key;

  // Show doc as a tooltip on the label
  if (def.doc) label.title = def.doc;

  let input;
  let appDefault = def.default;
  if( def.appDefault ) {
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

form.addEventListener('submit', submitForm); 


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

    const res = await window.electronAPI.createPresentation(filtered);
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
