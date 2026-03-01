export const uiMethods = {
  // Converts an RGBA/RGB color to an opaque RGB string for SVG cursor rendering.
  normalizeColorForCursor(colorValue) {
    const raw = String(colorValue || '').trim();
    const rgbaMatch = raw.match(/^rgba\(([^,]+),([^,]+),([^,]+),([^)]+)\)$/i);
    if (rgbaMatch) {
      return `rgb(${rgbaMatch[1].trim()},${rgbaMatch[2].trim()},${rgbaMatch[3].trim()})`;
    }
    const rgbMatch = raw.match(/^rgb\(([^,]+),([^,]+),([^)]+)\)$/i);
    if (rgbMatch) {
      return `rgb(${rgbMatch[1].trim()},${rgbMatch[2].trim()},${rgbMatch[3].trim()})`;
    }
    return raw || 'rgb(255,59,48)';
  },

  // Returns a CSS cursor URL/string for the active marker tool.
  getCanvasCursorForTool() {
    if (this.selectedTool === 'eraser') {
      const size = Math.max(12, Math.min(48, Math.round((Number(this.tool.width) || 1) * 0.35)));
      const center = Math.round(size / 2);
      const radius = Math.max(4, center - 2);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${center}" cy="${center}" r="${radius}" fill="rgba(255,255,255,0.10)" stroke="white" stroke-width="1.5"/><line x1="${center}" y1="1" x2="${center}" y2="${size - 1}" stroke="rgba(255,255,255,0.7)" stroke-width="1"/><line x1="1" y1="${center}" x2="${size - 1}" y2="${center}" stroke="rgba(255,255,255,0.7)" stroke-width="1"/></svg>`;
      return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") ${center} ${center}, crosshair`;
    }

    if (this.selectedTool === 'highlighter') {
      const color = this.normalizeColorForCursor(this.selectedColor);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26"><path d="M5 19 L10 22 L21 11 L15 5 Z" fill="${color}" stroke="white" stroke-width="1.2"/><rect x="3" y="20" width="8" height="3" rx="1" fill="rgba(255,255,255,0.85)"/></svg>`;
      return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") 5 21, crosshair`;
    }

    const color = this.normalizeColorForCursor(this.selectedColor);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M4 19 L9 18 L20 7 L16 3 Z" fill="${color}" stroke="white" stroke-width="1.2"/><polygon points="3,20 7,21 4,23" fill="rgba(255,255,255,0.9)"/></svg>`;
    return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") 4 21, crosshair`;
  },

  // Applies cursor styling to the drawing canvas only; toolbar keeps normal pointer UX.
  updateCanvasCursor() {
    if (!this.canvas) return;
    if (!this.state.enabled) {
      this.canvas.style.cursor = 'default';
      return;
    }
    if (!this.canCurrentUserDraw()) {
      this.canvas.style.cursor = 'not-allowed';
      return;
    }
    this.canvas.style.cursor = this.getCanvasCursorForTool();
  },

  // Shows toolbar only when markerboard is enabled and this client can author changes.
  updateToolbarVisibility() {
    if (!this.toolbar) return;
    const canEdit = !!this.state.enabled && this.canCurrentUserDraw();
    this.toolbar.style.display = canEdit ? 'flex' : 'none';
  },

  setTool(toolName) {
    const preset = this.toolPresets[toolName];
    if (!preset) return;
    this.selectedTool = toolName;
    this.tool.tool = toolName;
    this.tool.width = preset.width;
    this.tool.compositeMode = preset.compositeMode;
    this.tool.color = this.getEffectiveColorForTool(this.selectedColor, toolName);
    if (this.widthSlider) {
      this.widthSlider.max = String(preset.maxWidth || 150);
    }
    this.updateToolbarSelection();
    this.updateCanvasCursor();
  },

  setColor(colorValue) {
    this.selectedColor = colorValue;
    if (this.selectedTool !== 'eraser') {
      this.tool.color = this.getEffectiveColorForTool(colorValue, this.selectedTool);
    }
    this.updateToolbarSelection();
    this.updateCanvasCursor();
  },

  setWidth(widthValue) {
    const preset = this.toolPresets[this.selectedTool] || {};
    const maxWidth = Number(preset.maxWidth) || 150;
    const width = Math.max(1, Math.min(maxWidth, Number(widthValue) || 1));
    if (this.toolPresets[this.selectedTool]) {
      this.toolPresets[this.selectedTool].width = width;
    }
    this.tool.width = width;
    this.updateToolbarSelection();
    this.updateCanvasCursor();
  },

  getEffectiveColorForTool(colorValue, toolName) {
    if (toolName === 'eraser') return 'rgba(0,0,0,1)';
    if (toolName !== 'highlighter') return colorValue;

    // Keep selected hue but force low-opacity highlight strokes.
    const raw = String(colorValue || '').trim();
    const rgbaMatch = raw.match(/^rgba\(([^,]+),([^,]+),([^,]+),([^)]+)\)$/i);
    if (rgbaMatch) {
      return `rgba(${rgbaMatch[1].trim()},${rgbaMatch[2].trim()},${rgbaMatch[3].trim()},0.50)`;
    }
    const rgbMatch = raw.match(/^rgb\(([^,]+),([^,]+),([^)]+)\)$/i);
    if (rgbMatch) {
      return `rgba(${rgbMatch[1].trim()},${rgbMatch[2].trim()},${rgbMatch[3].trim()},0.50)`;
    }
    return raw;
  },

  updateToolbarSelection() {
    Object.entries(this.toolButtons || {}).forEach(([toolName, button]) => {
      if (!button) return;
      const active = this.selectedTool === toolName;
      button.style.transform = active ? 'scale(1.08)' : 'scale(1)';
      button.style.boxShadow = active
        ? '0 0 0 2px rgba(255,255,255,0.9), 0 8px 16px rgba(0,0,0,0.35)'
        : '0 4px 10px rgba(0,0,0,0.28)';
      button.style.opacity = active ? '1' : '0.88';
    });

    Object.entries(this.colorButtons || {}).forEach(([colorValue, button]) => {
      if (!button) return;
      const active = this.selectedColor === colorValue;
      button.style.transform = active ? 'scale(1.08)' : 'scale(1)';
      button.style.boxShadow = active
        ? '0 0 0 2px rgba(255,255,255,0.95), 0 6px 12px rgba(0,0,0,0.32)'
        : '0 3px 8px rgba(0,0,0,0.28)';
    });

    if (this.widthSlider) {
      const preset = this.toolPresets[this.selectedTool] || {};
      this.widthSlider.max = String(Number(preset.maxWidth) || 150);
      this.widthSlider.value = String(this.tool.width);
    }
    if (this.widthValueLabel) {
      this.widthValueLabel.textContent = `${Math.round(this.tool.width)}px`;
    }
  },

  ensureUI() {
    if (this.overlayRoot) return;

    const root = document.createElement('div');
    root.id = 'markerboard-overlay-root';
    root.style.position = 'fixed';
    root.style.inset = '0';
    root.style.zIndex = '15000';
    root.style.pointerEvents = 'none';

    const canvas = document.createElement('canvas');
    canvas.id = 'markerboard-canvas';
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.touchAction = 'none';
    canvas.style.pointerEvents = 'auto';
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());

    const toolbar = document.createElement('div');
    toolbar.id = 'markerboard-toolbar';
    toolbar.style.position = 'absolute';
    toolbar.style.top = '50%';
    toolbar.style.left = '14px';
    toolbar.style.transform = 'translateY(-50%)';
    toolbar.style.display = 'flex';
    toolbar.style.flexDirection = 'column';
    toolbar.style.alignItems = 'center';
    toolbar.style.gap = '10px';
    toolbar.style.padding = '12px 10px';
    toolbar.style.borderRadius = '26px';
    toolbar.style.background = 'linear-gradient(180deg, rgba(20,25,34,0.92), rgba(11,14,20,0.8))';
    toolbar.style.backdropFilter = 'blur(4px)';
    toolbar.style.border = '1px solid rgba(255,255,255,0.15)';
    toolbar.style.color = '#fff';
    toolbar.style.font = '12px sans-serif';
    toolbar.style.pointerEvents = 'auto';
    toolbar.style.boxShadow = '0 12px 28px rgba(0,0,0,0.35)';
    toolbar.style.opacity = '0.8';

    const makeCircleButton = ({ emoji, title, size = 42, onClick }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.title = title;
      button.textContent = emoji;
      button.style.width = `${size}px`;
      button.style.height = `${size}px`;
      button.style.borderRadius = '999px';
      button.style.border = '1px solid rgba(255,255,255,0.18)';
      button.style.background = 'rgba(255,255,255,0.08)';
      button.style.display = 'flex';
      button.style.alignItems = 'center';
      button.style.justifyContent = 'center';
      button.style.cursor = 'pointer';
      button.style.color = '#fff';
      button.style.fontSize = size >= 40 ? '19px' : '15px';
      button.style.lineHeight = '1';
      button.style.padding = '0';
      button.style.boxShadow = '0 4px 10px rgba(0,0,0,0.28)';
      button.style.transition = 'transform 120ms ease, box-shadow 120ms ease, opacity 120ms ease';
      button.addEventListener('click', (event) => {
        event.preventDefault();
        onClick(event);
      });
      return button;
    };

    const divider = document.createElement('div');
    divider.style.width = '30px';
    divider.style.height = '1px';
    divider.style.background = 'rgba(255,255,255,0.22)';
    divider.style.margin = '2px 0';

    const toolGroup = document.createElement('div');
    toolGroup.style.display = 'flex';
    toolGroup.style.flexDirection = 'column';
    toolGroup.style.gap = '8px';

    const penBtn = makeCircleButton({
      emoji: '✏️',
      title: 'Pen',
      onClick: () => this.setTool('pen')
    });
    const highlighterBtn = makeCircleButton({
      emoji: '🖍️',
      title: 'Highlighter',
      onClick: () => this.setTool('highlighter')
    });
    const eraserBtn = makeCircleButton({
      emoji: '🧽',
      title: 'Eraser',
      onClick: () => this.setTool('eraser')
    });
    this.toolButtons = {
      pen: penBtn,
      highlighter: highlighterBtn,
      eraser: eraserBtn
    };
    toolGroup.appendChild(penBtn);
    toolGroup.appendChild(highlighterBtn);
    toolGroup.appendChild(eraserBtn);

    const colorGroup = document.createElement('div');
    colorGroup.style.display = 'grid';
    colorGroup.style.gridTemplateColumns = 'repeat(2, 1fr)';
    colorGroup.style.gap = '8px';
    colorGroup.style.width = '64px';
    this.colorButtons = {};
    this.colorPalette.forEach((colorValue) => {
      const colorBtn = makeCircleButton({
        emoji: '',
        title: `Color ${colorValue}`,
        size: 22,
        onClick: () => this.setColor(colorValue)
      });
      colorBtn.style.background = colorValue;
      colorBtn.style.border = '1px solid rgba(255,255,255,0.5)';
      colorBtn.style.fontSize = '0';
      this.colorButtons[colorValue] = colorBtn;
      colorGroup.appendChild(colorBtn);
    });

    const widthWrap = document.createElement('div');
    widthWrap.style.width = '64px';
    widthWrap.style.display = 'flex';
    widthWrap.style.flexDirection = 'column';
    widthWrap.style.alignItems = 'center';
    widthWrap.style.gap = '6px';

    const widthLabel = document.createElement('div');
    widthLabel.textContent = '📏 Width';
    widthLabel.style.fontSize = '11px';
    widthLabel.style.opacity = '0.92';

    const widthValue = document.createElement('div');
    widthValue.style.fontSize = '11px';
    widthValue.style.opacity = '0.9';
    widthValue.textContent = `${Math.round(this.tool.width)}`;

    const widthSlider = document.createElement('input');
    widthSlider.type = 'range';
    widthSlider.min = '1';
    widthSlider.max = String(this.toolPresets[this.selectedTool]?.maxWidth || 150);
    widthSlider.step = '1';
    widthSlider.value = String(this.tool.width);
    widthSlider.title = 'Stroke width';
    widthSlider.style.width = '64px';
    widthSlider.style.height = '22px';
    widthSlider.style.accentColor = '#7dd3fc';
    widthSlider.style.cursor = 'pointer';
    widthSlider.addEventListener('input', () => {
      this.setWidth(widthSlider.value);
    });

    widthWrap.appendChild(widthLabel);
    widthWrap.appendChild(widthSlider);
    widthWrap.appendChild(widthValue);
    this.widthSlider = widthSlider;
    this.widthValueLabel = widthValue;

    const actionGroup = document.createElement('div');
    actionGroup.style.display = 'flex';
    actionGroup.style.flexDirection = 'column';
    actionGroup.style.gap = '8px';

    const saveBtn = makeCircleButton({
      emoji: '💾',
      title: 'Save / Export',
      onClick: (event) => this.openSaveMenu(event.currentTarget)
    });
    const restoreBtn = makeCircleButton({
      emoji: '📂',
      title: 'Restore Markerboard Snapshot',
      onClick: () => this.openRestoreDialog()
    });
    const undoBtn = makeCircleButton({
      emoji: '↶',
      title: 'Undo Last Action',
      onClick: () => this.undoLastAction()
    });
    const clearBtn = makeCircleButton({
      emoji: '🗑️',
      title: 'Clear Options',
      onClick: (event) => this.openClearMenu(event.currentTarget)
    });
    const disableBtn = makeCircleButton({
      emoji: '✖️',
      title: 'Disable Markerboard',
      onClick: () => this.toggle(false)
    });
    actionGroup.appendChild(saveBtn);
    actionGroup.appendChild(restoreBtn);
    actionGroup.appendChild(undoBtn);
    actionGroup.appendChild(clearBtn);
    actionGroup.appendChild(disableBtn);

    toolbar.appendChild(toolGroup);
    toolbar.appendChild(divider.cloneNode());
    toolbar.appendChild(colorGroup);
    toolbar.appendChild(widthWrap);
    toolbar.appendChild(divider);
    toolbar.appendChild(actionGroup);

    root.appendChild(canvas);
    root.appendChild(toolbar);
    document.body.appendChild(root);

    canvas.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    canvas.addEventListener('pointermove', (event) => this.onPointerMove(event));
    canvas.addEventListener('pointerup', (event) => this.onPointerUp(event));
    canvas.addEventListener('pointercancel', (event) => this.onPointerUp(event));
    canvas.addEventListener('lostpointercapture', (event) => this.onPointerUp(event));

    this.overlayRoot = root;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.toolbar = toolbar;
    this.canvas.style.opacity = '1';
    this.setTool(this.selectedTool);
    this.setColor(this.selectedColor);
    this.updateToolbarSelection();
    this.updateCanvasCursor();
    this.updateToolbarVisibility();
    this.resizeCanvas();
  }
};
