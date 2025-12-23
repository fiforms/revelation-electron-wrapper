// plugins/mediafx/ui.js
const state = {
  effects: [],                 // populated from plugin
  inputFiles: [],              // array of input file paths
  selectedEffect: null,         // effect schema object

  video: {
    width: 1920,
    height: 1080,
    fps: 30,
    duration: 30,        
    fade: 2.0,               // seconds
    crf: 23
  },

  audio: {
    codec: null,
    bitrate: 192
  },

  background: {
    type: 'none',               // 'none' | 'image' | 'video'
    path: null
  },

  effectOptions: {},            // 

  output: {
    path: null,
    pattern: 'output_{index}.{ext}',   // used if multiple input files
    formatPreset: 'mp4',
    overwrite: false,
    concurrency: 2
  }
};


const effectSelect = document.getElementById('effect-select');
const outputResolution = document.getElementById('output-resolution');
const customResolutionLabel = document.getElementById('custom-resolution-label');
const customWidthInput = document.getElementById('custom-width');
const customHeightInput = document.getElementById('custom-height');

const EFFECT_SCHEMAS = {};

// Fetch effect list from the main process
window.electronAPI.pluginTrigger('mediafx', 'listEffects').then(effects => {
    if(!effects || effects.length === 0) {
        console.error('No effects received from mediafx plugin API');
        return;
    }
    effects.forEach(effect => {
      const option = document.createElement('option');
      option.value = effect.name;
      option.textContent = effect.name + ' - ' + effect.description;
      effectSelect.appendChild(option);
      EFFECT_SCHEMAS[effect.name] = effect;
    }
  );
});


function renderEffectOptions(selectedEffect) {
  const container = document.getElementById('effect-params');
  container.innerHTML = '';
  state.effectOptions = {};

  if(!selectedEffect || !EFFECT_SCHEMAS[selectedEffect]) {
    console.log('No effect schema found for ', selectedEffect);
    console.log(EFFECT_SCHEMAS);
    return;
  }

  const effect = EFFECT_SCHEMAS[selectedEffect];

  effect.options.forEach(opt => {
    const wrapper = document.createElement('div');
    wrapper.className = 'option';

    const label = document.createElement('label');
    label.textContent = opt.description;
    wrapper.appendChild(label);

    let input;

    if (opt.type === 'boolean') {
      input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = opt.default === 'true';
      if (input.checked) state.effectOptions[opt.name] = true;

      input.addEventListener('change', () => {
        if (input.checked) state.effectOptions[opt.name] = true;
        else delete state.effectOptions[opt.name];
      });

    } else {
      input = document.createElement('input');
      input.type = opt.type === 'int' || opt.type === 'float'
        ? 'number'
        : 'text';

      if (opt.range) {
        input.min = opt.range.low;
        input.max = opt.range.high;
      }

      if (opt.default !== undefined) {
        input.value = opt.default;
        state.effectOptions[opt.name] =
          opt.type === 'int' ? parseInt(opt.default) :
          opt.type === 'float' ? parseFloat(opt.default) :
          opt.default;
      }

      input.addEventListener('input', () => {
        state.effectOptions[opt.name] =
          opt.type === 'int' ? parseInt(input.value) :
          opt.type === 'float' ? parseFloat(input.value) :
          input.value;
      });
    }

    wrapper.appendChild(input);
    container.appendChild(wrapper);
  });
}


effectSelect.addEventListener('change', () => {
  state.selectedEffect = effectSelect.value;
  renderEffectOptions(state.selectedEffect);
});

outputResolution.addEventListener('change', () => {
    if (outputResolution.value === 'custom') {
        customResolutionLabel.style.display = 'block';
    } else {
        customResolutionLabel.style.display = 'none';
    }
  state.video.width = outputResolution.value.split('x')[0];
  state.video.height = outputResolution.value.split('x')[1];
});


document.getElementById('select-input').addEventListener('click', async () => {
  const filePaths = await window.electronAPI.pluginTrigger('mediafx', 'showOpenMediaDialog');
  if (filePaths && filePaths.length > 0) {
    console.log('Selected input files:', filePaths);
    state.inputFiles = filePaths;
    document.getElementById('select-input').innerHTML = filePaths.length + " file" + (filePaths.length > 1 ? "s" : "") + " selected";
    document.getElementById('select-input').title = filePaths.join('\n');
    state.output.path = null;
    if(filePaths.length > 1) {
      document.getElementById('select-output').textContent = "Select Output Folder";
      document.getElementById('output-pattern-label').style.display = 'block';
    } else {
      document.getElementById('select-output').textContent = "Select Output File";
      document.getElementById('output-pattern-label').style.display = 'none';
    }
    toggleRenderButton();
  }
});

document.getElementById('output-pattern').addEventListener('input', (event) => {
  state.output.pattern = event.target.value;
});

document.getElementById('select-output').addEventListener('click', async () => {
  const filePath = await window.electronAPI.pluginTrigger('mediafx', 'showSaveMediaDialog', {'choosefolder': state.inputFiles && state.inputFiles.length > 1});
  if (filePath) {
    state.output.path = filePath;
    document.getElementById('select-output').title = filePath;
    document.getElementById('select-output').textContent = "Output Selected";
    toggleRenderButton();
  }
});

document.getElementById('output-format').addEventListener('change', (event) => {
  state.output.formatPreset = event.target.value;
});

document.getElementById('overwrite-output').addEventListener('change', (event) => {
  state.output.overwrite = event.target.checked;
});

document.getElementById('output-concurrency').addEventListener('input', (event) => {
  state.output.concurrency = parseInt(event.target.value);
});

// Rendering stub
document.getElementById('render').addEventListener('click', () => {
  console.log('Starting rendering with state:', state);
  window.electronAPI.pluginTrigger('mediafx', 'startEffectProcess', state);
  window.setTimeout(pollProcessStatus, 300);
});

function pollProcessStatus() {
    window.electronAPI.pluginTrigger('mediafx', 'getAllProcesses').then(processes => {
      console.log('Current processes:', processes);
      if(processes.pendingProcesses === 0 && processes.runningProcesses === 0) {
        console.log('All processes completed.');
        return;
      }
      else {
        window.setTimeout(pollProcessStatus, 300);
      }
    });
}

function toggleRenderButton() {
  const renderButton = document.getElementById('render');
  renderButton.disabled = !state.inputFiles || !state.output.path;
  const outputSelect = document.getElementById('select-output');
  outputSelect.disabled = !state.inputFiles || state.inputFiles.length === 0;
}