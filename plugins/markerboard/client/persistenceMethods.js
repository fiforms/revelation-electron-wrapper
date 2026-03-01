export const persistenceMethods = {
  // Storage namespace for snapshot history, scoped to the current presentation doc id.
  getSnapshotStorageKey() {
    return `markerboard:snapshots:${this.doc.docId}`;
  },

  // Reads and validates persisted snapshot list from localStorage.
  loadSnapshotsFromStorage() {
    try {
      const raw = window.localStorage?.getItem(this.getSnapshotStorageKey());
      const parsed = JSON.parse(raw || '[]');
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((entry) => entry && typeof entry === 'object' && entry.id && entry.doc);
    } catch {
      return [];
    }
  },

  // Writes snapshot list back to localStorage; isolated helper so save paths share behavior.
  saveSnapshotsToStorage(snapshots) {
    try {
      window.localStorage?.setItem(this.getSnapshotStorageKey(), JSON.stringify(snapshots));
      return true;
    } catch (err) {
      console.warn('[markerboard] Failed to write snapshots:', err?.message || err);
      return false;
    }
  },

  // Utility for UI metadata: counts total strokes in a document snapshot.
  countDocStrokes(doc) {
    const slides = doc?.slides && typeof doc.slides === 'object' ? Object.values(doc.slides) : [];
    let total = 0;
    for (const slide of slides) {
      total += Object.keys(slide?.strokes || {}).length;
    }
    return total;
  },

  // Minimal XML escaping for safe SVG output text/attribute values.
  escapeXml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  },

  // Converts rgb/rgba-like input into explicit SVG color + opacity fields.
  normalizeColorForSvg(colorValue) {
    const raw = String(colorValue || '').trim();
    const rgbaMatch = raw.match(/^rgba\(([^,]+),([^,]+),([^,]+),([^)]+)\)$/i);
    if (rgbaMatch) {
      const r = Number(rgbaMatch[1]);
      const g = Number(rgbaMatch[2]);
      const b = Number(rgbaMatch[3]);
      const a = Number(rgbaMatch[4]);
      return {
        rgb: `rgb(${Math.max(0, Math.min(255, r))},${Math.max(0, Math.min(255, g))},${Math.max(0, Math.min(255, b))})`,
        opacity: Number.isFinite(a) ? Math.max(0, Math.min(1, a)) : 1
      };
    }

    const rgbMatch = raw.match(/^rgb\(([^,]+),([^,]+),([^)]+)\)$/i);
    if (rgbMatch) {
      const r = Number(rgbMatch[1]);
      const g = Number(rgbMatch[2]);
      const b = Number(rgbMatch[3]);
      return {
        rgb: `rgb(${Math.max(0, Math.min(255, r))},${Math.max(0, Math.min(255, g))},${Math.max(0, Math.min(255, b))})`,
        opacity: 1
      };
    }

    return {
      rgb: raw || 'rgb(255,0,0)',
      opacity: 1
    };
  },

  // Converts one marker stroke into an SVG shape element.
  strokeToSvgElement(stroke) {
    const points = Array.isArray(stroke?.points) ? stroke.points : [];
    if (!points.length) return '';

    const normalized = this.normalizeColorForSvg(stroke.color || 'rgba(255,0,0,1)');
    const color = this.escapeXml(normalized.rgb);
    const opacity = Number(normalized.opacity);
    const width = Number(stroke.width) || 1;

    if (points.length === 1) {
      const p = points[0];
      return `<circle cx="${Number(p.x)}" cy="${Number(p.y)}" r="${Math.max(0.5, width / 2)}" fill="${color}" fill-opacity="${opacity}" />`;
    }

    const d = points
      .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${Number(p.x)} ${Number(p.y)}`)
      .join(' ');
    return `<path d="${d}" fill="none" stroke="${color}" stroke-opacity="${opacity}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" />`;
  },

  // Exports current slide marker strokes as an SVG download.
  // Eraser compositing is intentionally omitted because it does not map directly to simple exported paths.
  exportCurrentSlideAsSvg() {
    const slideKey = this.currentSlideKey();
    const board = this.doc.slides[slideKey];
    if (!board) {
      window.alert('No markerboard annotations found on this slide.');
      return false;
    }

    const width = Number(this.doc.coordinateSpace?.width) || 960;
    const height = Number(this.doc.coordinateSpace?.height) || 700;
    const activeStrokeIds = (board.order || []).filter((id) => !board.tombstones?.includes(id));

    const eraserCount = { value: 0 };
    const drawableStrokes = [];
    activeStrokeIds.forEach((strokeId) => {
      const stroke = board.strokes?.[strokeId];
      if (!stroke) return;
      if (stroke.compositeMode === 'destination-out' || stroke.tool === 'eraser') {
        eraserCount.value += 1;
        return;
      }
      drawableStrokes.push(stroke);
    });

    if (!drawableStrokes.length) {
      window.alert('No exportable marker strokes on this slide.');
      return false;
    }

    const paths = drawableStrokes
      .map((stroke) => this.strokeToSvgElement(stroke))
      .filter(Boolean)
      .join('\n    ');

    const metadataNote = eraserCount.value
      ? `<!-- Note: ${eraserCount.value} eraser stroke(s) were omitted in this SVG export. -->`
      : '';

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  ${metadataNote}
  <g id="markerboard-${this.escapeXml(slideKey)}">
    ${paths}
  </g>
</svg>
`;

    const fileName = `markerboard-${slideKey}-${new Date().toISOString().replace(/[:.]/g, '-')}.svg`;
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);

    if (eraserCount.value > 0) {
      window.alert(`SVG exported. Note: ${eraserCount.value} eraser stroke(s) were omitted.`);
    }
    return true;
  },

  // Captures the full markerboard document into local snapshot history for quick restore.
  saveCurrentSnapshot() {
    const snapshotDoc = this.cloneDoc(this.doc);
    if (!snapshotDoc) return false;
    const snapshots = this.loadSnapshotsFromStorage();
    const now = Date.now();
    const entry = {
      id: `mbs-${now}-${Math.random().toString(36).slice(2, 8)}`,
      savedAt: now,
      savedAtIso: new Date(now).toISOString(),
      strokeCount: this.countDocStrokes(snapshotDoc),
      slideCount: Object.keys(snapshotDoc.slides || {}).length,
      doc: snapshotDoc
    };
    snapshots.unshift(entry);
    const limited = snapshots.slice(0, 100);
    const ok = this.saveSnapshotsToStorage(limited);
    if (ok) {
      console.log(`[markerboard] Snapshot saved (${entry.slideCount} slides, ${entry.strokeCount} strokes)`);
    }
    return ok;
  },

  // Shared file-download helper for JSON/SVG export flows.
  downloadTextFile(fileName, content, mimeType) {
    const blob = new Blob([String(content || '')], { type: mimeType || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  },

  // Exports the full document model (all slide boards and op log) as JSON.
  exportAllSlidesAsJson() {
    const payload = {
      exportedAt: new Date().toISOString(),
      docId: this.doc.docId,
      coordinateSpace: this.doc.coordinateSpace,
      slides: this.doc.slides,
      opLog: this.doc.opLog
    };
    const fileName = `markerboard-all-slides-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    this.downloadTextFile(fileName, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
    return true;
  },

  // Removes the save action flyout and its outside-click listener.
  closeSaveMenu() {
    if (this.saveMenuOutsideHandler) {
      document.removeEventListener('mousedown', this.saveMenuOutsideHandler, true);
      this.saveMenuOutsideHandler = null;
    }
    if (this.saveMenuEl) {
      this.saveMenuEl.remove();
      this.saveMenuEl = null;
    }
  },

  // Opens save/export flyout near the toolbar button.
  openSaveMenu(anchorEl) {
    if (!anchorEl) return;
    this.closeClearMenu();
    this.closeSaveMenu();

    const rect = anchorEl.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.id = 'markerboard-save-menu';
    menu.style.position = 'fixed';
    menu.style.left = `${Math.round(rect.right + 10)}px`;
    menu.style.top = `${Math.round(rect.top)}px`;
    menu.style.zIndex = '20100';
    menu.style.minWidth = '220px';
    menu.style.padding = '8px';
    menu.style.borderRadius = '10px';
    menu.style.border = '1px solid rgba(255,255,255,0.2)';
    menu.style.background = 'linear-gradient(180deg, rgba(26,31,43,0.98), rgba(14,18,26,0.98))';
    menu.style.color = '#fff';
    menu.style.font = '13px sans-serif';
    menu.style.boxShadow = '0 14px 28px rgba(0,0,0,0.4)';
    menu.style.display = 'flex';
    menu.style.flexDirection = 'column';
    menu.style.gap = '6px';

    // Local helper to keep menu item construction consistent.
    const addItem = (label, onClick) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      btn.style.textAlign = 'left';
      btn.style.cursor = 'pointer';
      btn.style.padding = '8px 10px';
      btn.style.borderRadius = '8px';
      btn.style.border = '1px solid rgba(255,255,255,0.14)';
      btn.style.background = 'rgba(255,255,255,0.08)';
      btn.style.color = '#fff';
      btn.addEventListener('click', () => {
        this.closeSaveMenu();
        onClick();
      });
      menu.appendChild(btn);
    };

    addItem('Remember', () => this.saveCurrentSnapshot());
    addItem('Export JSON (All Slides)', () => this.exportAllSlidesAsJson());
    addItem('Export SVG (Current Slide)', () => this.exportCurrentSlideAsSvg());

    // Closes the flyout when user clicks anywhere outside it.
    const handleOutsideClick = (event) => {
      if (!menu.contains(event.target)) {
        this.closeSaveMenu();
      }
    };
    this.saveMenuOutsideHandler = handleOutsideClick;
    document.addEventListener('mousedown', handleOutsideClick, true);

    document.body.appendChild(menu);
    this.saveMenuEl = menu;
  },

  // Clears marker data for all slides in the current document and broadcasts replacement snapshot.
  clearAllSlideMarkerboards() {
    if (!this.canCurrentUserDraw()) return false;
    this.doc.slides = {};
    this.doc.opLog = [];
    this.seenOpIds = new Set();
    this.undoHistory = {};
    this.scheduleRepaint();
    this.emitPresenterPluginEvent('markerboard-snapshot', {
      doc: this.doc,
      enabled: !!this.state.enabled
    });
    console.log('[markerboard] Cleared all slide markerboards');
    return true;
  },

  // Removes the clear action flyout and its outside-click listener.
  closeClearMenu() {
    if (this.clearMenuOutsideHandler) {
      document.removeEventListener('mousedown', this.clearMenuOutsideHandler, true);
      this.clearMenuOutsideHandler = null;
    }
    if (this.clearMenuEl) {
      this.clearMenuEl.remove();
      this.clearMenuEl = null;
    }
  },

  // Opens clear-options flyout to target current slide or all slides.
  openClearMenu(anchorEl) {
    if (!anchorEl) return;
    this.closeSaveMenu();
    this.closeClearMenu();

    const rect = anchorEl.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.id = 'markerboard-clear-menu';
    menu.style.position = 'fixed';
    menu.style.left = `${Math.round(rect.right + 10)}px`;
    menu.style.top = `${Math.round(rect.top)}px`;
    menu.style.zIndex = '20100';
    menu.style.minWidth = '250px';
    menu.style.padding = '8px';
    menu.style.borderRadius = '10px';
    menu.style.border = '1px solid rgba(255,255,255,0.2)';
    menu.style.background = 'linear-gradient(180deg, rgba(43,26,26,0.98), rgba(26,14,14,0.98))';
    menu.style.color = '#fff';
    menu.style.font = '13px sans-serif';
    menu.style.boxShadow = '0 14px 28px rgba(0,0,0,0.4)';
    menu.style.display = 'flex';
    menu.style.flexDirection = 'column';
    menu.style.gap = '6px';

    // Local helper to keep menu item construction consistent.
    const addItem = (label, onClick) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      btn.style.textAlign = 'left';
      btn.style.cursor = 'pointer';
      btn.style.padding = '8px 10px';
      btn.style.borderRadius = '8px';
      btn.style.border = '1px solid rgba(255,255,255,0.14)';
      btn.style.background = 'rgba(255,255,255,0.08)';
      btn.style.color = '#fff';
      btn.addEventListener('click', () => {
        this.closeClearMenu();
        onClick();
      });
      menu.appendChild(btn);
    };

    addItem('Clear Current Slide Markerboard', () => this.clearCurrentSlide());
    addItem('Clear All Slide Markerboards', () => this.clearAllSlideMarkerboards());

    // Closes the flyout when user clicks anywhere outside it.
    const handleOutsideClick = (event) => {
      if (!menu.contains(event.target)) {
        this.closeClearMenu();
      }
    };
    this.clearMenuOutsideHandler = handleOutsideClick;
    document.addEventListener('mousedown', handleOutsideClick, true);

    document.body.appendChild(menu);
    this.clearMenuEl = menu;
  },

  // Restores one stored snapshot entry into active document state and repaints.
  restoreSnapshotById(snapshotId) {
    if (!this.canCurrentUserDraw()) return false;
    if (!snapshotId) return false;
    const snapshots = this.loadSnapshotsFromStorage();
    const entry = snapshots.find((item) => item.id === snapshotId);
    if (!entry || !entry.doc) return false;
    const cloned = this.cloneDoc(entry.doc);
    if (!cloned) return false;

    this.doc = cloned;
    this.seenOpIds = new Set();
    for (const op of this.doc.opLog || []) {
      if (op?.opId) this.seenOpIds.add(op.opId);
    }
    this.undoHistory = {};
    this.scheduleRepaint();
    this.emitPresenterPluginEvent('markerboard-snapshot', {
      doc: this.doc,
      enabled: !!this.state.enabled
    });
    console.log('[markerboard] Snapshot restored');
    return true;
  },

  // Accepts supported JSON payload shapes and replaces active document state when valid.
  importFromJsonPayload(payload) {
    if (!this.canCurrentUserDraw()) return false;
    if (!payload || typeof payload !== 'object') return false;

    let candidate = null;
    if (payload.slides && typeof payload.slides === 'object') {
      candidate = {
        docId: String(payload.docId || this.doc.docId || ''),
        version: Number(payload.version || 1),
        coordinateSpace: payload.coordinateSpace || this.doc.coordinateSpace,
        slides: payload.slides,
        opLog: Array.isArray(payload.opLog) ? payload.opLog : []
      };
    } else if (payload.doc && typeof payload.doc === 'object' && payload.doc.slides) {
      candidate = payload.doc;
    }

    const cloned = this.cloneDoc(candidate);
    if (!cloned || !cloned.slides || typeof cloned.slides !== 'object') {
      return false;
    }

    if (!cloned.docId) {
      cloned.docId = this.doc.docId;
    }
    if (!cloned.coordinateSpace) {
      cloned.coordinateSpace = this.doc.coordinateSpace;
    }
    if (!Array.isArray(cloned.opLog)) {
      cloned.opLog = [];
    }

    this.doc = cloned;
    this.seenOpIds = new Set();
    for (const op of this.doc.opLog || []) {
      if (op?.opId) this.seenOpIds.add(op.opId);
    }
    this.undoHistory = {};
    this.scheduleRepaint();
    this.emitPresenterPluginEvent('markerboard-snapshot', {
      doc: this.doc,
      enabled: !!this.state.enabled
    });
    console.log('[markerboard] JSON import applied');
    return true;
  },

  // Opens file picker for JSON import and applies imported marker payload.
  promptImportFromJson(onSuccess) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      input.remove();
      if (!file) return;

      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const ok = this.importFromJsonPayload(parsed);
        if (!ok) {
          window.alert('JSON import failed: invalid markerboard format.');
          return;
        }
        if (typeof onSuccess === 'function') onSuccess();
      } catch (err) {
        window.alert(`JSON import failed: ${err?.message || 'unknown error'}`);
      }
    });
    document.body.appendChild(input);
    input.click();
  },

  // Displays modal UI to import from JSON or restore from saved local snapshots.
  openRestoreDialog() {
    const existing = document.getElementById('markerboard-restore-overlay');
    if (existing) existing.remove();

    const snapshots = this.loadSnapshotsFromStorage();
    const overlay = document.createElement('div');
    overlay.id = 'markerboard-restore-overlay';
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.background = 'rgba(0,0,0,0.55)';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '20050';

    const panel = document.createElement('div');
    panel.style.width = 'min(700px, 92vw)';
    panel.style.maxHeight = '80vh';
    panel.style.overflow = 'auto';
    panel.style.background = 'linear-gradient(180deg, rgba(26,31,43,0.98), rgba(14,18,26,0.98))';
    panel.style.border = '1px solid rgba(255,255,255,0.2)';
    panel.style.borderRadius = '14px';
    panel.style.padding = '14px';
    panel.style.color = '#fff';
    panel.style.font = '13px sans-serif';
    panel.style.boxShadow = '0 20px 45px rgba(0,0,0,0.45)';

    const head = document.createElement('div');
    head.style.display = 'flex';
    head.style.alignItems = 'center';
    head.style.justifyContent = 'space-between';
    head.style.marginBottom = '10px';

    const title = document.createElement('div');
    title.textContent = 'Restore Markerboard Snapshot';
    title.style.fontSize = '16px';
    title.style.fontWeight = '700';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = 'Close';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.borderRadius = '8px';
    closeBtn.style.border = '1px solid rgba(255,255,255,0.25)';
    closeBtn.style.background = 'rgba(255,255,255,0.12)';
    closeBtn.style.color = '#fff';
    closeBtn.style.padding = '6px 10px';
    closeBtn.addEventListener('click', () => overlay.remove());

    head.appendChild(title);
    head.appendChild(closeBtn);
    panel.appendChild(head);

    const importRow = document.createElement('button');
    importRow.type = 'button';
    importRow.style.textAlign = 'left';
    importRow.style.cursor = 'pointer';
    importRow.style.padding = '10px 12px';
    importRow.style.borderRadius = '10px';
    importRow.style.border = '1px solid rgba(255,255,255,0.2)';
    importRow.style.background = 'rgba(125,211,252,0.15)';
    importRow.style.color = '#fff';
    importRow.style.marginBottom = '10px';
    importRow.innerHTML = `<div style="font-weight:700;">📥 Import from JSON</div><div style="opacity:.86; margin-top:2px;">Load annotations into this slideshow</div>`;
    importRow.addEventListener('click', () => {
      this.promptImportFromJson(() => overlay.remove());
    });
    panel.appendChild(importRow);

    if (!snapshots.length) {
      const empty = document.createElement('div');
      empty.textContent = 'No saved snapshots found for this presentation.';
      empty.style.opacity = '0.9';
      panel.appendChild(empty);
    } else {
      const list = document.createElement('div');
      list.style.display = 'flex';
      list.style.flexDirection = 'column';
      list.style.gap = '8px';

      // Build one clickable row per snapshot so users can inspect date + size and restore quickly.
      snapshots.forEach((entry) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.style.textAlign = 'left';
        row.style.cursor = 'pointer';
        row.style.padding = '10px 12px';
        row.style.borderRadius = '10px';
        row.style.border = '1px solid rgba(255,255,255,0.18)';
        row.style.background = 'rgba(255,255,255,0.08)';
        row.style.color = '#fff';

        const savedAt = new Date(entry.savedAt || entry.savedAtIso || Date.now());
        const dateText = Number.isNaN(savedAt.getTime()) ? String(entry.savedAtIso || '') : savedAt.toLocaleString();
        const slideCount = Number(entry.slideCount || 0);
        const strokeCount = Number(entry.strokeCount || 0);
        row.innerHTML = `
            <div style="font-weight:700;">${dateText}</div>
            <div style="opacity:.86; margin-top:2px;">${slideCount} slides, ${strokeCount} strokes</div>
          `;
        row.addEventListener('click', () => {
          const ok = this.restoreSnapshotById(entry.id);
          if (ok) overlay.remove();
        });
        list.appendChild(row);
      });

      panel.appendChild(list);
    }

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) overlay.remove();
    });
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
  }
};
