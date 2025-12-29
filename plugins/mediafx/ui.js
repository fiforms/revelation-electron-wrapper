// plugins/mediafx/ui.js
const state = {
  effects: [],                 // populated from plugin
  inputFiles: [],              // array of input file paths
  selectedEffect: null,         // effect schema object
  selectedEffectEngine: 'none',

  video: {
    width: 1920,
    height: 1080,
    fps: 30,
    duration: 30,        
    fade: 2.0,               // seconds
    maxFade: 1.0,            // 0..1
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
let currentProcessId = null;


const effectSelect = document.getElementById('effect-select');
const outputResolution = document.getElementById('output-resolution');
const customResolutionLabel = document.getElementById('custom-resolution-label');
const customResolution = document.getElementById('custom-resolution');
const outputFpsInput = document.getElementById('output-fps');
const outputCrfInput = document.getElementById('output-crf');
const outputFadeInput = document.getElementById('output-fade');
const outputMaxFadeInput = document.getElementById('output-max-fade');
const outputAudioCodecSelect = document.getElementById('output-audio-codec');
const outputAudioCodecCustomLabel = document.getElementById('output-audio-codec-custom-label');
const outputAudioCodecCustomInput = document.getElementById('output-audio-codec-custom');
const outputAudioBitrateInput = document.getElementById('output-audio-bitrate');
const stillDurationInput = document.getElementById('still-duration');

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
  const selectedEffect = EFFECT_SCHEMAS[state.selectedEffect];
  state.selectedEffectEngine = selectedEffect ? selectedEffect.engine : 'none';
  renderEffectOptions(state.selectedEffect);
});

outputResolution.addEventListener('change', () => {
    if (outputResolution.value === 'custom') {
        customResolutionLabel.style.display = 'block';
        state.video.width = outputResolution.value.split('x')[0];
        state.video.height = outputResolution.value.split('x')[1];
    } else {
        customResolutionLabel.style.display = 'none';
        customResolution.value = '1920x1080';
        state.video.width = 1920;
        state.video.height = 1080;
    }

});

customResolution.addEventListener('change', () => {
  // Check if valid format is entered
  if (!/^\d+x\d+$/.test(customResolution.value)) {
    return;
  }

  const [width, height] = customResolution.value.split('x');
  state.video.width = width;
  state.video.height = height;
});

outputFpsInput.addEventListener('input', (event) => {
  state.video.fps = parseInt(event.target.value);
});

outputCrfInput.addEventListener('input', (event) => {
  state.video.crf = parseInt(event.target.value);
});

outputFadeInput.addEventListener('input', (event) => {
  state.video.fade = parseFloat(event.target.value);
});

outputMaxFadeInput.addEventListener('input', (event) => {
  state.video.maxFade = parseFloat(event.target.value);
});

outputAudioBitrateInput.addEventListener('input', (event) => {
  state.audio.bitrate = parseInt(event.target.value);
});

stillDurationInput.addEventListener('input', (event) => {
  state.video.duration = parseFloat(event.target.value);
});

function updateAudioControls() {
  const selection = outputAudioCodecSelect.value;
  const isCustom = selection === 'custom';
  const isNone = selection === 'none';
  const isCopy = selection === 'copy';
  const customValue = outputAudioCodecCustomInput.value.trim();

  outputAudioCodecCustomLabel.style.display = isCustom ? 'block' : 'none';
  outputAudioCodecCustomInput.disabled = !isCustom;
  outputAudioBitrateInput.disabled = isNone || isCopy;

  if (isNone) {
    state.audio.codec = null;
    return;
  }

  if (isCustom) {
    state.audio.codec = customValue || null;
    return;
  }

  state.audio.codec = selection;
}

outputAudioCodecSelect.addEventListener('change', () => {
  updateAudioControls();
});

outputAudioCodecCustomInput.addEventListener('input', () => {
  if (outputAudioCodecSelect.value === 'custom') {
    updateAudioControls();
  }
});

updateAudioControls();

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

document.getElementById('select-medialibrary').addEventListener('click', async () => {
  const mediaInfo = await window.electronAPI.pluginTrigger('mediafx', 'showMediaLibraryDialog');
  if(!mediaInfo) {
    return;
  }
  const filePaths = [];
  filePaths.push(mediaInfo.filePath);

  if (filePaths && filePaths.length > 0) {
    console.log('Selected input files from media library:', filePaths);
    state.inputFiles = filePaths;
    document.getElementById('select-input').disabled = true;
    document.getElementById('select-medialibrary').title = mediaInfo.title || '';
    document.getElementById('select-input').innerHTML = "1 file selected from Media Library";
    state.output.path = null;
    document.getElementById('select-output').textContent = "Select Output File";
    document.getElementById('output-pattern-label').style.display = 'none';
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
document.getElementById('render').addEventListener('click', async () => {
  console.log('Starting rendering with state:', state);
  const result = await window.electronAPI.pluginTrigger('mediafx', 'startEffectProcess', state);
  currentProcessId = result && result.processId ? result.processId : null;
  document.getElementById('render-progress-bar-container').style.display = 'block';
  document.getElementById('render-cancel').disabled = !currentProcessId;
  window.setTimeout(pollProcessStatus, 300);
});

document.getElementById('render-cancel').addEventListener('click', async () => {
  if (!currentProcessId) return;
  await window.electronAPI.pluginTrigger('mediafx', 'cancelProcess', currentProcessId);
  document.getElementById('render-cancel').disabled = true;
});

function pollProcessStatus() {
    window.electronAPI.pluginTrigger('mediafx', 'getAllProcesses').then(result => {
      const proc = result.processes.pop();
      console.log(`Status=${proc.status}, completedFiles=${proc.completedFiles}/${proc.totalFiles}, duration=${proc.aggregateDuration}, currentTime=${proc.aggregateProgress}`);

      const progressFiles = proc.completedFiles / proc.totalFiles * 100;
      const progressSeconds = proc.aggregateProgress / proc.aggregateDuration * 100;
      if(progressFiles >= 0 && progressFiles <= 100) {
        document.getElementById('render-progress-bar-files').value = progressFiles;
      }
      if(progressSeconds >= 0 && progressSeconds <= 100) {
        document.getElementById('render-progress-bar-seconds').value = progressSeconds;
      }

      if(proc.completedFiles === proc.totalFiles) {
        console.log('All processes completed.');
        document.getElementById('render-progress-bar-container').style.display = 'none';
        document.getElementById('render-cancel').disabled = true;
        currentProcessId = null;
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
