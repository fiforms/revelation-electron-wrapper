function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function normalizeSlide(slide) {
  return {
    top: String(slide?.top || ''),
    body: String(slide?.body || ''),
    notes: String(slide?.notes || '')
  };
}

function normalizeStacks(stacks) {
  if (!Array.isArray(stacks)) return [[{ top: '', body: '', notes: '' }]];
  const normalized = stacks
    .map((column) => (Array.isArray(column) ? column.map(normalizeSlide) : []))
    .filter((column) => column.length > 0);
  return normalized.length ? normalized : [[{ top: '', body: '', notes: '' }]];
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

const NEW_SLIDE_PLACEHOLDER = '<!-- slide -->';

function createNewSlide() {
  return {
    top: '',
    body: NEW_SLIDE_PLACEHOLDER,
    notes: ''
  };
}

function moveSlideInStacks(stacks, from, to) {
  const working = normalizeStacks(clone(stacks));
  const fromH = Number(from?.h);
  const fromV = Number(from?.v);
  let toH = Number(to?.h);
  let toV = Number(to?.v);
  const place = to?.place === 'after' ? 'after' : 'before';

  if (![fromH, fromV, toH, toV].every(Number.isInteger)) return null;
  if (!working[fromH] || !working[toH]) return null;
  if (fromV < 0 || fromV >= working[fromH].length) return null;
  if (toV < 0) toV = 0;

  const sourceColumn = working[fromH];
  const [slide] = sourceColumn.splice(fromV, 1);
  if (!slide) return null;

  if (sourceColumn.length === 0) {
    if (working.length > 1) {
      working.splice(fromH, 1);
      if (fromH < toH) {
        toH -= 1;
      }
    } else {
      sourceColumn.push({ top: '', body: '', notes: '' });
    }
  }

  const targetColumn = working[toH];
  if (!targetColumn) return null;
  const insertOffset = place === 'after' ? 1 : 0;
  const rawIndex = toV + insertOffset;
  let insertIndex = clamp(rawIndex, 0, targetColumn.length);

  if (fromH === toH && fromV < toV) {
    insertIndex = Math.max(0, insertIndex - 1);
  }

  targetColumn.splice(insertIndex, 0, slide);
  return normalizeStacks(working);
}

function insertSlideAfterInStacks(stacks, h, v, slide = createNewSlide()) {
  const working = normalizeStacks(clone(stacks));
  if (!working[h]) return null;
  const insertAt = clamp(Number(v) + 1, 0, working[h].length);
  working[h].splice(insertAt, 0, normalizeSlide(slide));
  return normalizeStacks(working);
}

function duplicateSlideInStacks(stacks, h, v) {
  const working = normalizeStacks(clone(stacks));
  if (!working[h] || !working[h][v]) return null;
  const source = normalizeSlide(working[h][v]);
  const insertAt = clamp(Number(v) + 1, 0, working[h].length);
  working[h].splice(insertAt, 0, source);
  return normalizeStacks(working);
}

function deleteSlideInStacks(stacks, h, v) {
  const working = normalizeStacks(clone(stacks));
  if (!working[h] || !working[h][v]) return null;
  working[h].splice(v, 1);
  if (working[h].length === 0) {
    if (working.length === 1) {
      working[h].push(createNewSlide());
    } else {
      working.splice(h, 1);
    }
  }
  return normalizeStacks(working);
}

function insertColumnAfterInStacks(stacks, h) {
  const working = normalizeStacks(clone(stacks));
  const insertAt = clamp(Number(h) + 1, 0, working.length);
  working.splice(insertAt, 0, [createNewSlide()]);
  return normalizeStacks(working);
}

function deleteColumnInStacks(stacks, h) {
  const working = normalizeStacks(clone(stacks));
  if (!working[h]) return null;
  if (working.length === 1) {
    working[0] = [createNewSlide()];
    return normalizeStacks(working);
  }
  working.splice(h, 1);
  return normalizeStacks(working);
}

function plainText(text) {
  return String(text || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/!\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/\{\{[^}]+\}\}/g, '')
    .trim();
}

function extractImages(markdown) {
  const matches = String(markdown || '').match(/!\[[^\]]*\]\(([^)]+)\)/g) || [];
  return matches
    .map((entry) => {
      const found = entry.match(/!\[[^\]]*\]\(([^)]+)\)/);
      return found ? found[1] : '';
    })
    .filter(Boolean)
    .slice(0, 4);
}

function parseTwoColumnSegments(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  const segments = [];
  let current = [];
  let sawMarker = false;
  for (const line of lines) {
    if (line.trim() === '||') {
      sawMarker = true;
      segments.push(current.join('\n').trim());
      current = [];
      continue;
    }
    current.push(line);
  }
  if (current.length) segments.push(current.join('\n').trim());
  if (!sawMarker || segments.length < 2) return null;
  return segments.slice(0, 2);
}

function parseSlidePreview(slide) {
  const body = String(slide?.body || '');
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  let heading = '';
  const textLines = [];

  lines.forEach((line) => {
    if (!heading && line.startsWith('#')) {
      heading = plainText(line.replace(/^#+\s*/, ''));
      return;
    }
    if (line.startsWith('![')) return;
    if (line === '||') return;
    const cleaned = plainText(line);
    if (cleaned) textLines.push(cleaned);
  });

  if (!heading) {
    heading = textLines.shift() || '(blank slide)';
  }

  const columns = parseTwoColumnSegments(body);
  const images = extractImages(body);
  return {
    heading,
    bodyLines: textLines.slice(0, 4),
    images,
    twoCol: columns
  };
}

function createNavigatorTileRenderer() {
  return ({ slide, v, hasTopMatter }) => {
    const preview = parseSlidePreview(slide);
    const shell = document.createElement('div');
    shell.style.cssText = [
      'position:relative',
      'display:flex',
      'flex-direction:column',
      'gap:6px',
      'min-height:110px',
      'padding:10px'
    ].join(';');

    if (hasTopMatter) {
      const topBar = document.createElement('div');
      topBar.style.cssText = [
        'position:absolute',
        'left:0',
        'top:0',
        'width:100%',
        'height:4px',
        'background:#ef4444'
      ].join(';');
      shell.appendChild(topBar);
    }

    const id = document.createElement('div');
    id.textContent = `V${Number(v) + 1}`;
    id.style.cssText = 'font:10px/1.2 sans-serif; color:#a7b4cf; text-transform:uppercase; letter-spacing:.04em;';
    shell.appendChild(id);

    const title = document.createElement('div');
    title.textContent = preview.heading;
    title.style.cssText = 'font:700 14px/1.25 sans-serif; color:#eef3ff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;';
    shell.appendChild(title);

    if (preview.twoCol) {
      const twoCol = document.createElement('div');
      twoCol.style.cssText = 'display:grid; grid-template-columns:1fr 1fr; gap:6px;';
      preview.twoCol.forEach((segment, index) => {
        const block = document.createElement('div');
        block.textContent = plainText(segment) || `(column ${index + 1})`;
        block.style.cssText = [
          'min-height:38px',
          'padding:4px 5px',
          'border-radius:6px',
          'font:10px/1.2 sans-serif',
          'background:rgba(255,255,255,0.08)',
          'overflow:hidden'
        ].join(';');
        twoCol.appendChild(block);
      });
      shell.appendChild(twoCol);
    } else {
      const body = document.createElement('div');
      body.style.cssText = 'font:11px/1.3 sans-serif; color:#bcc8de; min-height:34px;';
      if (!preview.bodyLines.length) {
        body.textContent = '(blank slide)';
        body.style.fontStyle = 'italic';
        body.style.color = '#7f8aa3';
      } else {
        preview.bodyLines.slice(0, 3).forEach((line) => {
          const textLine = document.createElement('div');
          textLine.textContent = line;
          body.appendChild(textLine);
        });
      }
      shell.appendChild(body);
    }

    return shell;
  };
}

function deactivateCurrentBuilderMode() {
  const activeButton = document.querySelector('.builder-extension-mode-button.is-active');
  if (activeButton instanceof HTMLElement) {
    activeButton.click();
  }
}

class SlideSorterView {
  constructor(host) {
    this.host = host;
    this.root = null;
    this.viewport = null;
    this.board = null;
    this.dragSource = null;
    this.stacks = [];
    this.contextMenuEl = null;
    this.contextMenuBackdropHandler = (event) => {
      if (!this.contextMenuEl) return;
      if (this.contextMenuEl.contains(event.target)) return;
      this.closeContextMenu();
    };
    this.contextMenuKeyHandler = (event) => {
      if (event.key === 'Escape') {
        this.closeContextMenu();
      }
    };
    this.keyHandler = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        deactivateCurrentBuilderMode();
      }
    };
  }

  mount() {
    if (this.root) return;
    const root = document.createElement('div');
    root.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:20000',
      'display:flex',
      'flex-direction:column',
      'background:#0d111a',
      'color:#f2f4f8'
    ].join(';');

    const header = document.createElement('div');
    header.style.cssText = [
      'display:flex',
      'align-items:center',
      'justify-content:space-between',
      'padding:10px 14px',
      'border-bottom:1px solid rgba(255,255,255,0.12)',
      'background:#121a29'
    ].join(';');
    const title = document.createElement('div');
    title.textContent = 'Slide Sorter';
    title.style.cssText = 'font:600 15px/1.2 sans-serif;';
    header.appendChild(title);

    const help = document.createElement('div');
    help.textContent = 'Drag tiles to reorder. Double-click a tile to open it.';
    help.style.cssText = 'font:12px/1.2 sans-serif;opacity:.8;';
    header.appendChild(help);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = 'Done';
    closeBtn.className = 'panel-button';
    closeBtn.addEventListener('click', () => deactivateCurrentBuilderMode());
    header.appendChild(closeBtn);

    const viewport = document.createElement('div');
    viewport.style.cssText = [
      'flex:1',
      'overflow:auto',
      'padding:16px',
      'background:linear-gradient(180deg,#0b1320 0%, #0e1624 100%)'
    ].join(';');

    const board = document.createElement('div');
    board.style.cssText = 'min-height:100%;';
    viewport.appendChild(board);

    root.appendChild(header);
    root.appendChild(viewport);
    document.body.appendChild(root);
    document.addEventListener('keydown', this.keyHandler);
    document.addEventListener('mousedown', this.contextMenuBackdropHandler);
    document.addEventListener('keydown', this.contextMenuKeyHandler);

    this.root = root;
    this.viewport = viewport;
    this.board = board;
    this.refresh();
  }

  dispose() {
    document.removeEventListener('keydown', this.keyHandler);
    document.removeEventListener('mousedown', this.contextMenuBackdropHandler);
    document.removeEventListener('keydown', this.contextMenuKeyHandler);
    this.closeContextMenu();
    if (this.root) this.root.remove();
    this.root = null;
    this.viewport = null;
    this.board = null;
    this.dragSource = null;
  }

  refresh() {
    if (!this.board) return;
    const doc = this.host.getDocument();
    this.stacks = normalizeStacks(doc?.stacks || []);
    this.closeContextMenu();
    this.renderBoard();
  }

  commit(newStacks, reason = 'Slide sorter move') {
    const payload = normalizeStacks(newStacks);
    this.host.transact(reason, (tx) => {
      tx.replaceStacks(payload);
    });
    this.refresh();
  }

  moveByDropTarget(target) {
    if (!this.dragSource || !target) return;
    const from = this.dragSource;
    const to = {
      h: Number(target.dataset.h),
      v: Number(target.dataset.v),
      place: target.dataset.place || 'before'
    };
    const moved = moveSlideInStacks(this.stacks, from, to);
    if (!moved) return;
    this.commit(moved);
  }

  renderBoard() {
    const selection = this.host.getSelection();
    this.board.innerHTML = '';
    const oneColumn = this.stacks.length <= 1;

    if (oneColumn) {
      this.board.appendChild(this.renderColumnStrip({ oneColumn: true }));
      const grid = document.createElement('div');
      grid.style.cssText = [
        'display:grid',
        'grid-template-columns:repeat(auto-fill,minmax(200px,1fr))',
        'gap:12px',
        'align-items:start'
      ].join(';');
      const slides = this.stacks[0] || [];
      slides.forEach((slide, v) => {
        const tile = this.createTile(slide, 0, v, selection);
        grid.appendChild(tile);
      });
      const endZone = this.createDropZone(0, slides.length - 1, 'after');
      endZone.style.minHeight = '46px';
      endZone.textContent = 'Drop here to place at end';
      grid.appendChild(endZone);
      this.board.appendChild(grid);
      return;
    }

    const canvas = document.createElement('div');
    canvas.style.cssText = [
      'display:flex',
      'flex-direction:column',
      'gap:10px',
      'width:max-content',
      'min-width:100%'
    ].join(';');
    canvas.appendChild(this.renderColumnStrip({ oneColumn: false }));

    const matrix = document.createElement('div');
    matrix.style.cssText = [
      'display:grid',
      'grid-auto-flow:column',
      'grid-auto-columns:240px',
      'gap:16px',
      'align-items:start',
      'width:max-content',
      'min-height:100%'
    ].join(';');

    this.stacks.forEach((column, h) => {
      const columnEl = document.createElement('div');
      columnEl.style.cssText = [
        'display:flex',
        'flex-direction:column',
        'gap:10px',
        'padding:10px',
        'background:rgba(255,255,255,0.04)',
        'border:1px solid rgba(255,255,255,0.1)',
        'border-radius:10px',
        'min-height:90px'
      ].join(';');
      const heading = document.createElement('div');
      heading.textContent = `Column ${h + 1}`;
      heading.style.cssText = 'font:600 12px/1.2 sans-serif; opacity:.8;';
      columnEl.appendChild(heading);

      column.forEach((slide, v) => {
        const tile = this.createTile(slide, h, v, selection);
        columnEl.appendChild(tile);
      });

      const endZone = this.createDropZone(h, column.length - 1, 'after');
      endZone.textContent = 'Drop to append';
      endZone.style.minHeight = '30px';
      columnEl.appendChild(endZone);
      matrix.appendChild(columnEl);
    });

    canvas.appendChild(matrix);
    this.board.appendChild(canvas);
  }

  renderColumnStrip({ oneColumn = false } = {}) {
    const strip = document.createElement('div');
    if (oneColumn) {
      strip.style.cssText = [
        'display:flex',
        'align-items:center',
        'gap:8px',
        'padding:6px 4px 12px'
      ].join(';');
    } else {
      strip.style.cssText = [
        'display:grid',
        'grid-auto-flow:column',
        'grid-auto-columns:240px',
        'gap:16px',
        'align-items:stretch',
        'width:max-content',
        'padding:6px 0'
      ].join(';');
    }
    this.stacks.forEach((column, h) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.textContent = `Column ${h + 1} (${column.length})`;
      chip.className = 'panel-button';
      chip.style.cssText = oneColumn
        ? 'white-space:nowrap;'
        : 'white-space:nowrap; width:100%; text-align:left; justify-content:flex-start;';
      chip.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        this.openContextMenu(event.clientX, event.clientY, [
          {
            label: 'Insert Column After',
            action: () => {
              const moved = insertColumnAfterInStacks(this.stacks, h);
              if (moved) this.commit(moved, 'Slide sorter insert column');
            }
          },
          {
            label: 'Delete Column',
            action: () => {
              const moved = deleteColumnInStacks(this.stacks, h);
              if (moved) this.commit(moved, 'Slide sorter delete column');
            }
          }
        ]);
      });
      strip.appendChild(chip);
    });
    return strip;
  }

  closeContextMenu() {
    if (this.contextMenuEl) {
      this.contextMenuEl.remove();
      this.contextMenuEl = null;
    }
  }

  openContextMenu(x, y, items) {
    this.closeContextMenu();
    if (!Array.isArray(items) || !items.length) return;
    const menu = document.createElement('div');
    menu.style.cssText = [
      'position:fixed',
      'left:0',
      'top:0',
      'z-index:22000',
      'min-width:190px',
      'max-width:260px',
      'padding:6px',
      'border-radius:10px',
      'border:1px solid rgba(255,255,255,0.14)',
      'background:rgba(19,27,40,0.98)',
      'box-shadow:0 12px 30px rgba(0,0,0,0.5)',
      'display:flex',
      'flex-direction:column',
      'gap:4px'
    ].join(';');
    items.forEach((item) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = String(item.label || '');
      btn.className = 'panel-button';
      btn.style.cssText = [
        'text-align:left',
        'font:12px/1.2 sans-serif',
        'padding:8px 10px',
        'background:rgba(255,255,255,0.03)',
        'border-color:rgba(255,255,255,0.12)'
      ].join(';');
      btn.disabled = !!item.disabled;
      btn.addEventListener('click', () => {
        this.closeContextMenu();
        if (!item.disabled && typeof item.action === 'function') {
          item.action();
        }
      });
      menu.appendChild(btn);
    });
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    const left = Math.min(Math.max(8, x), window.innerWidth - rect.width - 8);
    const top = Math.min(Math.max(8, y), window.innerHeight - rect.height - 8);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    this.contextMenuEl = menu;
  }

  createDropZone(h, v, place = 'before') {
    const zone = document.createElement('div');
    zone.dataset.h = String(h);
    zone.dataset.v = String(Math.max(v, 0));
    zone.dataset.place = place;
    zone.style.cssText = [
      'border:1px dashed rgba(120,170,255,0.45)',
      'background:rgba(120,170,255,0.1)',
      'color:#b9d2ff',
      'border-radius:8px',
      'font:11px/1.2 sans-serif',
      'padding:8px',
      'text-align:center'
    ].join(';');
    zone.addEventListener('dragover', (event) => {
      event.preventDefault();
      zone.style.background = 'rgba(120,170,255,0.22)';
    });
    zone.addEventListener('dragleave', () => {
      zone.style.background = 'rgba(120,170,255,0.1)';
    });
    zone.addEventListener('drop', (event) => {
      event.preventDefault();
      zone.style.background = 'rgba(120,170,255,0.1)';
      this.moveByDropTarget(zone);
    });
    return zone;
  }

  createTile(slide, h, v, selection) {
    const preview = parseSlidePreview(slide);
    const tile = document.createElement('div');
    tile.draggable = true;
    tile.dataset.h = String(h);
    tile.dataset.v = String(v);
    tile.style.cssText = [
      'position:relative',
      'display:flex',
      'flex-direction:column',
      'gap:8px',
      'border-radius:10px',
      'border:1px solid rgba(255,255,255,0.18)',
      'background:#1a2334',
      'min-height:132px',
      'padding:10px',
      'cursor:grab',
      'user-select:none'
    ].join(';');
    if (selection.h === h && selection.v === v) {
      tile.style.outline = '2px solid #6fb2ff';
    }

    if (String(slide?.top || '').trim()) {
      const topBar = document.createElement('div');
      topBar.style.cssText = [
        'position:absolute',
        'left:0',
        'top:0',
        'width:100%',
        'height:5px',
        'border-radius:10px 10px 0 0',
        'background:#ef4444'
      ].join(';');
      tile.appendChild(topBar);
    }

    const title = document.createElement('div');
    title.textContent = preview.heading;
    title.style.cssText = 'font:700 16px/1.25 sans-serif; padding-top:4px;';
    tile.appendChild(title);

    if (preview.twoCol) {
      const twoCol = document.createElement('div');
      twoCol.style.cssText = 'display:grid; grid-template-columns:1fr 1fr; gap:6px;';
      preview.twoCol.forEach((segment, index) => {
        const block = document.createElement('div');
        block.textContent = plainText(segment) || `(column ${index + 1})`;
        block.style.cssText = [
          'min-height:46px',
          'padding:4px 5px',
          'border-radius:6px',
          'font:11px/1.25 sans-serif',
          'background:rgba(255,255,255,0.08)',
          'overflow:hidden'
        ].join(';');
        twoCol.appendChild(block);
      });
      tile.appendChild(twoCol);
    } else if (preview.bodyLines.length) {
      const body = document.createElement('div');
      body.style.cssText = 'font:11px/1.3 sans-serif; opacity:.9;';
      preview.bodyLines.forEach((line) => {
        const textLine = document.createElement('div');
        textLine.textContent = line;
        body.appendChild(textLine);
      });
      tile.appendChild(body);
    }

    if (preview.images.length) {
      const media = document.createElement('div');
      media.style.cssText = 'display:flex; flex-wrap:wrap; gap:4px;';
      preview.images.forEach((src) => {
        const chip = document.createElement('div');
        chip.textContent = `🖼 ${src}`;
        chip.style.cssText = [
          'max-width:100%',
          'overflow:hidden',
          'text-overflow:ellipsis',
          'white-space:nowrap',
          'font:10px/1.2 monospace',
          'padding:2px 6px',
          'border-radius:999px',
          'background:rgba(255,255,255,0.12)'
        ].join(';');
        media.appendChild(chip);
      });
      tile.appendChild(media);
    }

    const footer = document.createElement('div');
    footer.textContent = `H${h + 1} / V${v + 1}`;
    footer.style.cssText = 'margin-top:auto; font:10px/1.2 monospace; opacity:.6;';
    tile.appendChild(footer);

    tile.addEventListener('dragstart', () => {
      this.dragSource = { h, v };
      tile.style.opacity = '0.45';
    });
    tile.addEventListener('dragend', () => {
      this.dragSource = null;
      tile.style.opacity = '1';
    });
    tile.addEventListener('dragover', (event) => {
      event.preventDefault();
      tile.style.borderColor = '#7aa8ff';
      tile.style.background = '#202d44';
    });
    tile.addEventListener('dragleave', () => {
      tile.style.borderColor = 'rgba(255,255,255,0.18)';
      tile.style.background = '#1a2334';
    });
    tile.addEventListener('drop', (event) => {
      event.preventDefault();
      tile.style.borderColor = 'rgba(255,255,255,0.18)';
      tile.style.background = '#1a2334';
      this.moveByDropTarget(tile);
    });
    tile.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.openContextMenu(event.clientX, event.clientY, [
        {
          label: 'Insert Slide After',
          action: () => {
            const moved = insertSlideAfterInStacks(this.stacks, h, v, createNewSlide());
            if (moved) this.commit(moved, 'Slide sorter insert slide');
          }
        },
        {
          label: 'Duplicate Slide',
          action: () => {
            const moved = duplicateSlideInStacks(this.stacks, h, v);
            if (moved) this.commit(moved, 'Slide sorter duplicate slide');
          }
        },
        {
          label: 'Delete Slide',
          action: () => {
            const moved = deleteSlideInStacks(this.stacks, h, v);
            if (moved) this.commit(moved, 'Slide sorter delete slide');
          }
        }
      ]);
    });

    tile.addEventListener('dblclick', () => {
      this.host.transact('Slide sorter select slide', (tx) => {
        tx.setSelection({ h, v });
      });
      deactivateCurrentBuilderMode();
    });

    return tile;
  }
}

export function getBuilderExtensions(ctx = {}) {
  const host = ctx.host;
  if (!host) return [];

  return [
    {
      kind: 'slide-navigator-renderer',
      id: 'slidesorter-slide-nav-renderer',
      renderTile: createNavigatorTileRenderer()
    },
    {
      kind: 'mode',
      id: 'slide-sorter-mode',
      label: 'Slide Sorter',
      icon: '🧱',
      location: 'preview-header',
      mount(modeCtx) {
        const view = new SlideSorterView(modeCtx.host);
        return {
          onActivate() {
            view.mount();
          },
          onDeactivate() {
            view.dispose();
          },
          onDocumentChanged() {
            view.refresh();
          }
        };
      }
    }
  ];
}
