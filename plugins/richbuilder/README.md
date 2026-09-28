# richbuilder plugin

Experimental builder mode that swaps preview iframe for a contenteditable rich editor surface.

Current behavior:
- Adds a `Rich Editor` mode button in builder Live Preview actions.
- Hosts the builder's slide **Properties** control at the end of its toolbar, so it only shows while rich editing (it stays in the Live Preview header when this plugin is disabled).
- Hides `#preview-frame` while active.
- Shows an editable canvas that syncs to current slide markdown body.
- Toolbar supports heading levels (`H1/H2/H3`) and inline `bold`, `italic`, `underline`.

This is intentionally a rough scaffold to iterate from.
