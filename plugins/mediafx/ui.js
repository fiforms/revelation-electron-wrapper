// plugins/mediafx/ui.js
const state = {
  effects: [],                 // populated from plugin
  inputFiles: [],              // array of input file paths
  selectedEffect: 'none',
  selectedEffectEngine: 'none',
  effectLayers: [],
  openLayerId: null,

  video: {
    width: 1920,
    height: 1080,
    fps: 30,
    duration: 30,        
    fade: 2.0,               // seconds
    crf: 23
  },

  effectGlobal: {
    warmup: 0.0,
    maxFade: 1.0
  },

  audio: {
    codec: null,
    bitrate: 192
  },

  background: {
    type: 'none',               // 'none' | 'image' | 'video'
    path: null
  },

  effectOptions: {},

  output: {
    path: null,
    pattern: 'output_{index}.{ext}',   // used if multiple input files
    formatPreset: 'mp4',
    overwrite: false,
    concurrency: 2
  }
};
let currentProcessId = null;
let nextLayerId = 1;


const effectLayersContainer = document.getElementById('effect-layers');
const addEffectLayerButton = document.getElementById('add-effect-layer');
const outputResolution = document.getElementById('output-resolution');
const customResolutionLabel = document.getElementById('custom-resolution-label');
const customResolution = document.getElementById('custom-resolution');
const globalWarmupInput = document.getElementById('global-warmup');
const globalMaxFadeInput = document.getElementById('global-max-fade');
const outputFpsInput = document.getElementById('output-fps');
const outputCrfInput = document.getElementById('output-crf');
const outputFadeInput = document.getElementById('output-fade');
const outputAudioCodecSelect = document.getElementById('output-audio-codec');
const outputAudioCodecCustomLabel = document.getElementById('output-audio-codec-custom-label');
const outputAudioCodecCustomInput = document.getElementById('output-audio-codec-custom');
const outputAudioBitrateInput = document.getElementById('output-audio-bitrate');
const stillDurationInput = document.getElementById('still-duration');

const EFFECT_SCHEMAS = {};

function normalizeDefaultValue(option, value) {
  if (option.type === 'boolean') return value === true || value === 'true';
  if (option.type === 'int') return parseInt(value, 10);
  if (option.type === 'float') return parseFloat(value);
  return value;
}

function getOptionDefaultValue(option) {
  if (!option || option.default === undefined) return undefined;
  const normalized = normalizeDefaultValue(option, option.default);
  if (Number.isNaN(normalized)) return undefined;
  return normalized;
}

function getOptionChoices(option) {
  if (!option) return [];
  if (Array.isArray(option.choices)) return option.choices;
  if (Array.isArray(option.enum)) return option.enum;
  return [];
}

function isHexColor(value) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

function normalizeHexColor(value) {
  if (!isHexColor(value)) return null;
  return value.toUpperCase();
}

function getEffectDisplayName(effectName) {
  if (!effectName || effectName === 'none') return 'No Effect';
  return effectName;
}

function getLayerSortPriority(layer) {
  if (!layer || !layer.effect || layer.effect === 'none') return 2;
  if (layer.engine === 'ffmpeg') return 0;
  if (layer.engine === 'effectgenerator') return 1;
  return 1;
}

function sortLayersForDisplay() {
  state.effectLayers.sort((a, b) => {
    const priorityDiff = getLayerSortPriority(a) - getLayerSortPriority(b);
    if (priorityDiff !== 0) return priorityDiff;
    return a.id - b.id;
  });
}

function getLayerEngineLabel(layer) {
  if (!layer || !layer.effect || layer.effect === 'none') return 'None';
  if (layer.engine === 'ffmpeg') return 'FFmpeg';
  if (layer.engine === 'effectgenerator') return 'EffectGenerator';
  return layer.engine || 'Unknown';
}

function createEffectLayer(effectName = 'none') {
  const schema = EFFECT_SCHEMAS[effectName];
  return {
    id: nextLayerId++,
    effect: effectName,
    engine: schema ? schema.engine : 'none',
    options: {},
    maxFade: null,
    showAdvancedOptions: false
  };
}

function syncLegacyEffectState() {
  const firstActiveLayer = state.effectLayers.find(layer => layer.effect !== 'none');
  if (!firstActiveLayer) {
    state.selectedEffect = 'none';
    state.selectedEffectEngine = 'none';
    state.effectOptions = {};
    return;
  }
  state.selectedEffect = firstActiveLayer.effect;
  state.selectedEffectEngine = firstActiveLayer.engine || 'none';
  state.effectOptions = Object.assign({}, firstActiveLayer.options);
}

function renderLayerOptions(layer, container) {
  const effect = EFFECT_SCHEMAS[layer.effect];
  if (!effect || !Array.isArray(effect.options) || effect.options.length === 0) {
    const empty = document.createElement('div');
    empty.textContent = 'No options for this effect.';
    container.appendChild(empty);
    return;
  }

  const standardOptions = effect.options.filter(opt => !opt.advanced);
  const advancedOptions = effect.options.filter(opt => !!opt.advanced);

  const renderOption = (opt) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'option';

    const label = document.createElement('label');
    label.textContent = opt.description;
    wrapper.appendChild(label);

    let input;
    const choiceValues = getOptionChoices(opt);
    const hasChoices = choiceValues.length > 0;

    if (opt.type === 'boolean') {
      input = document.createElement('input');
      input.type = 'checkbox';
      const defaultValue = getOptionDefaultValue(opt);
      const hasOverride = Object.prototype.hasOwnProperty.call(layer.options, opt.name);
      input.checked = hasOverride ? !!layer.options[opt.name] : !!defaultValue;
      input.addEventListener('change', () => {
        const isDefault = input.checked === !!defaultValue;
        if (isDefault) {
          delete layer.options[opt.name];
        } else if (input.checked) {
          layer.options[opt.name] = true;
        } else {
          delete layer.options[opt.name];
        }
        syncLegacyEffectState();
      });
    } else if (opt.type === 'string.color' && hasChoices) {
      const defaultValue = getOptionDefaultValue(opt);
      const hasOverride = Object.prototype.hasOwnProperty.call(layer.options, opt.name);
      const overrideValue = hasOverride ? String(layer.options[opt.name]) : null;
      const defaultColorValue = normalizeHexColor(String(defaultValue || ''));
      const overrideColorValue = normalizeHexColor(overrideValue || '');
      const fallbackColor = overrideColorValue || defaultColorValue || '#FFFFFF';

      const select = document.createElement('select');
      const defaultOption = document.createElement('option');
      defaultOption.value = '__default__';
      defaultOption.textContent = defaultValue !== undefined ? `Default (${defaultValue})` : 'Default';
      select.appendChild(defaultOption);

      choiceValues.forEach(choice => {
        const optionEl = document.createElement('option');
        optionEl.value = String(choice);
        optionEl.textContent = String(choice);
        select.appendChild(optionEl);
      });

      const customOption = document.createElement('option');
      customOption.value = '__custom__';
      customOption.textContent = 'Custom Color';
      select.appendChild(customOption);

      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.value = fallbackColor;
      colorInput.style.marginTop = '0.5rem';

      if (hasOverride && choiceValues.includes(overrideValue)) {
        select.value = overrideValue;
      } else if (hasOverride && overrideColorValue) {
        select.value = '__custom__';
      } else {
        select.value = '__default__';
      }
      colorInput.style.display = select.value === '__custom__' ? 'block' : 'none';

      select.addEventListener('change', () => {
        if (select.value === '__default__') {
          delete layer.options[opt.name];
          colorInput.style.display = 'none';
        } else if (select.value === '__custom__') {
          layer.options[opt.name] = normalizeHexColor(colorInput.value);
          colorInput.style.display = 'block';
        } else if (defaultValue !== undefined && select.value === String(defaultValue)) {
          delete layer.options[opt.name];
          colorInput.style.display = 'none';
        } else {
          layer.options[opt.name] = select.value;
          colorInput.style.display = 'none';
        }
        syncLegacyEffectState();
      });

      colorInput.addEventListener('input', () => {
        if (select.value !== '__custom__') return;
        const normalized = normalizeHexColor(colorInput.value);
        if (normalized) {
          layer.options[opt.name] = normalized;
          syncLegacyEffectState();
        }
      });

      wrapper.appendChild(select);
      wrapper.appendChild(colorInput);
      container.appendChild(wrapper);
      return;
    } else if (opt.type === 'string.color') {
      const defaultValue = getOptionDefaultValue(opt);
      const hasOverride = Object.prototype.hasOwnProperty.call(layer.options, opt.name);
      const defaultColorValue = normalizeHexColor(String(defaultValue || ''));
      const overrideColorValue = hasOverride ? normalizeHexColor(String(layer.options[opt.name])) : null;
      const colorValue = overrideColorValue || defaultColorValue || '#FFFFFF';

      input = document.createElement('input');
      input.type = 'color';
      input.value = colorValue;
      input.addEventListener('input', () => {
        const normalized = normalizeHexColor(input.value);
        if (!normalized) return;
        if (defaultColorValue && normalized === defaultColorValue) {
          delete layer.options[opt.name];
        } else {
          layer.options[opt.name] = normalized;
        }
        syncLegacyEffectState();
      });
    } else if (hasChoices) {
      const defaultValue = getOptionDefaultValue(opt);
      const hasOverride = Object.prototype.hasOwnProperty.call(layer.options, opt.name);
      const overrideValue = hasOverride ? String(layer.options[opt.name]) : '';

      input = document.createElement('select');
      const defaultOption = document.createElement('option');
      defaultOption.value = '__default__';
      defaultOption.textContent = defaultValue !== undefined ? `Default (${defaultValue})` : 'Default';
      input.appendChild(defaultOption);

      choiceValues.forEach(choice => {
        const optionEl = document.createElement('option');
        optionEl.value = String(choice);
        optionEl.textContent = String(choice);
        input.appendChild(optionEl);
      });

      if (hasOverride && !choiceValues.includes(overrideValue)) {
        const customExisting = document.createElement('option');
        customExisting.value = overrideValue;
        customExisting.textContent = `Current (${overrideValue})`;
        input.appendChild(customExisting);
      }

      if (hasOverride) {
        input.value = overrideValue;
      } else {
        input.value = '__default__';
      }

      input.addEventListener('change', () => {
        if (input.value === '__default__') {
          delete layer.options[opt.name];
        } else if (defaultValue !== undefined && input.value === String(defaultValue)) {
          delete layer.options[opt.name];
        } else {
          layer.options[opt.name] = input.value;
        }
        syncLegacyEffectState();
      });
    } else {
      input = document.createElement('input');
      input.type = opt.type === 'int' || opt.type === 'float' ? 'number' : 'text';
      const defaultValue = getOptionDefaultValue(opt);
      if (opt.range) {
        input.min = opt.range.low;
        input.max = opt.range.high;
      }
      if (defaultValue !== undefined) {
        input.placeholder = String(defaultValue);
      }
      if (layer.options[opt.name] !== undefined) {
        input.value = String(layer.options[opt.name]);
      }
      input.addEventListener('input', () => {
        let parsed = input.value;
        if (opt.type === 'int') parsed = parseInt(input.value, 10);
        if (opt.type === 'float') parsed = parseFloat(input.value);
        if (input.value === '' || Number.isNaN(parsed)) {
          delete layer.options[opt.name];
        } else if (defaultValue !== undefined && parsed === defaultValue) {
          delete layer.options[opt.name];
        } else {
          layer.options[opt.name] = parsed;
        }
        syncLegacyEffectState();
      });
    }

    wrapper.appendChild(input);
    container.appendChild(wrapper);
  };

  standardOptions.forEach(renderOption);

  if (advancedOptions.length > 0) {
    const advancedToggleLabel = document.createElement('label');
    advancedToggleLabel.className = 'advanced-options-toggle';

    const advancedToggleInput = document.createElement('input');
    advancedToggleInput.type = 'checkbox';
    advancedToggleInput.checked = !!layer.showAdvancedOptions;
    advancedToggleInput.addEventListener('change', () => {
      layer.showAdvancedOptions = advancedToggleInput.checked;
      renderEffectLayers();
    });

    const advancedToggleText = document.createElement('span');
    advancedToggleText.textContent = 'Show Advanced Options';
    advancedToggleLabel.appendChild(advancedToggleInput);
    advancedToggleLabel.appendChild(advancedToggleText);
    container.appendChild(advancedToggleLabel);

    if (layer.showAdvancedOptions) {
      advancedOptions.forEach(renderOption);
    }
  }

  if (standardOptions.length === 0 && advancedOptions.length > 0 && !layer.showAdvancedOptions) {
    const empty = document.createElement('div');
    empty.textContent = 'No basic options for this effect. Enable advanced options to configure it.';
    container.appendChild(empty);
  }
}

function renderEffectLayers() {
  sortLayersForDisplay();
  effectLayersContainer.innerHTML = '';

  state.effectLayers.forEach((layer, index) => {
    const layerCard = document.createElement('section');
    layerCard.className = 'effect-layer';

    const headerRow = document.createElement('div');
    headerRow.className = 'effect-layer-header';

    const headerButton = document.createElement('button');
    headerButton.type = 'button';
    headerButton.className = 'effect-layer-toggle';
    headerButton.dataset.layerId = String(layer.id);

    const title = document.createElement('span');
    title.className = 'effect-layer-title';
    title.textContent = `Layer ${index + 1}: ${getEffectDisplayName(layer.effect)} [${getLayerEngineLabel(layer)}]`;
    headerButton.appendChild(title);

    headerRow.appendChild(headerButton);

    if (state.effectLayers.length > 1) {
      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'effect-layer-remove';
      removeButton.textContent = 'Remove';
      removeButton.dataset.removeLayerId = String(layer.id);
      headerRow.appendChild(removeButton);
    }

    layerCard.appendChild(headerRow);

    const isOpen = layer.id === state.openLayerId;
    if (isOpen) {
      const body = document.createElement('div');
      body.className = 'effect-layer-body';

      const effectLabel = document.createElement('label');
      effectLabel.textContent = 'Effect';
      const effectSelect = document.createElement('select');
      effectSelect.dataset.layerSelectId = String(layer.id);

      const noneOption = document.createElement('option');
      noneOption.value = 'none';
      noneOption.textContent = 'No Effect';
      effectSelect.appendChild(noneOption);

      Object.values(EFFECT_SCHEMAS).forEach(effectSchema => {
        const option = document.createElement('option');
        option.value = effectSchema.name;
        option.textContent = `${effectSchema.name} - ${effectSchema.description}`;
        effectSelect.appendChild(option);
      });

      effectSelect.value = layer.effect || 'none';
      effectLabel.appendChild(effectSelect);
      body.appendChild(effectLabel);

      const supportsLayerMaxFade =
        layer.effect &&
        layer.effect !== 'none' &&
        layer.effect !== 'loopfade' &&
        layer.engine === 'effectgenerator';
      if (supportsLayerMaxFade) {
        const layerMaxFadeLabel = document.createElement('label');
        layerMaxFadeLabel.textContent = 'Max Fade (0..1, uses global default when blank)';

        const layerMaxFadeInput = document.createElement('input');
        layerMaxFadeInput.type = 'number';
        layerMaxFadeInput.min = '0';
        layerMaxFadeInput.max = '1';
        layerMaxFadeInput.step = '0.05';
        layerMaxFadeInput.placeholder = String(state.effectGlobal.maxFade);
        if (layer.maxFade !== null && layer.maxFade !== undefined && !Number.isNaN(layer.maxFade)) {
          layerMaxFadeInput.value = String(layer.maxFade);
        }

        layerMaxFadeInput.addEventListener('input', () => {
          if (layerMaxFadeInput.value === '') {
            layer.maxFade = null;
            return;
          }
          const parsed = parseFloat(layerMaxFadeInput.value);
          if (Number.isNaN(parsed)) {
            layer.maxFade = null;
            return;
          }
          layer.maxFade = Math.min(1, Math.max(0, parsed));
        });

        layerMaxFadeLabel.appendChild(layerMaxFadeInput);
        body.appendChild(layerMaxFadeLabel);
      }

      const optionsContainer = document.createElement('div');
      renderLayerOptions(layer, optionsContainer);
      body.appendChild(optionsContainer);
      layerCard.appendChild(body);
    }

    effectLayersContainer.appendChild(layerCard);
  });
}

function ensureAtLeastOneLayer() {
  if (state.effectLayers.length === 0) {
    const defaultLayer = createEffectLayer('none');
    state.effectLayers.push(defaultLayer);
    state.openLayerId = defaultLayer.id;
  }
}

function initializeEffects(effects) {
  state.effects = Array.isArray(effects) ? effects : [];
  state.effects.forEach(effect => {
    EFFECT_SCHEMAS[effect.name] = effect;
  });
  ensureAtLeastOneLayer();
  syncLegacyEffectState();
  renderEffectLayers();
}

addEffectLayerButton.addEventListener('click', () => {
  const newLayer = createEffectLayer('none');
  state.effectLayers.push(newLayer);
  state.openLayerId = newLayer.id;
  syncLegacyEffectState();
  renderEffectLayers();
});

effectLayersContainer.addEventListener('click', (event) => {
  const removeButton = event.target.closest('[data-remove-layer-id]');
  if (removeButton) {
    const layerId = parseInt(removeButton.dataset.removeLayerId, 10);
    state.effectLayers = state.effectLayers.filter(layer => layer.id !== layerId);
    ensureAtLeastOneLayer();
    if (!state.effectLayers.some(layer => layer.id === state.openLayerId)) {
      state.openLayerId = state.effectLayers[0].id;
    }
    syncLegacyEffectState();
    renderEffectLayers();
    return;
  }

  const header = event.target.closest('[data-layer-id]');
  if (!header) return;
  const layerId = parseInt(header.dataset.layerId, 10);
  state.openLayerId = layerId;
  renderEffectLayers();
});

effectLayersContainer.addEventListener('change', (event) => {
  const select = event.target.closest('[data-layer-select-id]');
  if (!select) return;
  const layerId = parseInt(select.dataset.layerSelectId, 10);
  const layer = state.effectLayers.find(item => item.id === layerId);
  if (!layer) return;
  layer.effect = select.value;
  layer.engine = EFFECT_SCHEMAS[select.value] ? EFFECT_SCHEMAS[select.value].engine : 'none';
  layer.options = {};
  layer.maxFade = null;
  layer.showAdvancedOptions = false;
  syncLegacyEffectState();
  renderEffectLayers();
});

// Fetch effect list from the main process
window.electronAPI.pluginTrigger('mediafx', 'listEffects').then(effects => {
  if (!effects || effects.length === 0) {
    console.error('No effects received from mediafx plugin API');
    initializeEffects([]);
    return;
  }
  initializeEffects(effects);
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

globalWarmupInput.addEventListener('input', (event) => {
  const parsed = parseFloat(event.target.value);
  state.effectGlobal.warmup = Number.isNaN(parsed) ? 0 : Math.max(0, parsed);
});

globalMaxFadeInput.addEventListener('input', (event) => {
  const parsed = parseFloat(event.target.value);
  if (Number.isNaN(parsed)) {
    state.effectGlobal.maxFade = 1;
    return;
  }
  state.effectGlobal.maxFade = Math.min(1, Math.max(0, parsed));
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
