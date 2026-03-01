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
    this.updateCanvasCursor();
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
    this.closeSaveMenu();
    this.closeClearMenu();
    this.overlayRoot.style.display = isVisible ? '' : 'none';
    this.overlayRoot.style.pointerEvents = isVisible ? 'auto' : 'none';
    this.updateCanvasCursor();
  }
};
