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
    .builder-preview,
    .richbuilder-root {
      position: relative;
    }
    .richbuilder-markdown-tools .panel-button {
      padding: 4px 8px;
    }
    .richbuilder-edit-hint {
      position: absolute;
      left: 0;
      right: 0;
      z-index: 5;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(40, 44, 52, 0.4);
      cursor: pointer;
      user-select: none;
    }
    .richbuilder-edit-hint[hidden] {
      display: none;
    }
    .richbuilder-edit-hint-label {
      color: #f2f5fb;
      text-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);
      font: 400 clamp(22px, 4vw, 44px)/1.2 "Source Sans Pro", sans-serif;
      white-space: nowrap;
      transform: rotate(-20deg);
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
    .richbuilder-color-group {
      position: relative;
    }
    .richbuilder-color-menu {
      position: absolute;
      top: calc(100% + 8px);
      left: 0;
      z-index: 20;
      min-width: 130px;
      border: 1px solid #3a4456;
      border-radius: 8px;
      padding: 6px;
      background: #151c29;
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .richbuilder-color-menu[hidden] {
      display: none;
    }
    .richbuilder-color-choice {
      display: flex;
      align-items: center;
      gap: 8px;
      text-align: left;
    }
    .richbuilder-color-swatch {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      flex: none;
    }
    /* Inline text colors — dark-surface palette, same as the slides' dark themes. */
    .richbuilder-editor .text-red { color: #ff6b6b; }
    .richbuilder-editor .text-green { color: #6fcf8a; }
    .richbuilder-editor .text-blue { color: #6cb4ff; }
    .richbuilder-editor .text-purple { color: #c792ea; }
    .richbuilder-editor .text-highlight { color: #ffd54f; }
    .richbuilder-editor .text-muted { color: #9aa0a6; }
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
      position: relative;
      display: inline-block;
      max-width: 100%;
      vertical-align: middle;
    }
    .richbuilder-image-placement {
      position: absolute;
      top: calc(0.35em + 6px);
      right: 6px;
      display: inline-flex;
      gap: 4px;
      opacity: 0.55;
      transition: opacity 120ms ease;
    }
    .richbuilder-image-token:hover .richbuilder-image-placement,
    .richbuilder-image-placement:focus-within {
      opacity: 1;
    }
    .richbuilder-image-placement select,
    .richbuilder-image-placement input {
      font: 12px/1.2 "Source Sans Pro", sans-serif;
      color: #e5ebf5;
      background: rgba(15, 19, 27, 0.85);
      border: 1px solid #3a4456;
      border-radius: 5px;
      padding: 2px 4px;
    }
    .richbuilder-image-placement input {
      width: 4.2em;
    }
    .richbuilder-image-placement input[hidden] {
      display: none;
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
    /* Full-width inline-block rather than block: it still gets its own line,
       but a <br> right after it ends that line instead of adding an empty one. */
    .richbuilder-editor cite {
      display: inline-block;
      width: 100%;
      vertical-align: top;
      margin: 0.28em 0;
      font-style: italic;
      font-size: 1.08em;
      color: #9aa6bc;
    }
    .richbuilder-editor cite:first-child:not(:last-child) {
      text-align: left;
    }
    .richbuilder-editor cite:last-child {
      text-align: right;
    }
    .richbuilder-host-slot {
      margin-left: auto;
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
    /* Inline link tokens — rendered as styled spans (not real <a> tags) so
       clicking them opens the edit modal rather than navigating away. */
    .richbuilder-link-token {
      color: #66a2ff;
      text-decoration: underline;
      text-underline-offset: 2px;
      cursor: pointer;
      border-radius: 2px;
      padding: 0 1px;
    }
    .richbuilder-link-token:hover {
      background: rgba(102, 162, 255, 0.15);
    }
    /* Link insertion / edit modal */
    .richbuilder-link-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.55);
      z-index: 200;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .richbuilder-link-backdrop[hidden] {
      display: none;
    }
    .richbuilder-link-dialog {
      background: #171d29;
      border: 1px solid #3a4456;
      border-radius: 10px;
      padding: 20px 22px;
      min-width: 320px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
    }
    .richbuilder-link-dialog h3 {
      margin: 0;
      font: 700 13px/1.3 "Source Sans Pro", sans-serif;
      color: #d3dcf0;
    }
    .richbuilder-link-field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .richbuilder-link-field label {
      font: 600 11px/1.3 "Source Sans Pro", sans-serif;
      color: #8a9bbf;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .richbuilder-link-field input {
      background: #0b0f17;
      border: 1px solid #3a4456;
      border-radius: 6px;
      color: #e5ebf5;
      padding: 6px 10px;
      font: 400 13px/1.4 "Source Sans Pro", sans-serif;
    }
    .richbuilder-link-field input:focus {
      outline: 1px solid #66a2ff;
      outline-offset: 0;
    }
    .richbuilder-link-actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
      margin-top: 4px;
    }
    .richbuilder-btn.richbuilder-btn-danger {
      margin-right: auto;
      border-color: #7a3040;
      color: #ffb4bf;
    }
    .richbuilder-btn.richbuilder-btn-danger:hover {
      background: #3a1d26;
    }
    .richbuilder-card-menu {
      position: fixed;
      z-index: 210;
      min-width: 150px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 4px;
      background: #151c29;
      border: 1px solid #3a4456;
      border-radius: 8px;
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
    }
    .richbuilder-card-menu[hidden] {
      display: none;
    }
    .richbuilder-card-menu-item {
      text-align: left;
      padding: 6px 10px;
      border: 0;
      border-radius: 5px;
      background: transparent;
      color: #ecf2ff;
      font: 600 12px/1.2 "Source Sans Pro", sans-serif;
      cursor: pointer;
    }
    .richbuilder-card-menu-item:hover {
      background: #20283a;
    }
    .richbuilder-card-menu-item.has-separator {
      margin-top: 4px;
      border-top: 1px solid #3a4456;
      border-radius: 0 0 5px 5px;
      padding-top: 8px;
    }
    .richbuilder-card-menu-item.is-danger {
      color: #ffb4bf;
    }
    /* In-slide macro token blocks */
    .richbuilder-macro-token {
      display: block;
      background: rgba(80, 130, 220, 0.06);
      border: 1px dashed rgba(100, 150, 220, 0.25);
      border-radius: 4px;
      padding: 2px 8px;
      margin: 0.25em 0;
      font-family: monospace;
      font-size: 0.66em;
      color: rgba(160, 205, 255, 0.6);
      cursor: pointer;
      user-select: none;
    }
    .richbuilder-macro-token:hover {
      background: rgba(80, 130, 220, 0.12);
      border-color: rgba(120, 170, 255, 0.4);
    }
    /* Macro edit lightbox */
    .richbuilder-macro-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.55);
      z-index: 200;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .richbuilder-macro-backdrop[hidden] {
      display: none;
    }
    .richbuilder-macro-dialog {
      background: #171d29;
      border: 1px solid #3a4456;
      border-radius: 10px;
      padding: 20px 22px;
      min-width: 360px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
    }
    .richbuilder-macro-dialog h3 {
      margin: 0;
      font: 700 13px/1.3 "Source Sans Pro", sans-serif;
      color: #d3dcf0;
    }
    .richbuilder-macro-textarea {
      background: #0b0f17;
      border: 1px solid #3a4456;
      border-radius: 6px;
      color: #e5ebf5;
      padding: 8px 10px;
      font: 400 13px/1.5 monospace;
      resize: vertical;
      min-height: 80px;
    }
    .richbuilder-macro-textarea:focus {
      outline: 1px solid #66a2ff;
      outline-offset: 0;
    }
    /* In-slide fragment token spans */
    .richbuilder-fragment-token {
      display: inline-block;
      background: rgba(220, 80, 200, 0.06);
      border: 1px dashed rgba(230, 100, 220, 0.25);
      border-radius: 3px;
      padding: 0px 4px;
      margin: 0 3px;
      font-family: monospace;
      font-size: 0.52em;
      color: rgba(255, 160, 240, 0.55);
      cursor: pointer;
      user-select: none;
      white-space: nowrap;
    }
    .richbuilder-fragment-token:hover {
      background: rgba(220, 80, 200, 0.12);
      border-color: rgba(240, 120, 230, 0.4);
    }
    /* Fragment edit lightbox */
    .richbuilder-fragment-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.55);
      z-index: 200;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .richbuilder-fragment-backdrop[hidden] {
      display: none;
    }
    .richbuilder-fragment-dialog {
      background: #171d29;
      border: 1px solid #3a4456;
      border-radius: 10px;
      padding: 20px 22px;
      min-width: 320px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
    }
    .richbuilder-fragment-dialog h3 {
      margin: 0;
      font: 700 13px/1.3 "Source Sans Pro", sans-serif;
      color: #d3dcf0;
    }
    .richbuilder-fragment-textarea {
      background: #0b0f17;
      border: 1px solid #3a4456;
      border-radius: 6px;
      color: #e5ebf5;
      padding: 8px 10px;
      font: 400 13px/1.5 monospace;
      resize: vertical;
      min-height: 60px;
    }
    .richbuilder-fragment-textarea:focus {
      outline: 1px solid #ff80ff;
      outline-offset: 0;
    }
    .richbuilder-fragment-help {
      margin: 0;
      font: 400 11px/1.4 "Source Sans Pro", sans-serif;
      color: #888fa1;
    }
    /* HTML code block tokens */
    .richbuilder-html-token {
      display: block;
      background: rgba(100, 200, 100, 0.06);
      border: 1px dashed rgba(120, 220, 120, 0.25);
      border-radius: 4px;
      padding: 2px 8px;
      margin: 0.25em 0;
      font-family: monospace;
      font-size: 0.66em;
      color: rgba(140, 240, 140, 0.6);
      cursor: pointer;
      user-select: none;
    }
    .richbuilder-html-token:hover {
      background: rgba(100, 200, 100, 0.12);
      border-color: rgba(150, 255, 150, 0.4);
    }
    /* HTML edit lightbox */
    .richbuilder-html-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.55);
      z-index: 200;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .richbuilder-html-backdrop[hidden] {
      display: none;
    }
    .richbuilder-html-dialog {
      background: #171d29;
      border: 1px solid #3a4456;
      border-radius: 10px;
      padding: 20px 22px;
      min-width: 400px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
    }
    .richbuilder-html-dialog h3 {
      margin: 0;
      font: 700 13px/1.3 "Source Sans Pro", sans-serif;
      color: #d3dcf0;
    }
    .richbuilder-html-textarea {
      background: #0b0f17;
      border: 1px solid #3a4456;
      border-radius: 6px;
      color: #e5ebf5;
      padding: 8px 10px;
      font: 400 12px/1.5 monospace;
      resize: vertical;
      min-height: 120px;
    }
    .richbuilder-html-textarea:focus {
      outline: 1px solid #80ff80;
      outline-offset: 0;
    }
  `;
  document.head.appendChild(style);
}
