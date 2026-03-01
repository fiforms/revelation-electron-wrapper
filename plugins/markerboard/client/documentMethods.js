export const documentMethods = {
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

  cloneDoc(doc) {
    if (!doc) return null;
    try {
      return JSON.parse(JSON.stringify(doc));
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
    this.seenOpIds.add(op.opId);
    this.doc.opLog.push(op);
    this.applyOp(op);
    if (type === 'append_points') {
      this.queueAppendForEmit(op);
    } else {
      if (type === 'end_stroke' || type === 'clear_slide') {
        this.flushPendingAppendEmits();
      }
      this.emitPresenterPluginEvent('markerboard-op', { op });
    }
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
  }
};
