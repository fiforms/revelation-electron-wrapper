// plugins/revealchart/block-dialog.js  (browser, builder only; lazy-imported by chart-builder.js
// and table-builder.js)
// Shared shell of the `:chart:` / `:table:` dialogs: the item list (one block may hold several
// items), the Guided / YAML tabs that edit the same item object, the optional live preview, and
// Apply / Remove / Cancel. A caller supplies only what differs: renderGuided(item, api) and, for
// charts, snippets and a preview. Block text is read and written by chart-block.js / table-block.js
// (need window.jsyaml from builder.html). Values go into the DOM through .value / textContent,
// never innerHTML.

export const CONTROL_STYLE = 'border:1px solid #303545;background:#0f1115;color:#e6e6e6;border-radius:6px;padding:6px 8px;font-size:12px;';
export const BUTTON_STYLE = 'border:1px solid #303545;background:#1f232d;color:#e6e6e6;border-radius:6px;padding:6px 10px;font-size:12px;cursor:pointer;';
const PRIMARY_STYLE = 'background:#3b82f6;border-color:#3b82f6;color:#fff;font-weight:600;';

// Small DOM helper: el('div', {style, text, ...props}, ...children).
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'text') node.textContent = value;
    else if (key === 'style') node.style.cssText = value;
    else node[key] = value;
  }
  node.append(...children);
  return node;
}

export const button = (text, onClick, extraStyle = '') => {
  const btn = el('button', { type: 'button', text, style: BUTTON_STYLE + extraStyle });
  btn.addEventListener('click', onClick);
  return btn;
};
export const field = (label, control, style = '') => el('label', { style: `display:flex;flex-direction:column;gap:4px;color:#c4ccda;${style}` }, label, control);
export const control = (tag, props = {}) => el(tag, { style: CONTROL_STYLE, ...props });

// Text input bound to item[key]: an empty value removes the key.
export function textBinding(item, key, api, placeholder = '') {
  const input = control('input', { type: 'text', value: item[key] ?? '', placeholder });
  input.addEventListener('input', () => {
    if (input.value.trim()) item[key] = input.value.trim(); else delete item[key];
    api.changed();
  });
  return input;
}

// Show the dialog. Options:
//   overlayId, tag (':chart:'), titleNew, titleEdit   (already translated)
//   initial       { items, ... } from the block parser, or null for a new block
//   meta          extra data handed back to buildBlock (shape, extras, indent)
//   defaultItem() a fresh item; itemLabel(item) text for the item list
//   renderGuided(item, api) -> array of nodes for the Guided tab; api = { changed(), setError(text) }
//   buildBlock(items, meta) -> block text
//   snippets      optional [{ id, label (translated), patch }] and deepMerge, docsUrl, docsLabel
//   preview       optional { height, render(item, box) -> Promise, destroy() }
// Resolves { action: 'apply', block } | { action: 'remove' } | { action: 'cancel' }.
export function openBlockDialog(opts) {
  const { overlayId, titleNew, titleEdit, initial, meta, defaultItem, itemLabel, renderGuided, buildBlock, snippets = [], deepMerge, docsUrl, docsLabel, preview, labels } = opts;
  document.getElementById(overlayId)?.remove();
  const yaml = window.jsyaml;
  const editing = !!initial;
  const items = (initial?.items.length ? initial.items : [defaultItem()]).map((i) => JSON.parse(JSON.stringify(i)));
  let cur = 0;
  let tab = 'guided';
  let previewTimer = null;

  return new Promise((resolve) => {
    const overlay = el('div', { id: overlayId, style: 'position:fixed;inset:0;background:rgba(7,10,16,.72);z-index:20000;display:flex;align-items:center;justify-content:center;padding:20px;' });
    const dialog = el('div', { style: 'width:min(760px,94vw);max-height:92vh;overflow:auto;background:#161a24;color:#e6e6e6;border:1px solid #303545;border-radius:12px;padding:16px 16px 12px;box-shadow:0 14px 34px rgba(0,0,0,.45);font:13px/1.4 sans-serif;' });
    const error = el('div', { style: 'color:#f87171;min-height:18px;margin:6px 0;' });
    const body = el('div');
    const itemSelect = control('select');
    const tabBar = el('div', { style: 'display:flex;gap:6px;margin:10px 0;' });
    const previewBox = preview ? el('div', { style: `position:relative;height:${preview.height}px;margin-top:10px;background:#fff;border-radius:6px;` }) : null;
    let yamlArea = null;

    const dumpItem = () => yaml.dump(items[cur], { lineWidth: -1, skipInvalid: true });

    // YAML tab -> item. Returns false (and shows the error) when the text is not valid YAML.
    const commitYaml = () => {
      if (!yamlArea) return true;
      try {
        const parsed = yaml.loadAll(yamlArea.value)[0];
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(tr('Each item must be a YAML mapping.'));
        items[cur] = parsed;
        error.textContent = '';
        return true;
      } catch (err) {
        error.textContent = String(err.reason || err.message || err);
        return false;
      }
    };

    const refreshItemSelect = () => {
      itemSelect.replaceChildren(...items.map((item, i) => el('option', { value: String(i), text: `${i + 1}: ${itemLabel(item)}` })));
      itemSelect.value = String(cur);
    };

    // Debounced redraw of the preview from the current item.
    const schedulePreview = () => {
      if (!preview) return;
      clearTimeout(previewTimer);
      previewTimer = setTimeout(() => preview.render(items[cur], previewBox), 250);
    };

    const api = {
      changed() { refreshItemSelect(); schedulePreview(); },
      setError(text) { error.textContent = text; }
    };

    const renderYaml = () => {
      yamlArea = control('textarea', { rows: 16, spellcheck: false, value: dumpItem(), style: `${CONTROL_STYLE}width:100%;box-sizing:border-box;font-family:monospace;` });
      yamlArea.addEventListener('input', () => { if (commitYaml()) schedulePreview(); });
      const bar = el('div', { style: 'display:flex;gap:10px;align-items:center;margin-bottom:6px;' });
      if (snippets.length) {
        const snippetSel = control('select');
        snippetSel.replaceChildren(el('option', { value: '', text: labels.snippets }), ...snippets.map((s) => el('option', { value: s.id, text: s.label })));
        snippetSel.addEventListener('change', () => {
          const snippet = snippets.find((s) => s.id === snippetSel.value);
          snippetSel.value = '';
          if (!snippet || !commitYaml()) return;
          deepMerge(items[cur], snippet.patch);
          yamlArea.value = dumpItem();
          api.changed();
        });
        bar.append(snippetSel);
      }
      if (docsUrl) bar.append(el('a', { href: docsUrl, target: '_blank', rel: 'noopener', text: docsLabel, style: 'color:#7fb0ff;' }));
      body.replaceChildren(...(bar.children.length ? [bar] : []), yamlArea);
    };

    const showTab = (name) => {
      if (tab === 'yaml' && name !== 'yaml' && !commitYaml()) return;
      if (tab === 'guided' && name === 'yaml') error.textContent = '';
      tab = name;
      yamlArea = null;
      if (name === 'yaml') renderYaml(); else body.replaceChildren(...renderGuided(items[cur], api));
      [...tabBar.children].forEach((b) => { b.style.cssText = BUTTON_STYLE + (b.dataset.tab === name ? PRIMARY_STYLE : ''); });
      api.changed();
    };

    for (const [name, label] of [['guided', tr('Guided')], ['yaml', tr('YAML')]]) {
      const b = button(label, () => showTab(name));
      b.dataset.tab = name;
      tabBar.append(b);
    }

    itemSelect.addEventListener('change', () => {
      const next = Number(itemSelect.value);
      if (!commitYaml()) { itemSelect.value = String(cur); return; }
      cur = next;
      showTab(tab);
    });

    const close = (result) => {
      clearTimeout(previewTimer);
      preview?.destroy();
      overlay.remove();
      resolve(result);
    };

    const itemBar = el('div', { style: 'display:flex;gap:6px;align-items:center;' },
      el('span', { text: labels.item, style: 'color:#c4ccda;' }), itemSelect,
      button(labels.add, () => { if (!commitYaml()) return; items.push(defaultItem()); cur = items.length - 1; showTab(tab); }),
      button(labels.remove, () => {
        if (items.length < 2) { error.textContent = labels.needOne; return; }
        items.splice(cur, 1); cur = Math.min(cur, items.length - 1); showTab(tab);
      }));

    const footer = el('div', { style: 'display:flex;justify-content:flex-end;gap:10px;margin-top:12px;' },
      ...(editing ? [button(labels.removeBlock, () => close({ action: 'remove' }), 'margin-right:auto;')] : []),
      button(tr('Cancel'), () => close({ action: 'cancel' })),
      button(editing ? tr('Apply') : tr('Insert'), () => {
        if (!commitYaml()) return;
        close({ action: 'apply', block: buildBlock(items, meta) });
      }, PRIMARY_STYLE));

    overlay.addEventListener('click', (event) => { if (event.target === overlay) close({ action: 'cancel' }); });
    dialog.append(el('h3', { text: editing ? titleEdit : titleNew, style: 'margin:0 0 10px;' }), itemBar, tabBar, body, error, ...(previewBox ? [previewBox] : []), footer);
    overlay.append(dialog);
    document.body.append(overlay);
    showTab('guided');
  });
}
