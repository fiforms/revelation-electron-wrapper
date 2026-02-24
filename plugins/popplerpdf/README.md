# Poppler PDF Plugin

This plugin carries a local Poppler payload and wires Add Media PDF tool paths when enabled.

## Behavior

- On register, it scans this folder for `poppler-*` payloads.
- It selects the newest payload that contains `Library/bin/pdfimages.exe`.
- It writes these Add Media settings into app config:
  - `pluginConfigs.addmedia.pdftoppmPath`
  - `pluginConfigs.addmedia.pdfinfoPath`

Expected payload layout example:

```text
plugins/popplerpdf/poppler-25.12.0/Library/bin/pdfimages.exe
plugins/popplerpdf/poppler-25.12.0/Library/bin/pdftoppm.exe
plugins/popplerpdf/poppler-25.12.0/Library/bin/pdfinfo.exe
```

## Packaging Flow

`scripts/prepackage.js` creates `dist/popplerpdf.zip` from this plugin folder and then removes `plugins/popplerpdf` before the main Electron package build.
