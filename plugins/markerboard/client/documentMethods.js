export const documentMethods = {
  // Syncs coordinate-space dimensions from Reveal config so stored points remain slide-relative.
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

  // Produces the current slide key used as the per-slide board partition id.
  currentSlideKey() {
    const indices = this.deck?.getIndices?.() || { h: 0, v: 0 };
    const h = Number.isFinite(indices.h) ? indices.h : 0;
    const v = Number.isFinite(indices.v) ? indices.v : 0;
    return `h${h}v${v}`;
  },

  // Ensures the slide board structure exists before any drawing/read operations.
  ensureSlideBoard(slideKey) {
    if (!this.doc.slides[slideKey]) {
      this.doc.slides[slideKey] = {
        slideKey,
        boardSettings: {
          overlayOpacity: 0,
          backgroundMode: 'transparent',
          underlayEnabled: false,
          underlayColor: 'rgba(255,255,255,0.8)'
        },
        strokes: {},
        order: [],
        tombstones: [],
        texts: {},
        textOrder: []
      };
    }
    const board = this.doc.slides[slideKey];
    if (!board.boardSettings || typeof board.boardSettings !== 'object') {
      board.boardSettings = {};
    }
    if (typeof board.boardSettings.underlayEnabled !== 'boolean') {
      board.boardSettings.underlayEnabled = false;
    }
    if (!board.boardSettings.underlayColor) {
      board.boardSettings.underlayColor = 'rgba(255,255,255,0.8)';
    }
    if (!board.texts || typeof board.texts !== 'object') {
      board.texts = {};
    }
    if (!Array.isArray(board.textOrder)) {
      board.textOrder = [];
    }
    return board;
  },

  // Deep-clone helper used for undo snapshots of a single slide board.
  cloneBoard(board) {
    if (!board) return null;
    try {
      return JSON.parse(JSON.stringify(board));
    } catch {
      return null;
    }
  },

  // Deep-clone helper used for whole-document snapshot/import/restore operations.
  cloneDoc(doc) {
    if (!doc) return null;
    try {
      return JSON.parse(JSON.stringify(doc));
    } catch {
      return null;
    }
  },

  // Pushes a reversible action onto the per-slide undo stack with bounded history.
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

  // Reverts the latest local action for the current slide and repaints.
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
    } else if (action.type === 'text') {
      const textId = action.textId;
      if (textId && board.texts[textId]) {
        delete board.texts[textId];
        board.textOrder = board.textOrder.filter((id) => id !== textId);
      }
    } else if (action.type === 'underlay' && action.previousSettings) {
      board.boardSettings = {
        ...board.boardSettings,
        ...action.previousSettings
      };
    } else if (action.type === 'delete_text' && Array.isArray(action.texts)) {
      action.texts.forEach((entry) => {
        if (!entry || !entry.textId || !entry.item) return;
        board.texts[entry.textId] = entry.item;
        if (!board.textOrder.includes(entry.textId)) {
          board.textOrder.push(entry.textId);
        }
      });
    } else if (action.type === 'clear' && action.previousBoard) {
      this.doc.slides[slideKey] = action.previousBoard;
    }

    this.scheduleRepaint();
  },

  // Clears current slide annotations while recording enough state for undo recovery.
  clearCurrentSlide() {
    if (!this.canCurrentUserDraw()) return;
    const slideKey = this.currentSlideKey();
    const board = this.ensureSlideBoard(slideKey);
    const hasContent =
      board.order.length > 0 ||
      Object.keys(board.strokes).length > 0 ||
      board.textOrder.length > 0 ||
      Object.keys(board.texts).length > 0 ||
      !!board.boardSettings?.underlayEnabled;
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

  // Generates monotonic op ids for local operations.
  nextOpId() {
    this.opCounter += 1;
    return `${this.clientId}-${this.opCounter}`;
  },

  // Generates unique stroke ids used to group begin/append/end point operations.
  nextStrokeId() {
    this.strokeCounter += 1;
    return `${this.clientId}-${this.strokeCounter}-${Date.now()}`;
  },

  // Generates unique ids for text annotations.
  nextTextId() {
    this.strokeCounter += 1;
    return `txt-${this.clientId}-${this.strokeCounter}-${Date.now()}`;
  },

  // Appends an op to local log/state and forwards it over the socket channel when needed.
  pushOp(type, slideKey, payload) {
    if (!this.canCurrentUserDraw()) return null;
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

  // Applies a single op into the in-memory slide board model.
  // This is the core reducer shared by local and remote operation flows.
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
      board.texts = {};
      board.textOrder = [];
      board.boardSettings = {
        ...board.boardSettings,
        underlayEnabled: false,
        underlayColor: board.boardSettings?.underlayColor || 'rgba(255,255,255,0.8)'
      };
      return;
    }

    if (op.type === 'add_text') {
      const textId = String(payload.textId || '').trim();
      if (!textId || !payload.text) return;
      board.texts[textId] = {
        textId,
        text: String(payload.text),
        color: String(payload.color || 'rgba(255,59,48,0.95)'),
        size: Math.max(8, Number(payload.size) || 24),
        x: Number(payload.x) || 0,
        y: Number(payload.y) || 0
      };
      if (!board.textOrder.includes(textId)) {
        board.textOrder.push(textId);
      }
      return;
    }

    if (op.type === 'set_underlay') {
      board.boardSettings = {
        ...board.boardSettings,
        underlayEnabled: !!payload.enabled,
        underlayColor: String(payload.color || board.boardSettings?.underlayColor || 'rgba(255,255,255,0.8)')
      };
      return;
    }

    if (op.type === 'delete_text') {
      const ids = Array.isArray(payload.textIds) ? payload.textIds : [];
      ids.forEach((textId) => {
        if (!textId) return;
        delete board.texts[textId];
        board.textOrder = board.textOrder.filter((id) => id !== textId);
      });
    }
  }
};
