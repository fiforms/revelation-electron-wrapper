function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function normalizeSlide(slide) {
  const top = String(slide?.top || '');
  const body = String(slide?.body || '');
  const notes = String(slide?.notes || '');
  return { top, body, notes };
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

function createNewSlide() {
  return {
    top: '',
    body: '',
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

function moveColumnInStacks(stacks, fromH, toH, place = 'before') {
  const working = normalizeStacks(clone(stacks));
  const sourceH = Number(fromH);
  const targetH = Number(toH);
  const dropPlace = place === 'after' ? 'after' : 'before';
  if (!Number.isInteger(sourceH) || !Number.isInteger(targetH)) return null;
  if (!working[sourceH] || !working[targetH]) return null;
  if (sourceH === targetH) return normalizeStacks(working);

  let insertIndex = targetH + (dropPlace === 'after' ? 1 : 0);
  insertIndex = clamp(insertIndex, 0, working.length);

  const [column] = working.splice(sourceH, 1);
  if (!column) return null;
  if (sourceH < insertIndex) insertIndex -= 1;
  insertIndex = clamp(insertIndex, 0, working.length);
  working.splice(insertIndex, 0, column);
  return normalizeStacks(working);
}

function plainText(text) {
  return String(text || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*:ATTRIB:.*$/gim, '')
    .replace(/^\s*:AI:\s*$/gim, '')
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/!\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/\{\{[^}]+\}\}/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const slideSorterMediaRuntime = {
  slug: '',
  dir: '',
  mediaByTag: {},
  lastFrontmatter: null
};
let slideSorterInitialized = false;
const PREVIEW_VIEW_GROUP = 'core-preview-view';
const PREVIEW_SLIDE_BUTTON_ID = 'core-preview-slide';
const PREVIEW_OVERVIEW_BUTTON_ID = 'core-preview-overview';
const SLIDE_SORTER_BUTTON_ID = 'slide-sorter-mode';
let lastViewButtonIdBeforeSorter = '';

function getActivePreviewButtonId() {
  const activeButton = document.querySelector('.builder-extension-preview-button.is-active');
  if (!(activeButton instanceof HTMLElement)) return '';
  return String(activeButton.dataset.previewButtonId || activeButton.id || '').trim();
}

function encodePathSafely(pathValue) {
  const raw = String(pathValue || '');
  if (!raw) return '';
  return raw
    .split('/')
    .map((segment) => {
      if (!segment) return segment;
      let decoded = segment;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        decoded = segment;
      }
      return encodeURIComponent(decoded);
    })
    .join('/');
}

function normalizeFrontmatterYaml(frontmatter) {
  const text = String(frontmatter || '').trim();
  if (!text) return '';
  const wrapped = text.match(/^---\r?\n([\s\S]*?)\r?\n---\s*$/);
  if (wrapped) return wrapped[1];
  return text.replace(/^---\r?\n/, '').replace(/\r?\n---\s*$/, '');
}

function updateMediaRuntime(host, context = {}) {
  const ctxSlug = String(context?.slug || '').trim();
  const ctxDir = String(context?.dir || '').trim();
  if (ctxSlug) slideSorterMediaRuntime.slug = ctxSlug;
  if (ctxDir) slideSorterMediaRuntime.dir = ctxDir;

  if (!host || typeof host.getDocument !== 'function') return;
  const yaml = window.jsyaml;
  if (!yaml || typeof yaml.load !== 'function') return;

  try {
    const doc = host.getDocument();
    const frontmatter = String(doc?.frontmatter || '');
    if (frontmatter === slideSorterMediaRuntime.lastFrontmatter) return;
    slideSorterMediaRuntime.lastFrontmatter = frontmatter;
    slideSorterMediaRuntime.mediaByTag = {};

    const yamlText = normalizeFrontmatterYaml(frontmatter);
    if (!yamlText) return;
    const parsed = yaml.load(yamlText) || {};
    const media = parsed?.media && typeof parsed.media === 'object' ? parsed.media : {};
    Object.entries(media).forEach(([tag, entry]) => {
      const key = String(tag || '').trim();
      if (!key) return;
      slideSorterMediaRuntime.mediaByTag[key] = entry || {};
    });
  } catch {
    slideSorterMediaRuntime.mediaByTag = {};
  }
}

function resolveMediaDisplaySrc(rawSrc, host, context = {}) {
  const src = String(rawSrc || '').trim();
  if (!src) return '';
  if (
    src.startsWith('http://') ||
    src.startsWith('https://') ||
    src.startsWith('data:') ||
    src.startsWith('blob:') ||
    src.startsWith('file:') ||
    src.startsWith('/')
  ) {
    return src;
  }

  updateMediaRuntime(host, context);

  if (src.startsWith('media:')) {
    const tag = src.slice('media:'.length).trim();
    const mediaEntry = slideSorterMediaRuntime.mediaByTag[tag];
    const filename = String(mediaEntry?.filename || '').trim();
    if (!filename) return '';
    const { dir, slug } = slideSorterMediaRuntime;
    if (!dir || !slug) return filename;
    return encodePathSafely(`/${dir}/${slug}/${filename}`);
  }

  const { dir, slug } = slideSorterMediaRuntime;
  if (!dir || !slug) return src;
  return encodePathSafely(`/${dir}/${slug}/${src}`);
}

function parseMarkdownDestination(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (value.startsWith('<')) {
    const close = value.indexOf('>');
    if (close > 1) return value.slice(1, close).trim();
  }
  return value.split(/\s+/)[0] || '';
}

function cleanMediaSrc(raw) {
  let value = String(raw || '').trim();
  if (!value) return '';
  value = parseMarkdownDestination(value);
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1).trim();
  }
  return value;
}

function isBackgroundAlt(alt) {
  return /^background(?::|$)/i.test(String(alt || '').trim());
}

function isVideoSrc(src) {
  const value = String(src || '').trim();
  if (!value) return false;
  if (/^data:video\//i.test(value)) return true;
  const core = value.split('#')[0].split('?')[0].toLowerCase();
  return /\.(mp4|m4v|mov|webm|ogv|ogg|mkv|avi|wmv|flv|m3u8)$/i.test(core);
}

function extractMediaCandidates(markdown) {
  const body = String(markdown || '');
  const media = [];
  const seen = new Set();
  const pushMedia = (src, type) => {
    const key = `${type}:${src}`;
    if (!src || seen.has(key)) return;
    seen.add(key);
    media.push({ src, type });
  };
  const mdPattern = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let match;
  while ((match = mdPattern.exec(body)) !== null) {
    const alt = String(match[1] || '').trim();
    if (isBackgroundAlt(alt)) continue;
    const src = cleanMediaSrc(match[2] || '');
    if (!src) continue;
    pushMedia(src, isVideoSrc(src) ? 'video' : 'image');
    if (media.length >= 6) break;
  }
  if (media.length < 6) {
    const htmlPattern = /<(img|video)\b[^>]*\bsrc\s*=\s*(['"])(.*?)\2[^>]*>/gi;
    while ((match = htmlPattern.exec(body)) !== null) {
      const tag = String(match[1] || '').toLowerCase();
      const src = cleanMediaSrc(match[3] || '');
      if (!src) continue;
      pushMedia(src, tag === 'video' || isVideoSrc(src) ? 'video' : 'image');
      if (media.length >= 6) break;
    }
  }
  return media;
}

function createSquareMediaThumb(preview, size = 56, host = null, context = {}) {
  const media = preview?.primaryMedia;
  if (!media?.src) return null;
  const resolvedSrc = resolveMediaDisplaySrc(media.src, host, context) || media.src;
  const frame = document.createElement('div');
  frame.style.cssText = [
    'flex:0 0 auto',
    `width:${size}px`,
    `height:${size}px`,
    'overflow:hidden',
    'border-radius:8px',
    'background:rgba(255,255,255,0.08)',
    'align-self:flex-start'
  ].join(';');
  const node = document.createElement(media.type === 'video' ? 'video' : 'img');
  node.src = resolvedSrc;
  node.style.cssText = 'display:block; width:100%; height:100%; object-fit:cover; object-position:center; pointer-events:none;';
  if (media.type === 'video') {
    node.preload = 'metadata';
    node.muted = true;
    node.playsInline = true;
    node.setAttribute('aria-label', 'Video thumbnail');
  } else {
    node.alt = '';
  }
  frame.appendChild(node);
  return frame;
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
  const citeLines = [];
  const takeCite = (raw) => {
    const matches = String(raw || '').match(/<cite\b[^>]*>([\s\S]*?)<\/cite>/gi) || [];
    matches.forEach((entry) => {
      const inner = entry.replace(/^<cite\b[^>]*>/i, '').replace(/<\/cite>$/i, '');
      const cleaned = plainText(inner);
      if (cleaned) citeLines.push(cleaned);
    });
  };

  lines.forEach((line) => {
    if (/^:ATTRIB:/i.test(line)) {
      const attrib = plainText(line.replace(/^:ATTRIB:/i, ''));
      if (attrib) citeLines.push(attrib);
      return;
    }
    takeCite(line);
    if (!heading && line.startsWith('#')) {
      heading = plainText(line.replace(/^#+\s*/, ''));
      return;
    }
    if (line.startsWith('![')) return;
    if (line === '||') return;
    const cleaned = plainText(String(line).replace(/<cite\b[^>]*>[\s\S]*?<\/cite>/gi, ' '));
    if (cleaned) textLines.push(cleaned);
  });

  const columns = parseTwoColumnSegments(body);
  const media = extractMediaCandidates(body);
  const images = media.filter((item) => item.type === 'image').map((item) => item.src).slice(0, 4);
  const hasMedia = media.length > 0;
  const isBlank = !heading && textLines.length === 0 && citeLines.length === 0 && !hasMedia;
  const imageOnly = hasMedia && !heading && textLines.length === 0 && citeLines.length === 0;
  return {
    heading,
    bodyLines: textLines.slice(0, 4),
    citeLines: citeLines.slice(0, 2),
    images,
    media,
    primaryMedia: media[0] || null,
    twoCol: columns,
    isBlank,
    imageOnly
  };
}

function createNavigatorTileRenderer(rendererCtx = {}) {
  let menuEl = null;
  const closeMenu = () => {
    if (!menuEl) return;
    document.removeEventListener('mousedown', handleOutside, true);
    document.removeEventListener('keydown', handleKeydown, true);
    menuEl.remove();
    menuEl = null;
  };
  const handleOutside = (event) => {
    if (!menuEl) return;
    if (menuEl.contains(event.target)) return;
    closeMenu();
  };
  const handleKeydown = (event) => {
    if (event.key === 'Escape') {
      closeMenu();
    }
  };
  const openMenu = (x, y, items = []) => {
    closeMenu();
    if (!items.length) return;
    const menu = document.createElement('div');
    menu.style.cssText = [
      'position:fixed',
      'left:0',
      'top:0',
      'z-index:24000',
      'min-width:180px',
      'padding:6px',
      'border-radius:10px',
      'border:1px solid rgba(255,255,255,0.16)',
      'background:rgba(19,27,40,0.98)',
      'box-shadow:0 12px 28px rgba(0,0,0,0.45)',
      'display:flex',
      'flex-direction:column',
      'gap:4px'
    ].join(';');
    items.forEach((item) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'panel-button';
      btn.textContent = item.label;
      btn.style.cssText = [
        'text-align:left',
        'font:12px/1.2 sans-serif',
        'padding:8px 10px'
      ].join(';');
      btn.addEventListener('click', () => {
        closeMenu();
        item.action?.();
      });
      menu.appendChild(btn);
    });
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    const left = Math.min(Math.max(8, x), window.innerWidth - rect.width - 8);
    const top = Math.min(Math.max(8, y), window.innerHeight - rect.height - 8);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menuEl = menu;
    document.addEventListener('mousedown', handleOutside, true);
    document.addEventListener('keydown', handleKeydown, true);
  };

  return ({ host, slide, h, v, hasTopMatter }) => {
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

    const titleText = preview.heading || (preview.imageOnly ? 'Media' : (preview.isBlank ? '(blank slide)' : ''));
    if (titleText) {
      const title = document.createElement('div');
      title.textContent = titleText;
      title.style.cssText = 'font:700 14px/1.25 sans-serif; color:#eef3ff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;';
      shell.appendChild(title);
    }

    const bodyWrap = document.createElement('div');
    bodyWrap.style.cssText = 'display:flex; gap:8px; min-height:34px; align-items:flex-start;';
    const textCol = document.createElement('div');
    textCol.style.cssText = 'min-width:0; flex:1 1 auto;';

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
      textCol.appendChild(twoCol);
    } else {
      const body = document.createElement('div');
      body.style.cssText = 'font:11px/1.3 sans-serif; color:#bcc8de; min-height:34px;';
      if (preview.bodyLines.length) {
        preview.bodyLines.slice(0, 3).forEach((line) => {
          const textLine = document.createElement('div');
          textLine.textContent = line;
          body.appendChild(textLine);
        });
      } else if (preview.citeLines.length) {
        preview.citeLines.forEach((line) => {
          const citeLine = document.createElement('div');
          citeLine.textContent = line;
          citeLine.style.cssText = 'font-style:italic; color:#a9b8d5;';
          body.appendChild(citeLine);
        });
      } else if (preview.isBlank) {
        body.textContent = '(blank slide)';
        body.style.fontStyle = 'italic';
        body.style.color = '#7f8aa3';
      }
      textCol.appendChild(body);
    }
    bodyWrap.appendChild(textCol);
    const navThumb = createSquareMediaThumb(preview, 52, host || null, rendererCtx);
    if (navThumb) {
      bodyWrap.appendChild(navThumb);
    }
    shell.appendChild(bodyWrap);

    shell.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const activeHost = host || window.RevelationBuilderHost;
      if (!activeHost) return;
      openMenu(event.clientX, event.clientY, [
        {
          label: 'Insert Slide After',
          action: () => {
            const doc = activeHost.getDocument();
            const moved = insertSlideAfterInStacks(doc?.stacks || [], h, v, createNewSlide());
            if (!moved) return;
            const nextColumn = moved[h] || [];
            const nextV = Math.min(v + 1, Math.max(nextColumn.length - 1, 0));
            activeHost.transact('Sidebar insert slide', (tx) => {
              tx.replaceStacks(moved);
              tx.setSelection({ h, v: nextV });
            });
          }
        },
        {
          label: 'Duplicate Slide',
          action: () => {
            const doc = activeHost.getDocument();
            const moved = duplicateSlideInStacks(doc?.stacks || [], h, v);
            if (!moved) return;
            const nextColumn = moved[h] || [];
            const nextV = Math.min(v + 1, Math.max(nextColumn.length - 1, 0));
            activeHost.transact('Sidebar duplicate slide', (tx) => {
              tx.replaceStacks(moved);
              tx.setSelection({ h, v: nextV });
            });
          }
        },
        {
          label: 'Delete Slide',
          action: () => {
            const doc = activeHost.getDocument();
            const moved = deleteSlideInStacks(doc?.stacks || [], h, v);
            if (!moved) return;
            const nextH = clamp(h, 0, Math.max(moved.length - 1, 0));
            const nextColumn = moved[nextH] || [];
            const nextV = clamp(v, 0, Math.max(nextColumn.length - 1, 0));
            activeHost.transact('Sidebar delete slide', (tx) => {
              tx.replaceStacks(moved);
              tx.setSelection({ h: nextH, v: nextV });
            });
          }
        },
        {
          label: 'Open Slide Sorter',
          action: () => {
            activateSlideSorterMode(activeHost);
          }
        }
      ]);
    });

    return shell;
  };
}

function restoreCorePreviewButtonState(host) {
  if (!host || typeof host.setPreviewButtonGroupActive !== 'function') return;
  const rememberedId = String(lastViewButtonIdBeforeSorter || '').trim();
  if (rememberedId && rememberedId !== SLIDE_SORTER_BUTTON_ID) {
    host.setPreviewButtonGroupActive(PREVIEW_VIEW_GROUP, rememberedId);
    lastViewButtonIdBeforeSorter = '';
    return;
  }
  const deck = window.__builderPreviewDeck;
  const isOverview = !!(deck && typeof deck.isOverview === 'function' && deck.isOverview());
  host.setPreviewButtonGroupActive(
    PREVIEW_VIEW_GROUP,
    isOverview ? PREVIEW_OVERVIEW_BUTTON_ID : PREVIEW_SLIDE_BUTTON_ID
  );
  lastViewButtonIdBeforeSorter = '';
}

function deactivateSlideSorterMode(host, { restorePreviewButtons = true } = {}) {
  if (!host || typeof host.setPreviewButtonGroupActive !== 'function') return;
  host.setPreviewButtonGroupActive(PREVIEW_VIEW_GROUP, '');
  if (restorePreviewButtons) {
    restoreCorePreviewButtonState(host);
  }
}

function activateSlideSorterMode(host) {
  if (!host || typeof host.setPreviewButtonGroupActive !== 'function') return;
  const currentId = getActivePreviewButtonId();
  if (currentId && currentId !== SLIDE_SORTER_BUTTON_ID) {
    lastViewButtonIdBeforeSorter = currentId;
  }
  host.setPreviewButtonGroupActive(PREVIEW_VIEW_GROUP, SLIDE_SORTER_BUTTON_ID);
}

class SlideSorterView {
  constructor(host, modeCtx = {}) {
    this.host = host;
    this.modeCtx = modeCtx;
    this.root = null;
    this.viewport = null;
    this.board = null;
    this.matrix = null;
    this.dragSource = null;
    this.columnDragSource = null;
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
        deactivateSlideSorterMode(this.host);
        return;
      }

      const navKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'];
      if (!navKeys.includes(event.key)) return;
      const target = event.target;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

      event.preventDefault();
      const sel = this.host.getSelection();
      const h = sel.h;
      const v = sel.v;
      const maxH = Math.max(this.stacks.length - 1, 0);
      const colLen = (col) => Math.max((this.stacks[col] || []).length - 1, 0);
      const hasCmd = event.ctrlKey || event.metaKey;

      let nextH = h;
      let nextV = v;

      switch (event.key) {
        case 'ArrowLeft':
          nextH = Math.max(h - 1, 0);
          nextV = Math.min(v, colLen(nextH));
          break;
        case 'ArrowRight':
          nextH = Math.min(h + 1, maxH);
          nextV = Math.min(v, colLen(nextH));
          break;
        case 'ArrowUp':
          nextV = Math.max(v - 1, 0);
          break;
        case 'ArrowDown':
          nextV = Math.min(v + 1, colLen(h));
          break;
        case 'Home':
          if (hasCmd) { nextH = 0; nextV = 0; }
          else { nextV = 0; }
          break;
        case 'End':
          if (hasCmd) { nextH = maxH; nextV = colLen(nextH); }
          else { nextV = colLen(h); }
          break;
        case 'PageUp':
          nextV = 0;
          break;
        case 'PageDown':
          nextV = colLen(h);
          break;
      }

      if (nextH === h && nextV === v) return;
      this.host.transact('Slide sorter navigate', (tx) => {
        tx.setSelection({ h: nextH, v: nextV });
      });
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
    closeBtn.addEventListener('click', () => deactivateSlideSorterMode(this.host));
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
    this.matrix = null;
    this.dragSource = null;
    this.columnDragSource = null;
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

  moveColumnByDropTarget(toH, place = 'before') {
    if (!Number.isInteger(this.columnDragSource)) return;
    const fromH = this.columnDragSource;
    const moved = moveColumnInStacks(this.stacks, fromH, toH, place);
    this.columnDragSource = null;
    if (!moved) return;
    this.commit(moved, 'Slide sorter move column');
  }

  clearColumnDropIndicators() {
    if (!(this.matrix instanceof HTMLElement)) return;
    this.matrix.querySelectorAll('[data-column-index]').forEach((columnEl) => {
      if (!(columnEl instanceof HTMLElement)) return;
      columnEl.style.boxShadow = '';
    });
  }

  setColumnDropIndicator(targetH, place = 'before') {
    this.clearColumnDropIndicators();
    if (!(this.matrix instanceof HTMLElement)) return;
    const columnEl = this.matrix.querySelector(`[data-column-index="${targetH}"]`);
    if (!(columnEl instanceof HTMLElement)) return;
    columnEl.style.boxShadow = place === 'after'
      ? 'inset -6px 0 0 #3b9cff'
      : 'inset 6px 0 0 #3b9cff';
  }

  renderBoard() {
    const selection = this.host.getSelection();
    this.board.innerHTML = '';
    this.matrix = null;
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
      columnEl.dataset.columnIndex = String(h);
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

    this.matrix = matrix;
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
      chip.draggable = this.stacks.length > 1;
      const clearDropIndicator = () => {
        chip.style.borderColor = '';
        chip.style.background = '';
        chip.style.boxShadow = '';
      };
      const setDropIndicator = (place) => {
        chip.style.background = 'rgba(122,168,255,0.12)';
        chip.style.borderColor = '#7aa8ff';
        chip.style.boxShadow = place === 'after'
          ? 'inset -4px 0 0 #7aa8ff'
          : 'inset 4px 0 0 #7aa8ff';
        this.setColumnDropIndicator(h, place);
      };
      chip.style.cssText = oneColumn
        ? 'white-space:nowrap;'
        : 'white-space:nowrap; width:100%; text-align:left; justify-content:flex-start;';
      chip.addEventListener('dragstart', (event) => {
        if (this.stacks.length <= 1) return;
        this.columnDragSource = h;
        chip.style.opacity = '0.55';
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', String(h));
        }
      });
      chip.addEventListener('dragend', () => {
        this.columnDragSource = null;
        chip.style.opacity = '';
        clearDropIndicator();
        this.clearColumnDropIndicators();
      });
      chip.addEventListener('dragover', (event) => {
        if (!Number.isInteger(this.columnDragSource)) return;
        event.preventDefault();
        const rect = chip.getBoundingClientRect();
        const place = event.clientX >= rect.left + rect.width / 2 ? 'after' : 'before';
        setDropIndicator(place);
      });
      chip.addEventListener('dragleave', () => {
        clearDropIndicator();
        this.clearColumnDropIndicators();
      });
      chip.addEventListener('drop', (event) => {
        if (!Number.isInteger(this.columnDragSource)) return;
        event.preventDefault();
        const rect = chip.getBoundingClientRect();
        const place = event.clientX >= rect.left + rect.width / 2 ? 'after' : 'before';
        clearDropIndicator();
        this.clearColumnDropIndicators();
        this.moveColumnByDropTarget(h, place);
      });
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

    const titleText = preview.heading || (preview.imageOnly ? 'Media' : (preview.isBlank ? '(blank slide)' : ''));
    if (titleText) {
      const title = document.createElement('div');
      title.textContent = titleText;
      title.style.cssText = 'font:700 16px/1.25 sans-serif; padding-top:4px;';
      tile.appendChild(title);
    }

    const bodyWrap = document.createElement('div');
    bodyWrap.style.cssText = 'display:flex; gap:8px; align-items:flex-start; min-height:46px;';
    const textCol = document.createElement('div');
    textCol.style.cssText = 'min-width:0; flex:1 1 auto;';

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
      textCol.appendChild(twoCol);
    } else if (preview.bodyLines.length || preview.citeLines.length || preview.isBlank) {
      const body = document.createElement('div');
      body.style.cssText = 'font:11px/1.3 sans-serif; opacity:.9;';
      if (preview.bodyLines.length) {
        preview.bodyLines.forEach((line) => {
          const textLine = document.createElement('div');
          textLine.textContent = line;
          body.appendChild(textLine);
        });
      } else if (preview.citeLines.length) {
        preview.citeLines.forEach((line) => {
          const citeLine = document.createElement('div');
          citeLine.textContent = line;
          citeLine.style.cssText = 'font-style:italic; color:#a9b8d5;';
          body.appendChild(citeLine);
        });
      } else if (preview.isBlank) {
        const blank = document.createElement('div');
        blank.textContent = '(blank slide)';
        blank.style.cssText = 'font-style:italic; color:#7f8aa3;';
        body.appendChild(blank);
      }
      textCol.appendChild(body);
    }
    bodyWrap.appendChild(textCol);
    const sorterThumb = createSquareMediaThumb(preview, 64, this.host, this.modeCtx);
    if (sorterThumb) {
      bodyWrap.appendChild(sorterThumb);
    }
    tile.appendChild(bodyWrap);

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
      deactivateSlideSorterMode(this.host);
    });

    return tile;
  }
}

export function getBuilderExtensions(ctx = {}) {
  const host = ctx.host;
  if (!host) return [];
  if (slideSorterInitialized) {
    return [
      {
        kind: 'slide-navigator-renderer',
        id: 'slidesorter-slide-nav-renderer',
        renderTile: createNavigatorTileRenderer(ctx)
      }
    ];
  }
  slideSorterInitialized = true;

  const modeCtx = {
    host,
    slug: ctx.slug,
    dir: ctx.dir,
    mdFile: ctx.mdFile
  };
  const view = new SlideSorterView(host, modeCtx);
  let active = false;

  const activate = () => {
    if (active) return;
    active = true;
    view.mount();
  };
  const deactivate = () => {
    if (!active) return;
    active = false;
    view.dispose();
  };

  host.on('document:changed', () => {
    if (!active) return;
    view.refresh();
  });

  if (typeof host.registerKeyboardShortcut === 'function') {
    host.registerKeyboardShortcut({
      key: 'Escape',
      onTrigger() {
        if (!active) {
          activateSlideSorterMode(host);
        }
      }
    });
  }
  host.on('preview-button:changed', (payload = {}) => {
    if (String(payload.id || '') !== SLIDE_SORTER_BUTTON_ID) return;
    if (payload.active) {
      activate();
      return;
    }
    deactivate();
  });

  host.registerPreviewButton({
    id: SLIDE_SORTER_BUTTON_ID,
    location: 'preview-header',
    title: '🧱 Slide Sorter',
    tooltip: 'Slide Sorter',
    group: PREVIEW_VIEW_GROUP,
    onClick: ({ isActive: buttonIsActive, setGroupActive }) => {
      if (buttonIsActive()) {
        deactivateSlideSorterMode(host);
        return;
      }
      activateSlideSorterMode(host);
    }
  });

  return [
    {
      kind: 'slide-navigator-renderer',
      id: 'slidesorter-slide-nav-renderer',
      renderTile: createNavigatorTileRenderer(ctx)
    }
  ];
}
