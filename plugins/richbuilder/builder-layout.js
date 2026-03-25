/**
 * builder-layout.js — Slide Layout State and Directive Handling
 *
 * Two responsibilities:
 *
 * 1. Layout presets — the seven named content arrangements (Standard, Upper
 *    Third, Info, etc.) stored as data attributes on the editor element.
 *    Provides normalisation, preset lookup, SVG icon generation, and toolbar
 *    sync so the Layout ▾ menu always reflects the active preset.
 *
 * 2. Markdown directives — `:info:`, `:upperthird:`, `:shiftleft:`, etc. are
 *    REVELation-specific tokens that sit in the slide body but must be kept
 *    invisible in the rich editor.  `parseLayoutDirectives` strips them before
 *    display; `mergeLayoutDirectivesWithBody` reattaches them on save.
 *    `extractHiddenDirectiveLines` / `restoreHiddenDirectiveLines` do the same
 *    for arbitrary `:macro:` block directives that must survive round-trips.
 */

import { escapeHtml, escapeAttribute } from './builder-utils.js';

/** Allowed values for the layout mode data attribute. */
export const RICH_LAYOUT_MODE_VALUES = new Set(['standard', 'info', 'infofull']);

/** Allowed values for the layout vertical alignment data attribute. */
export const RICH_LAYOUT_VERTICAL_VALUES = new Set(['center', 'upperthird', 'lowerthird']);

/** Allowed values for the layout horizontal shift data attribute. */
export const RICH_LAYOUT_SHIFT_VALUES = new Set(['none', 'shiftleft', 'shiftright']);

/** Named layout preset definitions used to populate the Layout menu. */
export const RICH_LAYOUT_PRESETS = [
  {
    id: 'standard',
    label: 'Standard',
    layout: { mode: 'standard', vertical: 'center', shift: 'none' },
    icon: { x: 'center', y: 'center' }
  },
  {
    id: 'upperthird',
    label: 'Upper Third',
    layout: { mode: 'standard', vertical: 'upperthird', shift: 'none' },
    icon: { x: 'center', y: 'top' }
  },
  {
    id: 'lowerthird',
    label: 'Lower Third',
    layout: { mode: 'standard', vertical: 'lowerthird', shift: 'none' },
    icon: { x: 'center', y: 'bottom' }
  },
  {
    id: 'shiftleft',
    label: 'Shift Left',
    layout: { mode: 'standard', vertical: 'center', shift: 'shiftleft' },
    icon: { x: 'left', y: 'center' }
  },
  {
    id: 'shiftright',
    label: 'Shift Right',
    layout: { mode: 'standard', vertical: 'center', shift: 'shiftright' },
    icon: { x: 'right', y: 'center' }
  },
  {
    id: 'info',
    label: 'Info',
    layout: { mode: 'info', vertical: 'center', shift: 'none' },
    icon: { x: 'left', y: 'top', panel: 'split' }
  },
  {
    id: 'infofull',
    label: 'Info Full',
    layout: { mode: 'infofull', vertical: 'center', shift: 'none' },
    icon: { x: 'left', y: 'top', panel: 'full' }
  }
];

/**
 * normalizeLayoutMode — Coerce a raw value to a valid layout mode string.
 *
 * Returns the lowercase trimmed value if it is in RICH_LAYOUT_MODE_VALUES,
 * otherwise falls back to `'standard'`.
 */
export function normalizeLayoutMode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return RICH_LAYOUT_MODE_VALUES.has(normalized) ? normalized : 'standard';
}

/**
 * normalizeLayoutVertical — Coerce a raw value to a valid vertical alignment.
 *
 * Returns the lowercase trimmed value if it is in RICH_LAYOUT_VERTICAL_VALUES,
 * otherwise falls back to `'center'`.
 */
export function normalizeLayoutVertical(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return RICH_LAYOUT_VERTICAL_VALUES.has(normalized) ? normalized : 'center';
}

/**
 * normalizeLayoutShift — Coerce a raw value to a valid horizontal shift.
 *
 * Returns the lowercase trimmed value if it is in RICH_LAYOUT_SHIFT_VALUES,
 * otherwise falls back to `'none'`.
 */
export function normalizeLayoutShift(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return RICH_LAYOUT_SHIFT_VALUES.has(normalized) ? normalized : 'none';
}

/**
 * getEditorLayoutState — Read the current layout state from data attributes.
 *
 * Returns `{ mode, vertical, shift }` reflecting what is currently stored on
 * the editor element's dataset.  All values are normalised through the
 * corresponding normalize* helpers.
 */
export function getEditorLayoutState(editorEl) {
  return {
    mode: normalizeLayoutMode(editorEl?.dataset?.layoutMode),
    vertical: normalizeLayoutVertical(editorEl?.dataset?.layoutVertical),
    shift: normalizeLayoutShift(editorEl?.dataset?.layoutShift)
  };
}

/**
 * isSameLayoutState — Deep-equal two layout state objects.
 *
 * Normalises both sides before comparing so that raw (possibly denormalised)
 * state objects from different sources can be reliably compared.
 */
export function isSameLayoutState(left = {}, right = {}) {
  return (
    normalizeLayoutMode(left.mode) === normalizeLayoutMode(right.mode) &&
    normalizeLayoutVertical(left.vertical) === normalizeLayoutVertical(right.vertical) &&
    normalizeLayoutShift(left.shift) === normalizeLayoutShift(right.shift)
  );
}

/**
 * getLayoutPresetForState — Find the named preset that matches a layout state.
 *
 * Returns the matching entry from RICH_LAYOUT_PRESETS or `null` if no preset
 * matches (i.e., the state is a custom combination).
 */
export function getLayoutPresetForState(layoutState = {}) {
  const normalized = {
    mode: normalizeLayoutMode(layoutState.mode),
    vertical: normalizeLayoutVertical(layoutState.vertical),
    shift: normalizeLayoutShift(layoutState.shift)
  };
  return RICH_LAYOUT_PRESETS.find((preset) => isSameLayoutState(preset.layout, normalized)) || null;
}

/**
 * buildLayoutIconSvg — Generate an SVG thumbnail for a layout preset tile.
 *
 * Produces a small slide-shaped icon with text-line indicators positioned
 * according to the `icon` descriptor (`x`, `y`, `panel`).  Used by
 * `renderLayoutPresetMenu` to give each tile a visual preview.
 */
export function buildLayoutIconSvg(icon = {}) {
  const x = icon.x === 'left' ? 14 : icon.x === 'right' ? 54 : 34;
  const yBase = icon.y === 'top' ? 5 : icon.y === 'bottom' ? 21 : 13;
  const bodyWidth = icon.x === 'center' ? 30 : 24;
  const secondWidth = Math.max(14, bodyWidth - 6);
  const thirdWidth = Math.max(10, secondWidth - 4);
  const headRect = icon.panel === 'split'
    ? '<rect x="8" y="6" width="52" height="8" rx="2" fill="rgba(124,158,214,0.35)"></rect>'
    : '';
  const fullRect = icon.panel === 'full'
    ? '<rect x="8" y="6" width="52" height="26" rx="2" fill="rgba(124,158,214,0.2)"></rect>'
    : '';
  const firstX = Math.max(8, Math.min(60 - bodyWidth, x - Math.floor(bodyWidth / 2)));
  const secondX = Math.max(8, Math.min(60 - secondWidth, x - Math.floor(secondWidth / 2)));
  const thirdX = Math.max(8, Math.min(60 - thirdWidth, x - Math.floor(thirdWidth / 2)));

  return `
    <svg class="richbuilder-layout-icon" viewBox="0 0 68 40" aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="66" height="38" rx="5" fill="#111925" stroke="#4f5f7a"></rect>
      ${fullRect}
      ${headRect}
      <rect x="${firstX}" y="${yBase}" width="${bodyWidth}" height="3" rx="1.5" fill="#d9e6ff"></rect>
      <rect x="${secondX}" y="${yBase + 6}" width="${secondWidth}" height="3" rx="1.5" fill="#d9e6ff"></rect>
      <rect x="${thirdX}" y="${yBase + 12}" width="${thirdWidth}" height="3" rx="1.5" fill="#d9e6ff"></rect>
    </svg>
  `.trim();
}

/**
 * renderLayoutPresetMenu — Populate the Layout dropdown menu with preset tiles.
 *
 * Builds the grid of clickable layout tiles from RICH_LAYOUT_PRESETS and sets
 * them as the innerHTML of `menuEl`.  Each tile carries a `data-layout-preset`
 * attribute so the toolbar click handler can identify which preset was chosen.
 */
export function renderLayoutPresetMenu(menuEl) {
  if (!menuEl) return;
  const gridItems = RICH_LAYOUT_PRESETS.map((preset) => {
    const icon = buildLayoutIconSvg(preset.icon);
    return `
      <button type="button" class="richbuilder-layout-tile" data-role="layout-preset" data-layout-preset="${escapeAttribute(preset.id)}" data-active="false">
        ${icon}
        <span>${escapeHtml(preset.label)}</span>
      </button>
    `;
  }).join('');
  menuEl.innerHTML = `<div class="richbuilder-layout-grid">${gridItems}</div>`;
}

/**
 * syncLayoutPresetUI — Update the Layout button label and tile active states.
 *
 * Called after any layout state change to keep the toolbar button text and
 * the preset tiles' `data-active` attributes in sync with the current state.
 */
export function syncLayoutPresetUI(controls, layoutState = {}) {
  if (!controls) return;
  const preset = getLayoutPresetForState(layoutState);
  const label = preset ? preset.label : 'Custom';
  if (controls.button) {
    controls.button.textContent = `${label} ▾`;
    controls.button.setAttribute('aria-label', `Layout: ${label}`);
  }
  if (controls.menu) {
    controls.menu.querySelectorAll('[data-role="layout-preset"]').forEach((button) => {
      const id = String(button.getAttribute('data-layout-preset') || '');
      button.dataset.active = String(!!preset && id === preset.id);
    });
  }
}

/**
 * applyEditorLayoutState — Write a new layout state onto the editor element.
 *
 * Merges `nextState` with the existing state (partial updates are allowed),
 * writes the resolved values to the editor's dataset, and syncs the toolbar
 * UI.  Returns the resolved state object.
 */
export function applyEditorLayoutState(editorEl, nextState = {}, controls = null) {
  if (!editorEl) return getEditorLayoutState(editorEl);
  const current = getEditorLayoutState(editorEl);
  const resolved = {
    mode: normalizeLayoutMode(nextState.mode ?? current.mode),
    vertical: normalizeLayoutVertical(nextState.vertical ?? current.vertical),
    shift: normalizeLayoutShift(nextState.shift ?? current.shift)
  };
  editorEl.dataset.layoutMode = resolved.mode;
  editorEl.dataset.layoutVertical = resolved.vertical;
  editorEl.dataset.layoutShift = resolved.shift;
  syncLayoutPresetUI(controls, resolved);
  return resolved;
}

/**
 * parseLayoutDirectives — Strip layout directive tokens from slide markdown.
 *
 * Scans the raw markdown for lines like `:info:`, `:upperthird:`, etc.,
 * removes them from the body, and returns `{ body, layout }` where `layout`
 * is a state object ready for `applyEditorLayoutState`.
 */
export function parseLayoutDirectives(markdown) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const layout = { mode: 'standard', vertical: 'center', shift: 'none' };
  const bodyLines = [];

  lines.forEach((line) => {
    const token = String(line || '').trim().toLowerCase();
    if (token === ':info:') {
      layout.mode = 'info';
      return;
    }
    if (token === ':infofull:') {
      layout.mode = 'infofull';
      return;
    }
    if (token === ':upperthird:') {
      layout.vertical = 'upperthird';
      return;
    }
    if (token === ':lowerthird:') {
      layout.vertical = 'lowerthird';
      return;
    }
    if (token === ':shiftleft:') {
      layout.shift = 'shiftleft';
      return;
    }
    if (token === ':shiftright:') {
      layout.shift = 'shiftright';
      return;
    }
    bodyLines.push(line);
  });

  const body = bodyLines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');

  return { body, layout };
}

/**
 * composeLayoutDirectives — Build the directive lines for a layout state.
 *
 * Returns an array of directive strings (e.g. `[':info:', ':upperthird:']`)
 * for all non-default values in `layoutState`.  Used by
 * `mergeLayoutDirectivesWithBody` to prepend directives to the saved markdown.
 */
export function composeLayoutDirectives(layoutState = {}) {
  const mode = normalizeLayoutMode(layoutState.mode);
  const vertical = normalizeLayoutVertical(layoutState.vertical);
  const shift = normalizeLayoutShift(layoutState.shift);
  const directives = [];
  if (mode === 'info') directives.push(':info:');
  if (mode === 'infofull') directives.push(':infofull:');
  if (vertical === 'upperthird') directives.push(':upperthird:');
  if (vertical === 'lowerthird') directives.push(':lowerthird:');
  if (shift === 'shiftleft') directives.push(':shiftleft:');
  if (shift === 'shiftright') directives.push(':shiftright:');
  return directives;
}

/**
 * mergeLayoutDirectivesWithBody — Combine layout directives with body markdown.
 *
 * Prepends the directive lines returned by `composeLayoutDirectives` to the
 * markdown body, separated by a blank line, producing the full slide markdown
 * that will be written back to the textarea.
 */
export function mergeLayoutDirectivesWithBody(layoutState = {}, markdownBody = '') {
  const directives = composeLayoutDirectives(layoutState);
  const body = String(markdownBody || '').replace(/^\n+/, '').replace(/\n+$/, '');
  if (!directives.length) return body;
  if (!body) return directives.join('\n');
  return `${directives.join('\n')}\n\n${body}`;
}

/**
 * isHiddenDirectiveLine — Return true if a line looks like a directive token.
 *
 * A directive line is any line that starts with optional whitespace followed
 * by a colon.  Used to identify lines that should be hidden from the rich
 * editor but preserved in the saved markdown.
 */
export function isHiddenDirectiveLine(line) {
  return /^\s*:/.test(String(line || ''));
}

/**
 * isBlockMacroHeaderLine — Return true if a line is a block-macro header.
 *
 * Block macros look like `:macro-name:` (colon, identifier, colon) and may
 * have indented body lines beneath them.  This function identifies the header
 * line so `extractHiddenDirectiveLines` can also capture the body.
 */
export function isBlockMacroHeaderLine(line) {
  return /^\s*:[A-Za-z0-9_-]+:\s*$/.test(String(line || ''));
}

/**
 * extractHiddenDirectiveLines — Separate directives from visible body lines.
 *
 * Walks the markdown body, removes all directive lines (and their block-macro
 * bodies) into a `hiddenDirectives` array that records the insertion position
 * as `beforeLine`.  Returns `{ visibleBody, hiddenDirectives }` so the editor
 * only sees non-directive content.
 */
export function extractHiddenDirectiveLines(markdownBody) {
  const sourceLines = String(markdownBody || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const visibleLines = [];
  const hiddenDirectives = [];
  let index = 0;

  while (index < sourceLines.length) {
    const line = sourceLines[index];
    if (isHiddenDirectiveLine(line)) {
      hiddenDirectives.push({
        beforeLine: visibleLines.length,
        line
      });
      if (isBlockMacroHeaderLine(line)) {
        const baseIndent = (line.match(/^(\s*)/) || ['', ''])[1].length;
        index += 1;
        while (index < sourceLines.length) {
          const nextLine = sourceLines[index];
          if (!nextLine.trim()) {
            hiddenDirectives.push({
              beforeLine: visibleLines.length,
              line: nextLine
            });
            index += 1;
            continue;
          }
          const nextIndent = (nextLine.match(/^(\s*)/) || ['', ''])[1].length;
          if (nextIndent <= baseIndent) break;
          hiddenDirectives.push({
            beforeLine: visibleLines.length,
            line: nextLine
          });
          index += 1;
        }
        continue;
      }
      index += 1;
      continue;
    }
    visibleLines.push(line);
    index += 1;
  }

  return {
    visibleBody: visibleLines.join('\n'),
    hiddenDirectives
  };
}

/**
 * restoreHiddenDirectiveLines — Re-insert directive lines into saved markdown.
 *
 * The inverse of `extractHiddenDirectiveLines`.  Re-inserts the entries from
 * `hiddenDirectives` at the line positions they were originally found, so the
 * saved markdown is byte-for-byte equivalent to the original except for any
 * changes the user made to the visible body.
 */
export function restoreHiddenDirectiveLines(markdownBody, hiddenDirectives = []) {
  const baseLines = String(markdownBody || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (!hiddenDirectives.length) {
    return baseLines.join('\n');
  }

  const sorted = hiddenDirectives
    .map((entry, index) => ({
      beforeLine: Number.isFinite(entry?.beforeLine) ? Number(entry.beforeLine) : 0,
      line: String(entry?.line || ''),
      index
    }))
    .sort((a, b) => {
      if (a.beforeLine !== b.beforeLine) return a.beforeLine - b.beforeLine;
      return a.index - b.index;
    });

  const lines = [...baseLines];
  let offset = 0;
  sorted.forEach((entry) => {
    const clampedIndex = Math.max(0, Math.min(lines.length, entry.beforeLine + offset));
    lines.splice(clampedIndex, 0, entry.line);
    offset += 1;
  });

  return lines.join('\n');
}
