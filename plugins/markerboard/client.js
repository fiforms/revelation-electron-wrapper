(function () {
  function makeClientId() {
    try {
      const key = 'markerboard-client-id';
      const existing = window.localStorage.getItem(key);
      if (existing) return existing;
      const created = `mb-${Math.random().toString(36).slice(2, 10)}`;
      window.localStorage.setItem(key, created);
      return created;
    } catch {
      return `mb-${Math.random().toString(36).slice(2, 10)}`;
    }
  }

  window.RevelationPlugins.markerboard = {
    name: 'markerboard',
    priority: 95,
    context: null,
    deck: null,
    deckEventsBound: false,
    overlayRoot: null,
    canvas: null,
    ctx: null,
    toolbar: null,
    hiddenByOverview: false,
    repaintTimerIds: [],
    transitionFadeOutTimer: null,
    transitionFadeInTimer: null,
    activePointerId: null,
    activeStrokeId: null,
    strokeCounter: 0,
    opCounter: 0,
    clientId: makeClientId(),
    selectedTool: 'pen',
    selectedColor: 'rgba(255,59,48,0.95)',
    toolButtons: {},
    colorButtons: {},
    widthSlider: null,
    widthValueLabel: null,
    undoHistory: {},
    toolPresets: {
      pen: {
        width: 4,
        maxWidth: 50,
        compositeMode: 'source-over'
      },
      highlighter: {
        width: 40,
        maxWidth: 200,
        compositeMode: 'source-over'
      },
      eraser: {
        width: 60,
        maxWidth: 200,
        compositeMode: 'destination-out'
      }
    },
    colorPalette: [
      'rgba(255,59,48,0.95)',
      'rgba(255,149,0,0.95)',
      'rgba(255,214,10,0.95)',
      'rgba(52,199,89,0.95)',
      'rgba(0,122,255,0.95)',
      'rgba(175,82,222,0.95)',
      'rgba(255,255,255,0.95)',
      'rgba(255,245,157,0.35)'
    ],
    tool: {
      color: 'rgba(255,59,48,0.95)',
      width: 4,
      compositeMode: 'source-over',
      tool: 'pen'
    },
    state: {
      enabled: false
    },
    doc: {
      docId: 'presentation:unknown',
      version: 1,
      coordinateSpace: {
        unit: 'slide',
        width: 960,
        height: 700,
        allowOutOfBounds: true
      },
      slides: {},
      opLog: []
    },

    init(context) {
      this.context = context;
      this.doc.docId = this.getDocId();
      console.log('[markerboard] init', context);
      this.lazyBindDeck();
    },

    getDocId() {
      const href = window.location.href.replace(/#.*/, '');
      return `presentation:${href}`;
    },

    bindDeck(deck) {
      if (!deck || this.deckEventsBound) return;
      this.deck = deck;
      this.deckEventsBound = true;

      deck.on('slidechanged', () => {
        this.ensureCoordinateSpaceFromDeck();
        this.beginTransitionFadeOut();
        this.scheduleRepaint({ includeImmediate: false, baseDelay: 90 });
      });
      deck.on('ready', () => {
        this.ensureCoordinateSpaceFromDeck();
        this.resizeCanvas();
        this.scheduleRepaint();
        this.finishTransitionFadeIn();
      });
      deck.on('slidetransitionend', () => {
        this.ensureCoordinateSpaceFromDeck();
        this.scheduleRepaint();
        this.finishTransitionFadeIn();
      });
      deck.on('overviewshown', () => {
        if (this.state.enabled) {
          this.hiddenByOverview = true;
          this.setOverlayVisibility(false);
        }
      });
      deck.on('overviewhidden', () => {
        if (this.hiddenByOverview && this.state.enabled) {
          this.setOverlayVisibility(true);
        }
        this.hiddenByOverview = false;
      });

      window.addEventListener('resize', () => {
        this.resizeCanvas();
        this.scheduleRepaint();
      });
    },

    clearPendingRepaints() {
      for (const id of this.repaintTimerIds) {
        window.clearTimeout(id);
      }
      this.repaintTimerIds = [];
    },

    scheduleRepaint(options = {}) {
      const includeImmediate = options.includeImmediate !== false;
      const baseDelay = Number.isFinite(options.baseDelay) ? Number(options.baseDelay) : 0;
      this.clearPendingRepaints();
      if (includeImmediate) {
        this.renderCurrentSlide();
        window.requestAnimationFrame(() => this.renderCurrentSlide());
      }
      const delays = [40, 140, 280].map((delay) => delay + baseDelay);
      if (!includeImmediate && baseDelay > 0) {
        delays.unshift(baseDelay);
      }
      for (const delay of delays) {
        const id = window.setTimeout(() => {
          this.renderCurrentSlide();
        }, delay);
        this.repaintTimerIds.push(id);
      }
    },

    beginTransitionFadeOut() {
      if (!this.canvas || !this.state.enabled || this.hiddenByOverview) return;
      if (this.transitionFadeInTimer) {
        window.clearTimeout(this.transitionFadeInTimer);
        this.transitionFadeInTimer = null;
      }
      this.canvas.style.transition = 'opacity 80ms linear';
      this.canvas.style.opacity = '0';

      if (this.transitionFadeOutTimer) {
        window.clearTimeout(this.transitionFadeOutTimer);
      }
      this.transitionFadeOutTimer = window.setTimeout(() => {
        this.transitionFadeOutTimer = null;
      }, 100);
    },

    finishTransitionFadeIn() {
      if (!this.canvas || !this.state.enabled || this.hiddenByOverview) return;
      if (this.transitionFadeOutTimer) {
        window.clearTimeout(this.transitionFadeOutTimer);
        this.transitionFadeOutTimer = null;
      }
      if (this.transitionFadeInTimer) {
        window.clearTimeout(this.transitionFadeInTimer);
      }
      this.transitionFadeInTimer = window.setTimeout(() => {
        this.canvas.style.transition = 'opacity 120ms ease-out';
        this.canvas.style.opacity = '1';
        this.transitionFadeInTimer = null;
      }, 20);
    },

    lazyBindDeck() {
      let attempts = 0;
      const maxAttempts = 120;
      const timer = window.setInterval(() => {
        attempts += 1;
        if (window.deck) {
          this.bindDeck(window.deck);
          window.clearInterval(timer);
          return;
        }
        if (attempts >= maxAttempts) {
          window.clearInterval(timer);
        }
      }, 250);
    },

    ensureCoordinateSpaceFromDeck() {
      if (!this.deck || typeof this.deck.getConfig !== 'function') return;
      const config = this.deck.getConfig() || {};
      const width = Number(config.width);
      const height = Number(config.height);
      if (Number.isFinite(width) && width > 0) {
        this.doc.coordinateSpace.width = width;
      }
      if (Number.isFinite(height) && height > 0) {
        this.doc.coordinateSpace.height = height;
      }
    },

    currentSlideKey() {
      const indices = this.deck?.getIndices?.() || { h: 0, v: 0 };
      const h = Number.isFinite(indices.h) ? indices.h : 0;
      const v = Number.isFinite(indices.v) ? indices.v : 0;
      return `h${h}v${v}`;
    },

    ensureSlideBoard(slideKey) {
      if (!this.doc.slides[slideKey]) {
        this.doc.slides[slideKey] = {
          slideKey,
          boardSettings: {
            overlayOpacity: 0,
            backgroundMode: 'transparent'
          },
          strokes: {},
          order: [],
          tombstones: []
        };
      }
      return this.doc.slides[slideKey];
    },

    cloneBoard(board) {
      if (!board) return null;
      try {
        return JSON.parse(JSON.stringify(board));
      } catch {
        return null;
      }
    },

    recordUndoAction(slideKey, action) {
      if (!slideKey || !action) return;
      if (!this.undoHistory[slideKey]) {
        this.undoHistory[slideKey] = [];
      }
      this.undoHistory[slideKey].push(action);
      if (this.undoHistory[slideKey].length > 500) {
        this.undoHistory[slideKey].shift();
      }
    },

    undoLastAction() {
      const slideKey = this.currentSlideKey();
      const stack = this.undoHistory[slideKey];
      if (!Array.isArray(stack) || stack.length === 0) return;

      const action = stack.pop();
      const board = this.ensureSlideBoard(slideKey);
      if (!action || !action.type) return;

      if (action.type === 'stroke') {
        const strokeId = action.strokeId;
        if (strokeId && board.strokes[strokeId]) {
          delete board.strokes[strokeId];
          board.order = board.order.filter((id) => id !== strokeId);
          board.tombstones = board.tombstones.filter((id) => id !== strokeId);
        }
      } else if (action.type === 'clear' && action.previousBoard) {
        this.doc.slides[slideKey] = action.previousBoard;
      }

      this.scheduleRepaint();
    },

    clearCurrentSlide() {
      const slideKey = this.currentSlideKey();
      const board = this.ensureSlideBoard(slideKey);
      const hasContent = board.order.length > 0 || Object.keys(board.strokes).length > 0;
      if (!hasContent) return;
      const snapshot = this.cloneBoard(board);
      if (snapshot) {
        this.recordUndoAction(slideKey, {
          type: 'clear',
          previousBoard: snapshot
        });
      }
      this.pushOp('clear_slide', slideKey, {});
      this.renderCurrentSlide();
    },

    nextOpId() {
      this.opCounter += 1;
      return `${this.clientId}-${this.opCounter}`;
    },

    nextStrokeId() {
      this.strokeCounter += 1;
      return `${this.clientId}-${this.strokeCounter}-${Date.now()}`;
    },

    pushOp(type, slideKey, payload) {
      const op = {
        opId: this.nextOpId(),
        clientId: this.clientId,
        ts: Date.now(),
        type,
        slideKey,
        payload
      };
      this.doc.opLog.push(op);
      this.applyOp(op);
      return op;
    },

    applyOp(op) {
      const board = this.ensureSlideBoard(op.slideKey);
      const payload = op.payload || {};

      if (op.type === 'begin_stroke') {
        const point = payload.point;
        if (!point || !payload.strokeId) return;
        board.strokes[payload.strokeId] = {
          strokeId: payload.strokeId,
          tool: payload.tool || 'pen',
          color: payload.color || 'rgba(255,0,0,0.95)',
          width: Number(payload.width) || 4,
          compositeMode: payload.compositeMode || 'source-over',
          status: 'open',
          bbox: {
            minX: point.x,
            minY: point.y,
            maxX: point.x,
            maxY: point.y
          },
          points: [point]
        };
        board.order.push(payload.strokeId);
        return;
      }

      if (op.type === 'append_points') {
        const stroke = board.strokes[payload.strokeId];
        if (!stroke || !Array.isArray(payload.points)) return;
        for (const point of payload.points) {
          stroke.points.push(point);
          stroke.bbox.minX = Math.min(stroke.bbox.minX, point.x);
          stroke.bbox.minY = Math.min(stroke.bbox.minY, point.y);
          stroke.bbox.maxX = Math.max(stroke.bbox.maxX, point.x);
          stroke.bbox.maxY = Math.max(stroke.bbox.maxY, point.y);
        }
        return;
      }

      if (op.type === 'end_stroke') {
        const stroke = board.strokes[payload.strokeId];
        if (stroke) stroke.status = 'closed';
        return;
      }

      if (op.type === 'clear_slide') {
        board.tombstones = board.tombstones.concat(board.order);
        board.strokes = {};
        board.order = [];
      }
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
    },

    setColor(colorValue) {
      this.selectedColor = colorValue;
      if (this.selectedTool !== 'eraser') {
        this.tool.color = this.getEffectiveColorForTool(colorValue, this.selectedTool);
      }
      this.updateToolbarSelection();
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

      const badge = document.createElement('div');
      badge.textContent = 'MB';
      badge.title = 'Markerboard';
      badge.style.width = '32px';
      badge.style.height = '32px';
      badge.style.borderRadius = '999px';
      badge.style.display = 'flex';
      badge.style.alignItems = 'center';
      badge.style.justifyContent = 'center';
      badge.style.fontSize = '11px';
      badge.style.fontWeight = '700';
      badge.style.background = 'rgba(255,255,255,0.14)';
      badge.style.border = '1px solid rgba(255,255,255,0.2)';

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
          onClick();
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
          size: 28,
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

      const undoBtn = makeCircleButton({
        emoji: '↶',
        title: 'Undo Last Action',
        onClick: () => this.undoLastAction()
      });
      const clearBtn = makeCircleButton({
        emoji: '🗑️',
        title: 'Clear Current Slide',
        onClick: () => this.clearCurrentSlide()
      });
      const disableBtn = makeCircleButton({
        emoji: '✖️',
        title: 'Disable Markerboard',
        onClick: () => this.toggle(false)
      });
      actionGroup.appendChild(undoBtn);
      actionGroup.appendChild(clearBtn);
      actionGroup.appendChild(disableBtn);

      toolbar.appendChild(badge);
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
      this.resizeCanvas();
    },

    resizeCanvas() {
      if (!this.canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(1, window.innerWidth);
      const height = Math.max(1, window.innerHeight);
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;
      if (this.ctx) {
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    },

    getSlideRect() {
      const slide = this.deck?.getCurrentSlide?.();
      if (slide && typeof slide.getBoundingClientRect === 'function') {
        const rect = slide.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          return rect;
        }
      }

      const reveal = document.querySelector('.reveal .slides');
      return reveal?.getBoundingClientRect?.() || null;
    },

    toSlidePoint(event) {
      const rect = this.getSlideRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) return null;

      const w = this.doc.coordinateSpace.width;
      const h = this.doc.coordinateSpace.height;
      const x = ((event.clientX - rect.left) / rect.width) * w;
      const y = ((event.clientY - rect.top) / rect.height) * h;
      return { x, y, t: Date.now(), pressure: Number(event.pressure || 0) };
    },

    toClientPoint(point, rectOverride = null) {
      const rect = rectOverride || this.getSlideRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) return null;

      const w = this.doc.coordinateSpace.width;
      const h = this.doc.coordinateSpace.height;
      const x = rect.left + (point.x / w) * rect.width;
      const y = rect.top + (point.y / h) * rect.height;
      return { x, y };
    },

    drawStroke(stroke) {
      if (!this.ctx || !stroke || !Array.isArray(stroke.points) || stroke.points.length === 0) return;
      const rect = this.getSlideRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) return;
      const ctx = this.ctx;
      const w = this.doc.coordinateSpace.width || 1;
      const h = this.doc.coordinateSpace.height || 1;
      const scaleX = rect.width / w;
      const scaleY = rect.height / h;
      const widthScale = (scaleX + scaleY) / 2;
      const scaledWidth = Math.max(1, stroke.width * widthScale);
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = scaledWidth;
      ctx.globalCompositeOperation = stroke.compositeMode || 'source-over';
      ctx.beginPath();
      stroke.points.forEach((point, idx) => {
        const p = this.toClientPoint(point, rect);
        if (!p) return;
        if (idx === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
      ctx.restore();
    },

    renderCurrentSlide() {
      if (!this.ctx || !this.canvas) return;
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      const slideKey = this.currentSlideKey();
      const board = this.doc.slides[slideKey];
      if (!board) return;
      for (const strokeId of board.order) {
        if (board.tombstones.includes(strokeId)) continue;
        this.drawStroke(board.strokes[strokeId]);
      }
    },

    onPointerDown(event) {
      if (!this.state.enabled || this.activePointerId !== null) return;
      const point = this.toSlidePoint(event);
      if (!point) return;

      event.preventDefault();
      this.canvas.setPointerCapture(event.pointerId);
      this.activePointerId = event.pointerId;

      const slideKey = this.currentSlideKey();
      const strokeId = this.nextStrokeId();
      this.activeStrokeId = strokeId;
      this.pushOp('begin_stroke', slideKey, {
        strokeId,
        tool: this.tool.tool,
        color: this.tool.color,
        width: this.tool.width,
        compositeMode: this.tool.compositeMode,
        point
      });
      this.renderCurrentSlide();
    },

    onPointerMove(event) {
      if (!this.state.enabled) return;
      if (this.activePointerId === null || event.pointerId !== this.activePointerId) return;
      if (!this.activeStrokeId) return;

      const point = this.toSlidePoint(event);
      if (!point) return;

      event.preventDefault();
      const slideKey = this.currentSlideKey();
      this.pushOp('append_points', slideKey, {
        strokeId: this.activeStrokeId,
        points: [point]
      });
      this.renderCurrentSlide();
    },

    onPointerUp(event) {
      if (this.activePointerId === null || event.pointerId !== this.activePointerId) return;
      const slideKey = this.currentSlideKey();
      if (this.activeStrokeId) {
        this.pushOp('end_stroke', slideKey, {
          strokeId: this.activeStrokeId
        });
        this.recordUndoAction(slideKey, {
          type: 'stroke',
          strokeId: this.activeStrokeId
        });
      }
      this.activePointerId = null;
      this.activeStrokeId = null;
      this.renderCurrentSlide();
    },

    setOverlayActive(isActive) {
      this.ensureUI();
      this.state.enabled = !!isActive;
      this.setOverlayVisibility(this.state.enabled);
      if (!this.state.enabled) {
        this.activePointerId = null;
        this.activeStrokeId = null;
        this.hiddenByOverview = false;
      }
      this.ensureCoordinateSpaceFromDeck();
      this.resizeCanvas();
      this.scheduleRepaint();
      if (this.state.enabled) {
        this.finishTransitionFadeIn();
      }
    },

    setOverlayVisibility(isVisible) {
      if (!this.overlayRoot) return;
      this.overlayRoot.style.display = isVisible ? '' : 'none';
      this.overlayRoot.style.pointerEvents = isVisible ? 'auto' : 'none';
    },

    toggle(forceState) {
      const nextState = typeof forceState === 'boolean' ? forceState : !this.state.enabled;
      this.setOverlayActive(nextState);
      console.log(`[markerboard] ${this.state.enabled ? 'enabled' : 'disabled'}`);
    },

    getPresentationMenuItems(revealDeck) {
      this.bindDeck(revealDeck);
      return [
        {
          label: this.state.enabled ? 'Markerboard: Disable' : 'Markerboard: Enable',
          action: () => this.toggle()
        }
      ];
    }
  };
})();
