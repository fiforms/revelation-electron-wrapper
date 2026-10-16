// plugins/mathjax/builder.js  (browser, builder only; lazy-imported by client.js)
// The Math Formula dialog for the `:mathjax:` block. openMathDialog() is shared by two callers in
// client.js:
//   - getBlockTools "Math Formula…" (Rich Builder Animation menu): inserts a new block via
//     ctx.appendToSlideEnd (display) or ctx.appendToCurrentLine (inline).
//   - onRichMacroEdit: edits an existing `:mathjax:` card through payload.setRaw / remove.
// The user types TeX, sees a live preview, and picks display or inline. The preview uses the same
// bundled MathJax 4 as the presentation (mathjax-loader.js), so it works offline and matches the
// slide. Block text is read and written by mathjax-block.js (needs window.jsyaml from builder.html).
// All text goes into the DOM through .value / textContent, never innerHTML.
import { loadMathJax, typesetFormulas } from './mathjax-loader.js';
import { parseMathjaxBlock, buildMathjaxBlock, MATHJAX_EXAMPLES, MATHJAX_CHEATSHEET } from './mathjax-block.js';

const OVERLAY_ID = 'mathjax-formula-overlay';
const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

const styles = {
  field: 'display:flex;flex-direction:column;gap:4px;color:#c4ccda;',
  control: 'border:1px solid #303545;background:#0f1115;color:#e6e6e6;border-radius:6px;padding:6px 8px;font-size:12px;',
  button: 'border:1px solid #303545;background:#1f232d;color:#e6e6e6;border-radius:6px;padding:8px 12px;font-size:12px;cursor:pointer;',
  primary: 'background:#3b82f6;border-color:#3b82f6;color:#fff;font-weight:600;',
  chip: 'border:1px solid #303545;background:#1f232d;color:#c4ccda;border-radius:999px;padding:3px 9px;font-size:11px;cursor:pointer;'
};

// Show the dialog. `initial` is { values, extras, indent } from parseMathjaxBlock, or null for a
// new block. Resolves { action: 'apply', block, display } | { action: 'remove' } | { action: 'cancel' }.
export function openMathDialog(baseURL, initial = null) {
  document.getElementById(OVERLAY_ID)?.remove();
  const editing = !!initial;
  const values = initial?.values || { formula: '', display: 'block' };

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(7,10,16,.72);z-index:20000;display:flex;align-items:center;justify-content:center;padding:20px;';

    const dialog = document.createElement('form');
    dialog.style.cssText = 'width:min(620px,94vw);max-height:92vh;overflow:auto;background:#161a24;color:#e6e6e6;border:1px solid #303545;border-radius:12px;padding:16px 16px 12px;box-shadow:0 14px 34px rgba(0,0,0,.45);font:13px/1.4 sans-serif;';

    const title = document.createElement('h3');
    title.style.margin = '0 0 12px';
    title.textContent = editing ? tr('Edit Math Formula') : tr('Math Formula');

    const modeLabel = document.createElement('label');
    modeLabel.style.cssText = `${styles.field}margin-bottom:10px;`;
    modeLabel.append(tr('Show as'));
    const modeSelect = document.createElement('select');
    modeSelect.style.cssText = styles.control;
    [['block', tr('Display (centered, on its own line)')], ['inline', tr('Inline (within the current line of text)')]]
      .forEach(([value, text]) => modeSelect.append(new Option(text, value)));
    modeSelect.value = values.display;
    modeLabel.append(modeSelect);

    const texLabel = document.createElement('label');
    texLabel.style.cssText = `${styles.field}margin-bottom:10px;`;
    texLabel.append(tr('Formula (TeX code)'));
    const texInput = document.createElement('textarea');
    texInput.rows = 3;
    texInput.spellcheck = false;
    texInput.placeholder = 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}';
    texInput.style.cssText = `${styles.control}font-family:monospace;font-size:13px;resize:vertical;`;
    texInput.value = values.formula;
    texLabel.append(texInput);

    // Preview header: label on the left, zoom buttons on the right. The zoom scales the preview's
    // font-size (MathJax's SVG is sized in ex units), and is kept while the formula changes.
    const previewHeader = document.createElement('div');
    previewHeader.style.cssText = 'display:flex;align-items:center;gap:6px;color:#c4ccda;margin-bottom:4px;';
    const previewLabel = document.createElement('span');
    previewLabel.style.marginRight = 'auto';
    previewLabel.textContent = tr('Preview');
    const zoomOut = document.createElement('button');
    const zoomIn = document.createElement('button');
    const zoomReset = document.createElement('button');
    [[zoomOut, '−', tr('Zoom out')], [zoomIn, '+', tr('Zoom in')], [zoomReset, '', tr('Reset zoom')]].forEach(([btn, text, label]) => {
      btn.type = 'button';
      btn.title = label;
      btn.setAttribute('aria-label', label);
      btn.style.cssText = `${styles.button}padding:2px 9px;line-height:1.2;`;
      btn.textContent = text;
    });
    zoomReset.style.minWidth = '52px';
    previewHeader.append(previewLabel, zoomOut, zoomReset, zoomIn);
    const preview = document.createElement('div');
    preview.style.cssText = 'min-height:64px;margin-bottom:12px;padding:12px;border:1px solid #303545;border-radius:8px;background:#fff;color:#111;display:flex;align-items:center;justify-content:center;overflow:auto;';
    let zoomIndex = ZOOM_STEPS.indexOf(1);
    let previewIsMessage = false;
    const applyZoom = () => {
      const zoom = ZOOM_STEPS[zoomIndex];
      preview.style.fontSize = previewIsMessage ? '12px' : `${1.3 * zoom}em`;
      zoomReset.textContent = `${Math.round(zoom * 100)}%`;
      zoomOut.disabled = zoomIndex === 0;
      zoomIn.disabled = zoomIndex === ZOOM_STEPS.length - 1;
    };
    const stepZoom = (delta) => {
      zoomIndex = Math.max(0, Math.min(ZOOM_STEPS.length - 1, zoomIndex + delta));
      applyZoom();
    };
    zoomOut.addEventListener('click', () => stepZoom(-1));
    zoomIn.addEventListener('click', () => stepZoom(1));
    zoomReset.addEventListener('click', () => {
      zoomIndex = ZOOM_STEPS.indexOf(1);
      applyZoom();
    });
    applyZoom();
    const previewNote = document.createElement('div');
    previewNote.style.cssText = 'min-height:16px;margin:-8px 0 10px;font-size:11px;color:#f2a1a1;';

    const examplesLabel = document.createElement('div');
    examplesLabel.style.cssText = 'color:#c4ccda;margin-bottom:4px;';
    examplesLabel.textContent = tr('Examples (click to use)');
    const examples = document.createElement('div');
    examples.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;';
    MATHJAX_EXAMPLES.forEach((example) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.style.cssText = styles.chip;
      chip.textContent = tr(example.label);
      chip.addEventListener('click', () => {
        texInput.value = example.formula;
        modeSelect.value = example.display;
        updatePreview();
        texInput.focus();
      });
      examples.append(chip);
    });

    const cheat = document.createElement('details');
    cheat.style.cssText = 'margin-bottom:12px;';
    const cheatSummary = document.createElement('summary');
    cheatSummary.style.cssText = 'cursor:pointer;color:#c4ccda;';
    cheatSummary.textContent = tr('Code cheat sheet (click a code to add it)');
    const cheatGrid = document.createElement('div');
    cheatGrid.style.cssText = 'display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin-top:8px;align-items:baseline;';
    MATHJAX_CHEATSHEET.forEach(([code, description]) => {
      const codeBtn = document.createElement('button');
      codeBtn.type = 'button';
      codeBtn.style.cssText = `${styles.chip}font-family:monospace;text-align:left;border-radius:6px;`;
      codeBtn.textContent = code;
      codeBtn.addEventListener('click', () => {
        const { selectionStart: start, selectionEnd: end, value } = texInput;
        const before = value.slice(0, start);
        const glue = before && !/\s$/.test(before) ? ' ' : '';
        texInput.value = `${before}${glue}${code}${value.slice(end)}`;
        updatePreview();
        texInput.focus();
      });
      const text = document.createElement('span');
      text.style.color = '#9aa4b5';
      text.textContent = tr(description);
      cheatGrid.append(codeBtn, text);
    });
    cheat.append(cheatSummary, cheatGrid);

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;';
    if (editing) {
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.style.cssText = `${styles.button}margin-right:auto;`;
      removeBtn.textContent = tr('Remove Formula');
      removeBtn.addEventListener('click', () => close({ action: 'remove' }));
      actions.append(removeBtn);
    }
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.style.cssText = styles.button;
    cancelBtn.textContent = tr('Cancel');
    const applyBtn = document.createElement('button');
    applyBtn.type = 'submit';
    applyBtn.style.cssText = `${styles.button}${styles.primary}`;
    applyBtn.textContent = editing ? tr('Apply') : tr('Insert');
    actions.append(cancelBtn, applyBtn);

    dialog.append(title, modeLabel, texLabel, previewHeader, preview, previewNote, examplesLabel, examples, cheat, actions);

    // Latest-wins: a slow MathJax load must not overwrite a newer render.
    let renderToken = 0;
    function updatePreview() {
      const token = ++renderToken;
      const tex = texInput.value.trim().replace(/\s*\n\s*/g, ' ');
      preview.textContent = '';
      previewIsMessage = false;
      applyZoom();
      previewNote.textContent = '';
      if (!tex) return;
      loadMathJax(baseURL).then(async (mathjax) => {
        if (token !== renderToken) return;
        const formula = document.createElement('div');
        formula.className = `mathjax-formula mathjax-${modeSelect.value === 'inline' ? 'inline' : 'block'}`;
        formula.setAttribute('data-tex', tex);
        preview.replaceChildren(formula);
        await typesetFormulas(mathjax, formula);
        if (token !== renderToken) return;
        // MathJax draws bad TeX as an error box and records the message in data-mjx-error.
        previewNote.textContent = formula.querySelector('[data-mjx-error]')?.getAttribute('data-mjx-error') || '';
      }).catch(() => {
        if (token !== renderToken) return;
        preview.textContent = tr('Preview unavailable (MathJax failed to load). You can still insert the formula.');
        previewIsMessage = true;
        applyZoom();
      });
    }

    const close = (result) => {
      overlay.remove();
      resolve(result);
    };
    texInput.addEventListener('input', updatePreview);
    modeSelect.addEventListener('change', updatePreview);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close({ action: 'cancel' });
    });
    cancelBtn.addEventListener('click', () => close({ action: 'cancel' }));
    dialog.addEventListener('submit', (event) => {
      event.preventDefault();
      const block = buildMathjaxBlock(
        { formula: texInput.value, display: modeSelect.value },
        window.jsyaml,
        { extras: initial?.extras, indent: initial?.indent }
      );
      if (!block) {
        texInput.focus();
        return;
      }
      close({ action: 'apply', block, display: modeSelect.value });
    });

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    updatePreview();
    texInput.focus();
  });
}

// Animation-menu entry: ask for the formula, then insert it. Inline formulas go at the end of the
// caret's line; display formulas go on their own line at the end of the slide.
export async function insertMathFormula(ctx, baseURL) {
  if (!window.jsyaml) return;
  const result = await openMathDialog(baseURL);
  if (result.action !== 'apply') return;
  if (result.display === 'inline') ctx.appendToCurrentLine(result.block);
  else ctx.appendToSlideEnd(result.block);
}

// onRichMacroEdit handler for a `:mathjax:` card. Returns false when the block can't be parsed so
// the host falls back to its plain-text editor.
export async function editMathFormulaCard(payload, baseURL) {
  if (!window.jsyaml) return false;
  const initial = parseMathjaxBlock(payload.raw, window.jsyaml);
  if (!initial) return false;
  const result = await openMathDialog(baseURL, initial);
  if (result.action === 'apply') payload.setRaw(result.block);
  else if (result.action === 'remove') payload.remove();
  return true;
}
