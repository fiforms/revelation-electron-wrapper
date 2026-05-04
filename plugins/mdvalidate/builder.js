// Builder extension: Markdown Validator
// Adds a "Validate" button to the preview header. Clicking it opens a
// full-screen overlay showing a pass/fail report for every check.

const BTN_ID = 'mdvalidate-validate-btn';

function css(parts) {
  return Array.isArray(parts) ? parts.join(';') : parts;
}

function el(tag, styles, props = {}) {
  const node = document.createElement(tag);
  if (styles) node.style.cssText = css(styles);
  Object.assign(node, props);
  return node;
}

// ── Overlay UI ───────────────────────────────────────────────────────────────

const LEVEL_COLORS = {
  pass: { bg: 'rgba(34,197,94,0.05)',  border: 'rgba(34,197,94,0.22)',  badge: '#22c55e', text: '#4ade80',  item: '#86efac' },
  warn: { bg: 'rgba(245,158,11,0.07)', border: 'rgba(245,158,11,0.30)', badge: '#f59e0b', text: '#fbbf24',  item: '#fcd34d' },
  fail: { bg: 'rgba(239,68,68,0.07)',  border: 'rgba(239,68,68,0.28)',  badge: '#ef4444', text: '#f87171',  item: '#fca5a5' }
};

const LEVEL_SYMBOL = { pass: '✓', warn: '⚠', fail: '✗' };
const LEVEL_TAG    = { pass: '[PASS]', warn: '[WARN]', fail: '[FAIL]' };

function formatReportText(slug, mdFile, result) {
  if (!result || result.error) return `Markdown Validator — ${slug}/${mdFile}\nError: ${result?.error || 'Unknown'}`;
  const { checks, summary } = result;
  const statusParts = [];
  if (summary.failed > 0) statusParts.push(`${summary.failed} failed`);
  if (summary.warned > 0) statusParts.push(`${summary.warned} warning(s)`);
  const parts = statusParts.length ? statusParts.join(', ') : 'all passed';
  const lines = [
    `Markdown Validator Report`,
    `Presentation: ${slug}/${mdFile}`,
    `${summary.passed}/${summary.total} checks passed — ${parts}`,
    ''
  ];
  for (const check of checks) {
    lines.push(`${LEVEL_TAG[check.level] || '[PASS]'} ${check.label}`);
    for (const msg of check.errors) {
      lines.push(`       ${msg}`);
    }
  }
  return lines.join('\n');
}

function createValidatorOverlay({ host, slug, mdFile, onClose }) {
  let running = false;
  let lastResult = null;

  const overlay = el('div', [
    'position:fixed', 'inset:0', 'z-index:20000',
    'display:flex', 'flex-direction:column',
    'background:#0d111a', 'color:#f2f4f8'
  ]);

  // Header
  const header = el('div', [
    'display:flex', 'align-items:center', 'gap:10px',
    'padding:10px 14px',
    'border-bottom:1px solid rgba(255,255,255,0.12)',
    'background:#121a29', 'flex-shrink:0'
  ]);

  const titleEl = el('div', 'font:600 15px/1.2 sans-serif; flex:1;');
  titleEl.textContent = 'Markdown Validator';

  const fileLabel = el('div', 'font:12px/1.2 monospace; color:#7f9ac3; flex:1;');
  fileLabel.textContent = mdFile || 'presentation.md';

  const runBtn = el('button', null, { type: 'button', className: 'panel-button' });
  runBtn.textContent = 'Run Validation';
  runBtn.addEventListener('click', () => runValidation());

  const copyBtn = el('button', null, { type: 'button', className: 'panel-button' });
  copyBtn.textContent = 'Copy Report';
  copyBtn.disabled = true;
  copyBtn.addEventListener('click', async () => {
    if (!lastResult) return;
    try {
      await navigator.clipboard.writeText(formatReportText(slug, mdFile, lastResult));
      const prev = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = prev; }, 1500);
    } catch {
      copyBtn.textContent = 'Copy failed';
      setTimeout(() => { copyBtn.textContent = 'Copy Report'; }, 1500);
    }
  });

  const saveAnywayBtn = el('button', null, { type: 'button', className: 'panel-button' });
  saveAnywayBtn.textContent = 'Save Anyway';
  saveAnywayBtn.style.cssText += ';background:#2563eb;border-color:#2563eb;color:#fff';
  saveAnywayBtn.style.display = 'none';
  saveAnywayBtn.addEventListener('click', () => {
    onClose();
    if (typeof window.__revelationBuilderForceSave === 'function') {
      window.__revelationBuilderForceSave();
    }
  });

  const closeBtn = el('button', null, { type: 'button', className: 'panel-button' });
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', onClose);

  header.append(titleEl, fileLabel, runBtn, copyBtn, saveAnywayBtn, closeBtn);

  // Body
  const body = el('div', 'flex:1; overflow:auto; padding:20px;');

  const hint = el('p', 'color:#8899bb; font:13px/1.5 sans-serif; margin:0;');
  hint.textContent = 'Click "Run Validation" to check this presentation\'s markdown file.';
  body.appendChild(hint);

  overlay.append(header, body);

  // ── Render helpers ──────────────────────────────────────────────────────────

  function renderError(msg) {
    body.innerHTML = '';
    const p = el('p', 'color:#f87171; font:13px/1.5 sans-serif; margin:0;');
    p.textContent = `Error: ${msg}`;
    body.appendChild(p);
  }

  function renderReport(result) {
    body.innerHTML = '';

    if (!result || result.error) {
      renderError(result?.error || 'Unknown error');
      return;
    }

    const { checks, summary } = result;
    const allOk = summary.failed === 0 && summary.warned === 0;
    const bannerColor = summary.failed > 0 ? LEVEL_COLORS.fail : summary.warned > 0 ? LEVEL_COLORS.warn : LEVEL_COLORS.pass;

    // Summary banner
    const banner = el('div', [
      'padding:12px 16px', 'border-radius:8px', 'margin-bottom:20px',
      `background:${bannerColor.bg.replace('0.05', '0.12').replace('0.07', '0.12')}`,
      `border:1px solid ${bannerColor.border}`,
      'font:14px/1.5 sans-serif'
    ]);

    if (allOk) {
      banner.innerHTML = `<strong style="color:${LEVEL_COLORS.pass.text}">All ${summary.total} checks passed</strong>`;
    } else {
      const parts = [];
      if (summary.failed > 0) parts.push(`<strong style="color:${LEVEL_COLORS.fail.text}">${summary.failed} of ${summary.total} checks failed</strong> (${summary.errorCount} error${summary.errorCount !== 1 ? 's' : ''})`);
      if (summary.warned > 0) parts.push(`<strong style="color:${LEVEL_COLORS.warn.text}">${summary.warned} warning${summary.warned !== 1 ? 's' : ''}</strong>`);
      banner.innerHTML = parts.join(' &nbsp;·&nbsp; ');
    }
    body.appendChild(banner);

    // One row per check
    for (const check of checks) {
      const c = LEVEL_COLORS[check.level] || LEVEL_COLORS.pass;
      const row = el('div', [
        'margin-bottom:10px', 'border-radius:8px', 'overflow:hidden',
        `border:1px solid ${c.border}`, `background:${c.bg}`
      ]);

      const rowHead = el('div', 'display:flex; align-items:center; gap:10px; padding:10px 14px;');

      const badge = el('span', [
        'flex:0 0 auto', 'width:20px', 'height:20px', 'border-radius:50%',
        'display:flex', 'align-items:center', 'justify-content:center',
        'font:bold 11px sans-serif', `background:${c.badge}`, 'color:#fff'
      ]);
      badge.textContent = LEVEL_SYMBOL[check.level] || '✓';

      const label = el('span', 'font:13px/1.3 sans-serif; flex:1;');
      label.textContent = check.label;

      rowHead.append(badge, label);
      row.appendChild(rowHead);

      if (check.errors.length > 0) {
        const errList = el('ul', [
          'margin:0', 'padding:8px 14px 12px 42px',
          `border-top:1px solid ${c.border}`, 'list-style:disc'
        ]);
        for (const text of check.errors) {
          const li = el('li', `font:12px/1.6 monospace; color:${c.item}; margin-bottom:1px;`);
          li.textContent = text;
          errList.appendChild(li);
        }
        row.appendChild(errList);
      }

      body.appendChild(row);
    }
  }

  // ── Validation runner ───────────────────────────────────────────────────────

  function showResult(result, saveBlocked = false) {
    running = false;
    runBtn.disabled = false;
    runBtn.textContent = 'Run Validation';
    lastResult = result;
    copyBtn.disabled = !!result?.error;
    saveAnywayBtn.style.display = saveBlocked ? '' : 'none';
    body.innerHTML = '';
    if (saveBlocked) {
      const banner = el('div', [
        'padding:9px 14px', 'margin-bottom:14px', 'border-radius:6px',
        'background:rgba(239,68,68,0.14)', 'border:1px solid rgba(239,68,68,0.38)',
        'font:13px/1.4 sans-serif', 'color:#fca5a5'
      ]);
      banner.textContent = 'Save was blocked. Fix the errors below and save again.';
      body.appendChild(banner);
    }
    renderReport(result);
  }

  async function runValidation() {
    if (running) return;
    running = true;
    runBtn.disabled = true;
    runBtn.textContent = 'Validating…';

    body.innerHTML = '';
    const spinner = el('p', 'color:#8899bb; font:13px sans-serif; margin:0;');
    spinner.textContent = 'Running checks…';
    body.appendChild(spinner);

    let result;
    try {
      if (!window.electronAPI?.pluginTrigger) {
        throw new Error('electronAPI.pluginTrigger is not available');
      }
      result = await window.electronAPI.pluginTrigger('mdvalidate', 'validate', { slug, mdFile: '__builder_temp.md' });
    } catch (err) {
      result = { error: err.message };
    }

    showResult(result);
  }

  function handleKeyDown(e) {
    if (e.key !== 'Escape' || overlay.style.display === 'none') return;
    e.stopImmediatePropagation();
    onClose();
  }
  document.addEventListener('keydown', handleKeyDown, true);

  return { overlay, runValidation, showResult };
}

// ── Builder extension entry point ────────────────────────────────────────────

export function getBuilderExtensions(ctx = {}) {
  const host = ctx.host;
  if (!host) return [];

  const slug = String(ctx.slug || '');
  const mdFile = String(ctx.mdFile || 'presentation.md');

  let overlayEl = null;
  let overlayRunValidation = null;
  let overlayShowResult = null;

  function hideOverlay() {
    if (overlayEl) overlayEl.style.display = 'none';
    host.setPreviewButtonActive(BTN_ID, false);
  }

  function ensureOverlay() {
    if (!overlayEl) {
      const created = createValidatorOverlay({ host, slug, mdFile, onClose: hideOverlay });
      overlayEl = created.overlay;
      overlayRunValidation = created.runValidation;
      overlayShowResult = created.showResult;
      document.body.appendChild(overlayEl);
    } else {
      overlayEl.style.display = 'flex';
    }
    host.setPreviewButtonActive(BTN_ID, true);
  }

  function showOverlay(preloadedResult = null, saveBlocked = false) {
    ensureOverlay();
    if (preloadedResult) {
      overlayShowResult(preloadedResult, saveBlocked);
    } else {
      overlayRunValidation();
    }
  }

  if (typeof host.registerSaveGuard === 'function') {
    host.registerSaveGuard(async () => {
      let result;
      try {
        if (!window.electronAPI?.pluginTrigger) return true;
        result = await window.electronAPI.pluginTrigger(
          'mdvalidate', 'validate', { slug, mdFile: '__builder_temp.md' }
        );
      } catch {
        return true;
      }
      if (!result || result.error) return true;
      if (result.summary?.failed > 0) {
        showOverlay(result, true);
        return false;
      }
      return true;
    });
  }

  host.registerPreviewButton({
    id: BTN_ID,
    location: 'preview-header',
    title: '✓ Validate',
    tooltip: 'Validate presentation markdown',
    onClick({ isActive, setActive }) {
      if (isActive()) {
        hideOverlay();
      } else {
        showOverlay();
      }
    }
  });

  return [];
}
