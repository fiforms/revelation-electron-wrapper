export const renderMethods = {
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

  updateUnderlayLayer(board) {
    if (!this.underlayEl) return;
    const enabled = !!board?.boardSettings?.underlayEnabled;
    this.underlayEl.style.display = enabled ? '' : 'none';
    if (enabled) {
      this.underlayEl.style.background = String(board.boardSettings.underlayColor || 'rgba(255,255,255,0.8)');
    }
  },

  drawTextItem(textItem) {
    if (!this.ctx || !textItem || !textItem.text) return;
    const rect = this.getSlideRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    const p = this.toClientPoint({ x: textItem.x, y: textItem.y }, rect);
    if (!p) return;
    const w = this.doc.coordinateSpace.width || 1;
    const h = this.doc.coordinateSpace.height || 1;
    const widthScale = (rect.width / w + rect.height / h) / 2;
    const fontSize = Math.max(10, (Number(textItem.size) || 24) * widthScale);
    this.ctx.save();
    this.ctx.fillStyle = String(textItem.color || 'rgba(255,59,48,0.95)');
    this.ctx.font = `${fontSize}px sans-serif`;
    this.ctx.textBaseline = 'top';
    const lines = String(textItem.text).split(/\r?\n/);
    lines.forEach((line, idx) => {
      this.ctx.fillText(line, p.x, p.y + idx * fontSize * 1.2);
    });
    this.ctx.restore();
  },

  getTextBoundsInSlide(textItem) {
    if (!textItem) return null;
    const x = Number(textItem.x) || 0;
    const y = Number(textItem.y) || 0;
    const size = Math.max(8, Number(textItem.size) || 24);
    const lines = String(textItem.text || '').split(/\r?\n/);
    const maxChars = lines.reduce((max, line) => Math.max(max, String(line || '').length), 0);
    const width = Math.max(size * 0.9, maxChars * size * 0.58);
    const height = Math.max(size * 1.2, lines.length * size * 1.2);
    return { x, y, width, height };
  },

  collectTouchedTextIds(slideKey, point, radius) {
    const board = this.ensureSlideBoard(slideKey);
    const ids = [];
    const activeIds = this.activeErasedTextIds instanceof Set ? this.activeErasedTextIds : new Set();
    const r = Math.max(4, Number(radius) || 4);

    for (const textId of board.textOrder || []) {
      if (!textId || activeIds.has(textId)) continue;
      const textItem = board.texts?.[textId];
      if (!textItem) continue;
      const bounds = this.getTextBoundsInSlide(textItem);
      if (!bounds) continue;

      const withinRect =
        point.x >= bounds.x - r &&
        point.x <= bounds.x + bounds.width + r &&
        point.y >= bounds.y - r &&
        point.y <= bounds.y + bounds.height + r;

      const dx = point.x - bounds.x;
      const dy = point.y - bounds.y;
      const anchorHit = Math.sqrt(dx * dx + dy * dy) <= r * 1.2;

      if (withinRect || anchorHit) {
        ids.push(textId);
      }
    }
    return ids;
  },

  eraseTouchedTextAtPoint(slideKey, point) {
    if (this.selectedTool !== 'eraser') return;
    const board = this.ensureSlideBoard(slideKey);
    const touchedIds = this.collectTouchedTextIds(slideKey, point, Number(this.tool.width) / 2);
    if (!touchedIds.length) return;

    const deletedSnapshots = touchedIds
      .map((textId) => {
        const item = board.texts?.[textId];
        if (!item) return null;
        return {
          textId,
          item: this.cloneBoard(item)
        };
      })
      .filter(Boolean);

    const op = this.pushOp('delete_text', slideKey, { textIds: touchedIds });
    if (!op) return;

    if (this.activeErasedTextIds instanceof Set) {
      touchedIds.forEach((id) => this.activeErasedTextIds.add(id));
    }
    if (deletedSnapshots.length) {
      this.recordUndoAction(slideKey, {
        type: 'delete_text',
        texts: deletedSnapshots
      });
    }
    this.renderCurrentSlide();
  },

  closeTextEditor(options = {}) {
    const commit = options.commit === true;
    const editor = this.activeTextEditor;
    if (!editor) return;
    this.activeTextEditor = null;
    const text = String(editor.value || '').trim();
    const slidePoint = editor._slidePoint || null;
    editor.remove();
    if (!commit || !text || !slidePoint) return;

    const slideKey = this.currentSlideKey();
    const textId = this.nextTextId();
    const op = this.pushOp('add_text', slideKey, {
      textId,
      text,
      x: slidePoint.x,
      y: slidePoint.y,
      color: this.tool.color,
      size: Number(this.tool.width) || 24
    });
    if (op) {
      this.recordUndoAction(slideKey, { type: 'text', textId });
      this.renderCurrentSlide();
    }
  },

  openTextEditorAtPoint(slidePoint) {
    if (!slidePoint) return;
    this.closeTextEditor({ commit: false });
    const clientPoint = this.toClientPoint(slidePoint);
    if (!clientPoint) return;

    const input = document.createElement('textarea');
    input.rows = 2;
    input.placeholder = 'Type text...';
    input.value = '';
    input._slidePoint = slidePoint;
    input.style.position = 'fixed';
    input.style.left = `${Math.round(clientPoint.x)}px`;
    input.style.top = `${Math.round(clientPoint.y)}px`;
    input.style.zIndex = '20200';
    input.style.minWidth = '170px';
    input.style.maxWidth = '320px';
    input.style.minHeight = '54px';
    input.style.padding = '8px';
    input.style.borderRadius = '8px';
    input.style.border = '1px solid rgba(255,255,255,0.4)';
    input.style.background = 'rgba(12,17,25,0.92)';
    input.style.color = '#fff';
    input.style.font = '14px sans-serif';
    input.style.boxShadow = '0 10px 25px rgba(0,0,0,0.35)';
    input.style.resize = 'both';
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.closeTextEditor({ commit: false });
      } else if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        this.closeTextEditor({ commit: true });
      }
    });
    input.addEventListener('blur', () => {
      this.closeTextEditor({ commit: true });
    });
    document.body.appendChild(input);
    this.activeTextEditor = input;
    window.setTimeout(() => input.focus(), 0);
  },

  renderCurrentSlide() {
    if (!this.ctx || !this.canvas) return;
    const slideKey = this.currentSlideKey();
    const board = this.doc.slides[slideKey];
    this.updateUnderlayLayer(board || null);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!board) return;
    for (const strokeId of board.order) {
      if (board.tombstones.includes(strokeId)) continue;
      this.drawStroke(board.strokes[strokeId]);
    }
    for (const textId of board.textOrder || []) {
      this.drawTextItem(board.texts?.[textId]);
    }
  },

  onPointerDown(event) {
    if (!this.state.enabled || this.activePointerId !== null) return;
    if (!this.canCurrentUserDraw()) return;
    const point = this.toSlidePoint(event);
    if (!point) return;
    if (this.selectedTool === 'text') {
      event.preventDefault();
      this.openTextEditorAtPoint(point);
      return;
    }

    event.preventDefault();
    this.canvas.setPointerCapture(event.pointerId);
    this.activePointerId = event.pointerId;

    const slideKey = this.currentSlideKey();
    this.activeErasedTextIds = this.selectedTool === 'eraser' ? new Set() : null;
    this.eraseTouchedTextAtPoint(slideKey, point);
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
    this.eraseTouchedTextAtPoint(slideKey, point);
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
    this.activeErasedTextIds = null;
    this.renderCurrentSlide();
  },

  setOverlayActive(isActive) {
    this.ensureUI();
    this.state.enabled = !!isActive;
    this.setOverlayVisibility(this.state.enabled);
    this.updateCanvasCursor();
    this.updateToolbarVisibility();
    if (!this.state.enabled) {
      this.activePointerId = null;
      this.activeStrokeId = null;
      this.activeErasedTextIds = null;
      this.hiddenByOverview = false;
      this.closeTextEditor({ commit: true });
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
    this.closeSaveMenu();
    this.closeClearMenu();
    this.closeToolsMenu();
    if (!isVisible) {
      this.closeTextEditor({ commit: true });
    }
    this.overlayRoot.style.display = isVisible ? '' : 'none';
    this.overlayRoot.style.pointerEvents = isVisible ? 'auto' : 'none';
    this.updateCanvasCursor();
    this.updateToolbarVisibility();
  }
};
