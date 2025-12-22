// plugins/mediafx/ui.js
const state = {
  effects: [],                 // populated from plugin
  selectedEffect: null,         // effect schema object

  video: {
    width: 1920,
    height: 1080,
    fps: 30,
    duration: 5,
    fade: 0.0,
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

  effectOptions: {},            // { "--flakes": 150, "--spin": true }

  output: {
    path: null,
    formatPreset: 'mp4-h264',
    overwrite: false
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

// Rendering stub
document.getElementById('render').addEventListener('click', () => {
  console.log('JOB SPEC:', state);
  alert('Rendering not yet implemented.');
});
