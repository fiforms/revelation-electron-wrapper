// plugins/mediafx/ui.js
const job = {
  input: null,
  effect: 'ken_burns',
  params: {},
  output: {
    format: 'mp4',
    path: null,
    resolution: '1920x1080'
  }
};

const effectParamsContainer = document.getElementById('effect-params');
const effectSelect = document.getElementById('effect-select');
const outputResolution = document.getElementById('output-resolution');
const customResolutionLabel = document.getElementById('custom-resolution-label');
const customWidthInput = document.getElementById('custom-width');
const customHeightInput = document.getElementById('custom-height');

const EFFECT_SCHEMAS = {
  laser: {
    description: 'Animated radial rays / spotlight effect',

    params: [
      { flag: '--focal-x', type: 'float', default: 'center' },
      { flag: '--focal-y', type: 'float', default: 'center' },
      { flag: '--focal-motion-x', type: 'float', default: 0.0 },
      { flag: '--focal-motion-y', type: 'float', default: 0.0 },
      { flag: '--focal-random', type: 'float', default: 2.0 },

      { flag: '--rays', type: 'int', default: 8 },
      { flag: '--intensity', type: 'float', min: 0, max: 1, default: 0.5 },
      { flag: '--ray-width', type: 'float', default: 0.3 },
      { flag: '--ray-width-var', type: 'float', default: 0.1 },

      { flag: '--morph-speed', type: 'float', default: 0.05 },
      { flag: '--rotation', type: 'float', default: 0.0 },

      { flag: '--color-r', type: 'float', min: 0, max: 1, default: 1.0 },
      { flag: '--color-g', type: 'float', min: 0, max: 1, default: 1.0 },
      { flag: '--color-b', type: 'float', min: 0, max: 1, default: 1.0 }
    ]
  }
};

function renderEffectParams(effect) {
  effectParamsContainer.innerHTML = '';
  job.params = {};

  EFFECT_SCHEMAS[effect].forEach(p => {
    const label = document.createElement('label');
    label.textContent = p.label;

    const input = document.createElement('input');
    input.type = p.type;
    input.value = p.default;
    if (p.step) input.step = p.step;

    input.addEventListener('input', () => {
      job.params[p.name] = Number(input.value);
    });

    job.params[p.name] = p.default;

    label.appendChild(input);
    effectParamsContainer.appendChild(label);
  });
}

effectSelect.addEventListener('change', () => {
  job.effect = effectSelect.value;
  renderEffectParams(job.effect);
});

outputResolution.addEventListener('change', () => {
    if (outputResolution.value === 'custom') {
        customResolutionLabel.style.display = 'block';
    } else {
        customResolutionLabel.style.display = 'none';
    }
  job.output.resolution = outputResolution.value;
});

renderEffectParams(job.effect);

// Rendering stub
document.getElementById('render').addEventListener('click', () => {
  console.log('JOB SPEC:', job);
  alert('Rendering not yet implemented.');
});
