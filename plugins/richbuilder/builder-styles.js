/**
 * builder-styles.js — Rich Editor CSS Injection
 *
 * Injects the single <style> block that powers all richbuilder UI: the toolbar,
 * stage, editor canvas, layout tiles, list/table menus, two-column layout, and
 * table cell display.  Called once on first activation; subsequent calls are
 * no-ops guarded by a style-element id check.
 */

/**
 * ensureStyles — Inject richbuilder CSS into the document head.
 *
 * Inserts a single <style id="richbuilder-style"> element the first time it is
 * called.  All subsequent calls return immediately if that element already
 * exists, making this function safe to call multiple times.
 */
export function ensureStyles() {
  if (document.getElementById('richbuilder-style')) return;
  const style = document.createElement('style');
  style.id = 'richbuilder-style';
  style.textContent = `
    .richbuilder-root {
      display: none;
      height: 100%;
      min-height: 0;
      flex: 1;
      background: #0f131b;
      color: #e5ebf5;
      border-top: 1px solid #2a2f39;
      flex-direction: column;
    }
    .richbuilder-toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 10px;
      border-bottom: 1px solid #2a2f39;
      background: #171d29;
    }
    .richbuilder-toolbar-group {
      display: inline-flex;
      gap: 6px;
      align-items: center;
    }
    .richbuilder-layout-group {
      position: relative;
    }
    .richbuilder-list-group {
      position: relative;
    }
    .richbuilder-layout-label {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font: 600 12px/1.2 "Source Sans Pro", sans-serif;
      color: #d3dcf0;
    }
    .richbuilder-layout-trigger {
      min-width: 148px;
      justify-content: space-between;
      display: inline-flex;
      align-items: center;
    }
    .richbuilder-layout-menu {
      position: absolute;
      top: calc(100% + 8px);
      left: 0;
      z-index: 20;
      min-width: 280px;
      border: 1px solid #3a4456;
      border-radius: 8px;
      padding: 10px;
      background: #151c29;
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
    }
    .richbuilder-list-menu {
      position: absolute;
      top: calc(100% + 8px);
      left: 0;
      z-index: 20;
      min-width: 120px;
      border: 1px solid #3a4456;
      border-radius: 8px;
      padding: 6px;
      background: #151c29;
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .richbuilder-list-menu[hidden] {
      display: none;
    }
    .richbuilder-layout-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(118px, 1fr));
      gap: 8px;
    }
    .richbuilder-layout-tile {
      border: 1px solid #3a4456;
      background: #20283a;
      color: #ecf2ff;
      border-radius: 6px;
      padding: 8px;
      cursor: pointer;
      font: 600 11px/1.2 "Source Sans Pro", sans-serif;
      text-align: left;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .richbuilder-layout-tile:hover {
      background: #2a3550;
    }
    .richbuilder-layout-tile[data-active="true"] {
      border-color: #66a2ff;
      background: #264c82;
    }
    .richbuilder-layout-icon {
      display: block;
      width: 100%;
      max-width: 108px;
      height: auto;
      align-self: center;
    }
    .richbuilder-heading-label {
      font: 600 12px/1.2 "Source Sans Pro", sans-serif;
      color: #d3dcf0;
    }
    .richbuilder-heading-select {
      border: 1px solid #3a4456;
      background: #20283a;
      color: #ecf2ff;
      border-radius: 6px;
      padding: 4px 8px;
      font: 600 12px/1.2 "Source Sans Pro", sans-serif;
      min-width: 86px;
    }
    .richbuilder-heading-select:focus {
      outline: 1px solid #66a2ff;
      outline-offset: 0;
    }
    .richbuilder-btn {
      border: 1px solid #3a4456;
      background: #20283a;
      color: #ecf2ff;
      border-radius: 6px;
      padding: 4px 10px;
      font: 600 12px/1.2 "Source Sans Pro", sans-serif;
      cursor: pointer;
    }
    .richbuilder-btn:hover {
      background: #2a3550;
    }
    .richbuilder-btn[data-active="true"] {
      border-color: #66a2ff;
      background: #264c82;
    }
    .richbuilder-stage {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: 20px;
      background:
        radial-gradient(circle at 90% 10%, rgba(83, 125, 213, 0.12), transparent 45%),
        radial-gradient(circle at 10% 90%, rgba(75, 159, 130, 0.12), transparent 42%),
        #0f131b;
    }
    .richbuilder-editor {
      min-height: 100%;
      background: #0b0f17;
      border: 1px solid #2e3544;
      border-radius: 10px;
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.01);
      padding: 26px;
      font: 400 36px/1.35 "Noto Serif", serif;
      white-space: pre-wrap;
      word-break: break-word;
      outline: none;
      box-sizing: border-box;
      caret-color: #66a2ff;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      text-align: center;
    }
    .richbuilder-editor[data-layout-vertical="upperthird"] {
      justify-content: flex-start;
    }
    .richbuilder-editor[data-layout-vertical="lowerthird"] {
      justify-content: flex-end;
    }
    .richbuilder-editor[data-layout-shift="shiftleft"] {
      padding-right: calc(26px + 22%);
    }
    .richbuilder-editor[data-layout-shift="shiftright"] {
      padding-left: calc(26px + 22%);
    }
    .richbuilder-editor[data-layout-mode="info"],
    .richbuilder-editor[data-layout-mode="infofull"] {
      justify-content: flex-start;
      align-items: flex-start;
      text-align: left;
      padding-left: 34px;
      padding-right: 34px;
    }
    .richbuilder-editor[data-layout-mode="info"] > *,
    .richbuilder-editor[data-layout-mode="infofull"] > * {
      width: 100%;
      max-width: 100%;
      text-align: left;
    }
    .richbuilder-editor h1,
    .richbuilder-editor h2,
    .richbuilder-editor h3,
    .richbuilder-editor h4,
    .richbuilder-editor h5,
    .richbuilder-editor p,
    .richbuilder-editor div {
      margin: 0 0 0.55em 0;
    }
    .richbuilder-editor div:last-child,
    .richbuilder-editor p:last-child,
    .richbuilder-editor h1:last-child,
    .richbuilder-editor h2:last-child,
    .richbuilder-editor h3:last-child,
    .richbuilder-editor h4:last-child,
    .richbuilder-editor h5:last-child {
      margin-bottom: 0;
    }
    .richbuilder-editor ul,
    .richbuilder-editor ol {
      margin: 0 0 0.5em 0;
      padding-left: 1.25em;
      text-align: left;
      width: fit-content;
    }
    .richbuilder-editor li {
      margin: 0.08em 0;
    }
    .richbuilder-editor img.richbuilder-inline-image {
      display: block;
      max-width: min(100%, 680px);
      max-height: 42vh;
      width: auto;
      height: auto;
      margin: 0.35em 0;
      border-radius: 6px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
      object-fit: contain;
    }
    .richbuilder-editor video.richbuilder-inline-video {
      display: block;
      max-width: min(100%, 760px);
      max-height: 42vh;
      width: auto;
      height: auto;
      margin: 0.35em 0;
      border-radius: 6px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
      background: #000;
    }
    .richbuilder-image-token {
      display: inline-block;
      max-width: 100%;
      vertical-align: middle;
    }
    .richbuilder-editor li:has(> .richbuilder-check-item) {
      list-style: none;
    }
    .richbuilder-editor li:has(> .richbuilder-check-item)::marker {
      content: '';
    }
    .richbuilder-check-item {
      display: inline-flex;
      align-items: center;
      gap: 0.45em;
    }
    .richbuilder-check-item input[type="checkbox"] {
      width: 0.95em;
      height: 0.95em;
      margin: 0;
    }
    .richbuilder-check-item input[type="checkbox"]:checked + .richbuilder-check-text {
      text-decoration: line-through;
      opacity: 0.82;
    }
    .richbuilder-editor h1 { font-size: 1.35em; }
    .richbuilder-editor h2 { font-size: 1.2em; }
    .richbuilder-editor h3 { font-size: 1.05em; }
    .richbuilder-editor h4 { font-size: 0.95em; }
    .richbuilder-editor h5 { font-size: 0.88em; }
    .richbuilder-editor blockquote {
      display: block;
      border-left: 3px solid rgba(160, 160, 220, 0.55);
      margin: 0.3em 0;
      padding: 0.15em 0 0.15em 0.75em;
      font-style: italic;
      opacity: 0.85;
      text-align: left;
      width: fit-content;
    }
    .richbuilder-editor cite {
      display: block;
      margin: 0.28em 0;
      font-style: italic;
      font-size: 1.08em;
      color: #9aa6bc;
    }
    .richbuilder-editor cite:first-child {
      text-align: left;
    }
    .richbuilder-editor cite:last-child {
      text-align: right;
    }
    .richbuilder-hint {
      margin-left: auto;
      font: 500 11px/1.2 "Source Sans Pro", sans-serif;
      opacity: 0.72;
      align-self: center;
    }
    .richbuilder-twocol {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      width: 100%;
      border: 1px dashed rgba(100, 140, 220, 0.35);
      border-radius: 6px;
      padding: 10px;
      box-sizing: border-box;
      margin: 0.4em 0;
    }
    .richbuilder-col {
      min-height: 48px;
      padding: 6px 8px;
      border: 1px dashed rgba(100, 140, 220, 0.2);
      border-radius: 4px;
    }
    .richbuilder-table-group {
      position: relative;
    }
    .richbuilder-table-menu {
      position: absolute;
      top: calc(100% + 8px);
      left: 0;
      z-index: 20;
      min-width: 148px;
      border: 1px solid #3a4456;
      border-radius: 8px;
      padding: 6px;
      background: #151c29;
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .richbuilder-table-menu[hidden] {
      display: none;
    }
    .richbuilder-editor table {
      border-collapse: collapse;
      width: 100%;
      font-size: 0.5em;
      margin: 0.4em 0;
      table-layout: auto;
    }
    .richbuilder-editor th,
    .richbuilder-editor td {
      border: 1px solid #3a4456;
      padding: 5px 10px;
      text-align: left;
      vertical-align: top;
      min-width: 60px;
    }
    .richbuilder-editor th {
      background: #171d29;
      font-weight: 700;
      color: #d3dcf0;
    }
    .richbuilder-editor td {
      background: #0f1520;
    }
  `;
  document.head.appendChild(style);
}
