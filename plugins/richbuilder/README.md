# richbuilder plugin

Experimental builder mode that swaps preview iframe for a contenteditable rich editor surface.

Current behavior:
- Adds a `Rich` mode button in builder Live Preview actions.
- Hides `#preview-frame` while active.
- Shows an editable canvas that syncs to current slide markdown body.
- Toolbar supports heading levels (`H1/H2/H3`) and inline `bold`, `italic`, `underline`.

This is intentionally a rough scaffold to iterate from.
