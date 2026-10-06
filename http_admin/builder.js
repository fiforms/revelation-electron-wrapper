/*
 * Presentation builder entrypoint.
 *
 * Sections:
 * - Bootstrapping
 *
 * Loaded by builder.html as <script type="module"> after /admin/vendor/js-yaml.js
 * (window.jsyaml) and /js/translate.js (window.tr / translationsources). The page is
 * opened with ?slug=<folder>&md=<file>&dir=<presentations_dir>[&spellLang=xx].
 *
 * Module map (all under ./builder/, ES modules; context.js is the shared base):
 * - context.js        DOM refs, URL params (slug/mdFile/dir), shared `state` object, trFormat
 * - markdown.js       pure-ish helpers: slide split/join, parseSlide/buildSlide, front matter
 *                     (js-yaml), media/markdown snippet builders, imports loading
 * - document.js       getFullMarkdown(): state.frontmatter + joined state.stacks
 * - presentation.js   load / save / re-parse via electronAPI.savePresentationMarkdown
 * - slides.js         slide/column operations, slide list rendering, column-markdown mode
 * - preview.js        preview iframe, postMessage bridge, peer push/link
 * - history.js        unified undo/redo (document snapshots)
 * - extensions-host.js  window.RevelationBuilderHost API used by plugins (richbuilder, slidesorter...)
 * - events.js         wires every button/menu/key handler and runs the init sequence
 * - layout.js, menus.js, media.js, content.js, tint.js, editor-actions.js, properties.js,
 *   notes-editor.js, notes-markdown.js, color-spans.js, variants.js, timings.js,
 *   smart-paste.js, readonly.js, labels.js: feature modules imported by the above.
 *
 * Data model: state.stacks[h][v] = { top, body, notes } (h = column / horizontal stack,
 * v = slide in column). Markdown is the persisted format; every edit mutates
 * state.stacks/state.frontmatter, calls markDirty() (app-state.js) and
 * schedulePreviewUpdate() (preview.js).
 */
// --- Bootstrapping ---
import { initBuilderEvents } from './builder/events.js';

initBuilderEvents();
