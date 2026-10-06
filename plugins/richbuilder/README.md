# richbuilder plugin

Rich-text slide editor for the Presentation Builder. It swaps the preview iframe for a contenteditable editing surface that is serialised back to slide markdown.

Current behavior:
- Adds a `Rich Editor` mode button in builder Live Preview actions.
- Hosts the builder's slide **Properties** control at the end of its toolbar, so it only shows while rich editing (it stays in the Live Preview header when this plugin is disabled).
- Hides `#preview-frame` while active and shows an editable canvas that two-way syncs with the current slide's markdown body.
- Toolbar: headings, bold/italic/underline, text colors (`[text]{.red}` spans), blockquote/cite, lists and checklists, tables (row/column insert, delete, alignment), two-column (`||`) blocks, and slide layout presets (standard, info, upper/lower third, shift left/right).
- Images and videos (including `media:` aliases) are shown inline with placement options; unknown macros and raw HTML appear as non-editable tokens.

Layout: `builder.js` is the entry point; `builder-markdown.js` (markdown to DOM), `builder-serialize.js` (DOM to markdown), `builder-format.js`, `builder-table.js`, `builder-layout.js`, `builder-media.js`, `builder-styles.js`, `builder-utils.js`. `color-spans.js` is a byte-identical copy of `http_admin/builder/color-spans.js` and must be kept in sync.
