import { preprocessMarkdown } from './markdown-preprocessor.js';

const SONGSELECT_TERMS_LINE = /^For use solely with the SongSelect(?:®)? Terms of Use\.?\s+All rights reserved\.\s+www\.ccli\.com\s*$/i;
const SONGSELECT_LICENSE_LINE = /^CCLI License\s*#\s*([A-Za-z0-9-]+)\s*$/i;
const SONGSELECT_CCLI_SONG_LINE = /^CCLI Song\s*#\s*([0-9]+)\s*$/i;
const SONGSELECT_COPYRIGHT_LINE = /^©\s*([0-9]{4})\s+(.+)$/;
const BROWSER_CCLI_STORAGE_KEY = 'revelation.credit_ccli.browserLicenseNumber';

function readBrowserCcliNumber() {
  try {
    return String(window.localStorage?.getItem(BROWSER_CCLI_STORAGE_KEY) || '').trim();
  } catch (err) {
    console.warn('[credit_ccli] Failed to read browser CCLI number:', err);
    return '';
  }
}

function writeBrowserCcliNumber(value) {
  try {
    const normalized = String(value || '').trim();
    if (normalized) {
      window.localStorage?.setItem(BROWSER_CCLI_STORAGE_KEY, normalized);
    } else {
      window.localStorage?.removeItem(BROWSER_CCLI_STORAGE_KEY);
    }
    return true;
  } catch (err) {
    console.warn('[credit_ccli] Failed to persist browser CCLI number:', err);
    return false;
  }
}

function escapeHTML(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function ensureBrowserCcliLink(openModal) {
  if (window.electronAPI) return;
  if (document.getElementById('credit-ccli-browser-link')) return;

  const optionsDropdown = document.getElementById('options-dropdown');
  if (!optionsDropdown) return;

  const wrapper = document.createElement('div');
  wrapper.id = 'credit-ccli-browser-link';
  wrapper.style.marginTop = '.5rem';
  wrapper.innerHTML = `
    <button
      type="button"
      style="width:100%;background:#5a3c0b;color:#fff;border:none;border-radius:4px;padding:.4rem .8rem;cursor:pointer;font-weight:600;"
    >
      ${escapeHTML(tr('Set Browser CCLI License'))}
    </button>
    <div id="credit-ccli-browser-current" style="margin-top:.35rem;font-size:.85rem;color:#d6d6d6;"></div>
  `;

  const button = wrapper.querySelector('button');
  const current = wrapper.querySelector('#credit-ccli-browser-current');
  const renderValue = () => {
    const value = readBrowserCcliNumber();
    current.textContent = value
      ? `${tr('Current CCLI')}: ${value}`
      : tr('No browser CCLI license saved.');
  };

  button.addEventListener('click', () => {
    openModal({
      afterSave: renderValue
    });
  });
  renderValue();
  optionsDropdown.appendChild(wrapper);
}

function openBrowserCcliModal({ afterSave = null, reloadOnSave = false } = {}) {
  const existing = document.getElementById('credit-ccli-modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'credit-ccli-modal-overlay';
  overlay.style.cssText = [
    'position:fixed',
    'inset:0',
    'background:rgba(0,0,0,0.62)',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'padding:24px',
    'z-index:2147483647'
  ].join(';');

  const currentValue = readBrowserCcliNumber();
  overlay.innerHTML = `
    <div role="dialog" aria-modal="true" aria-labelledby="credit-ccli-modal-title" style="width:min(92vw, 460px);background:#161616;color:#fff;border:1px solid #454545;border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.45);padding:20px;">
      <div id="credit-ccli-modal-title" style="font:600 1.05rem/1.3 sans-serif;margin-bottom:10px;">${escapeHTML(tr('Set Browser CCLI License'))}</div>
      <p style="margin:0 0 12px 0;font:14px/1.45 sans-serif;color:#d0d0d0;">
        ${escapeHTML(tr('Use a browser-stored fallback when desktop settings are unavailable.'))}
      </p>
      <label for="credit-ccli-modal-input" style="display:block;font:13px/1.3 sans-serif;margin-bottom:6px;color:#e6e6e6;">${escapeHTML(tr('CCLI License Number'))}</label>
      <input id="credit-ccli-modal-input" type="text" value="${escapeHTML(currentValue)}" placeholder="${escapeHTML(tr('Enter CCLI license number'))}" style="width:100%;box-sizing:border-box;padding:10px 12px;border-radius:8px;border:1px solid #555;background:#0d0d0d;color:#fff;font:14px/1.3 sans-serif;" />
      <div style="margin-top:8px;font:12px/1.35 sans-serif;color:#a8a8a8;">
        ${escapeHTML(tr('Saved in this browser only unless the URL already includes ?ccli=.'))}
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px;">
        <button type="button" id="credit-ccli-modal-clear" style="background:#3e2a2a;color:#fff;border:1px solid #6a4a4a;border-radius:8px;padding:9px 12px;cursor:pointer;">${escapeHTML(tr('Clear'))}</button>
        <button type="button" id="credit-ccli-modal-cancel" style="background:#242424;color:#fff;border:1px solid #555;border-radius:8px;padding:9px 12px;cursor:pointer;">${escapeHTML(tr('Cancel'))}</button>
        <button type="button" id="credit-ccli-modal-save" style="background:#0d6a2a;color:#fff;border:1px solid #15933c;border-radius:8px;padding:9px 14px;cursor:pointer;font-weight:600;">${escapeHTML(tr('Save'))}</button>
      </div>
    </div>
  `;

  const close = () => overlay.remove();
  const input = overlay.querySelector('#credit-ccli-modal-input');
  const clearBtn = overlay.querySelector('#credit-ccli-modal-clear');
  const cancelBtn = overlay.querySelector('#credit-ccli-modal-cancel');
  const saveBtn = overlay.querySelector('#credit-ccli-modal-save');

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  cancelBtn.addEventListener('click', close);
  clearBtn.addEventListener('click', () => {
    input.value = '';
    input.focus();
  });
  saveBtn.addEventListener('click', () => {
    const ok = writeBrowserCcliNumber(input.value);
    if (!ok) {
      window.alert(tr('Unable to save the browser CCLI license in local storage.'));
      return;
    }
    close();
    if (typeof afterSave === 'function') afterSave(String(input.value || '').trim());
    if (reloadOnSave) {
      window.location.reload();
      return;
    }
    if (typeof window.showToast === 'function') {
      window.showToast(tr('Browser CCLI license updated.'));
    }
  });

  document.body.appendChild(overlay);
  input.focus();
  input.select();
}

function normalizeLines(text = '') {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[\t ]+$/g, ''));
}

function toSectionTitle(raw = '') {
  const source = String(raw || '').trim();
  if (!source) return '';
  return source
    .replace(/\s+/g, ' ')
    .replace(/^(verse|chorus|bridge|pre-chorus|ending|tag|refrain|intro|outro)\b/i, (match) => {
      const lowered = match.toLowerCase();
      return lowered.charAt(0).toUpperCase() + lowered.slice(1);
    });
}

function looksLikeSectionHeading(line = '') {
  return /^(verse|chorus|bridge|pre-chorus|ending|tag|refrain|intro|outro)\b/i.test(String(line || '').trim());
}

function parseSongSelectSpecialPaste(clipboardText = '') {
  const lines = normalizeLines(clipboardText);
  if (!lines.length) return null;

  const nonEmptyLineIndexes = lines
    .map((line, index) => ({ line: String(line || '').trim(), index }))
    .filter(({ line }) => line.length > 0);
  if (nonEmptyLineIndexes.length < 2) return null;

  const finalLine = nonEmptyLineIndexes[nonEmptyLineIndexes.length - 1];
  const penultimateLine = nonEmptyLineIndexes[nonEmptyLineIndexes.length - 2];
  if (!SONGSELECT_TERMS_LINE.test(penultimateLine.line)) return null;
  if (!SONGSELECT_LICENSE_LINE.test(finalLine.line)) return null;
  const lastTermsIndex = penultimateLine.index;

  const contentLines = lines.slice(0, lastTermsIndex).map((line) => String(line || '').trimEnd());
  while (contentLines.length && !contentLines[contentLines.length - 1].trim()) {
    contentLines.pop();
  }
  if (!contentLines.length) return null;

  const title = String(contentLines[0] || '').trim();
  if (!title) return null;

  const creditsMeta = {
    words: '',
    year: '',
    copyright: '',
    cclisong: ''
  };

  let metaStart = contentLines.length;
  for (let i = contentLines.length - 1; i >= 0; i -= 1) {
    const line = String(contentLines[i] || '').trim();
    if (!line) {
      if (metaStart < contentLines.length) {
        break;
      }
      continue;
    }

    const songMatch = line.match(SONGSELECT_CCLI_SONG_LINE);
    if (songMatch) {
      creditsMeta.cclisong = songMatch[1];
      metaStart = i;
      continue;
    }

    const copyrightMatch = line.match(SONGSELECT_COPYRIGHT_LINE);
    if (copyrightMatch) {
      creditsMeta.year = copyrightMatch[1];
      creditsMeta.copyright = copyrightMatch[2].trim();
      metaStart = i;
      continue;
    }

    if (!creditsMeta.words) {
      creditsMeta.words = line;
      metaStart = i;
      continue;
    }

    break;
  }

  const lyricLines = contentLines.slice(1, metaStart).map((line) => line.trim());
  while (lyricLines.length && !lyricLines[0]) lyricLines.shift();
  while (lyricLines.length && !lyricLines[lyricLines.length - 1]) lyricLines.pop();
  if (!lyricLines.length) return null;

  const sections = [];
  let current = null;

  const pushCurrent = () => {
    if (!current) return;
    const filteredLines = current.lines
      .map((line) => line.trim())
      .filter(Boolean);
    if (!filteredLines.length) {
      current = null;
      return;
    }
    sections.push({ title: current.title, lines: filteredLines });
    current = null;
  };

  lyricLines.forEach((line) => {
    if (!line) return;
    if (looksLikeSectionHeading(line)) {
      pushCurrent();
      current = { title: toSectionTitle(line), lines: [] };
      return;
    }
    if (!current) {
      current = { title: '', lines: [] };
    }
    current.lines.push(line);
  });
  pushCurrent();

  if (!sections.length) return null;

  return {
    title,
    credits: creditsMeta,
    sections
  };
}

function renderSongSelectSmartPaste(song = null) {
  if (!song || !song.title || !Array.isArray(song.sections) || !song.sections.length) {
    return '';
  }

  const out = [];
  out.push(`## ${song.title}`);
  out.push(':credits:');
  if (song.credits.words) out.push(`  words: ${song.credits.words}`);
  if (song.credits.year) out.push(`  year: ${song.credits.year}`);
  if (song.credits.copyright) out.push(`  copyright: ${song.credits.copyright}`);
  if (song.credits.cclisong) out.push(`  cclisong: ${song.credits.cclisong}`);
  out.push('  license: ccli');

  song.sections.forEach((section) => {
    out.push('');
    out.push('---');
    out.push('');
    if (section.title) {
      out.push(`_${section.title}_  `);
    }
    out.push(...section.lines.map((line) => `${line}  `));
  });

  return out.join('\n').trim();
}

window.RevelationPlugins.credit_ccli = {
  name: 'credit_ccli',
  context: null,
  preprocessMarkdown,

  init(context) {
    this.context = context;
    if (String(context?.page || '').trim().toLowerCase() === 'presentationlist') {
      ensureBrowserCcliLink((options) => openBrowserCcliModal(options));
    }
  },

  onBuilderSmartPaste(payload = {}) {
    const song = parseSongSelectSpecialPaste(payload.clipboardText || '');
    if (!song) {
      return { continueDefault: true };
    }
    const transformed = renderSongSelectSmartPaste(song);
    if (!transformed) {
      return { continueDefault: true };
    }
    return {
      text: transformed,
      continueDefault: false
    };
  },

  getListMenuItems() {
    if (window.electronAPI) return [];
    return [
      {
        label: '🎵 ' + tr('Set Browser CCLI License'),
        action: () => openBrowserCcliModal()
      }
    ];
  },

  getPresentationMenuItems() {
    if (window.electronAPI) return [];
    return [
      {
        label: '🎵 ' + tr('Set Browser CCLI License'),
        action: () => openBrowserCcliModal({ reloadOnSave: true })
      }
    ];
  }
};
