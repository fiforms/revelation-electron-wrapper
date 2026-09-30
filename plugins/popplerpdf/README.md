# Poppler PDF Plugin

This plugin carries a local Poppler payload and wires Add Media PDF tool paths when enabled.

There is one plugin ZIP per platform and architecture:

- `PopplerPDF.Plugin.<ver>.for.REVELation.Windows-x64.zip`
- `PopplerPDF.Plugin.<ver>.for.REVELation.macOS-arm64.zip`
- `PopplerPDF.Plugin.<ver>.for.REVELation.macOS-x64.zip`

The first-run setup screen downloads and installs the right one for the machine.

## Behavior

- On register, it scans this folder for `poppler-*` payloads built for this platform and architecture.
- It selects the newest one that contains `pdftoppm`.
- It writes these Add Media settings into app config:
  - `pluginConfigs.addmedia.pdftoppmPath`
  - `pluginConfigs.addmedia.pdfinfoPath`

Expected payload layouts:

```text
# Windows (from poppler-windows)
plugins/popplerpdf/poppler-26.09.0/Library/bin/pdftoppm.exe
plugins/popplerpdf/poppler-26.09.0/Library/bin/pdfinfo.exe

# macOS (from scripts/build-popplerpdf-mac.js)
plugins/popplerpdf/poppler-26.09.0-macos-arm64/bin/pdftoppm      # wrapper script
plugins/popplerpdf/poppler-26.09.0-macos-arm64/bin/pdfinfo       # wrapper script
plugins/popplerpdf/poppler-26.09.0-macos-arm64/libexec/          # real binaries
plugins/popplerpdf/poppler-26.09.0-macos-arm64/lib/              # bundled dylibs
plugins/popplerpdf/poppler-26.09.0-macos-arm64/etc/fonts/fonts.conf
```

On macOS, Add Media calls the wrapper scripts in `bin/`. They set
`FONTCONFIG_FILE` to the bundled `fonts.conf`, because conda-forge's fontconfig
has its build location compiled in and cannot find its own config once moved.
poppler-data is not bundled on macOS for the same reason. It only matters for
Chinese, Japanese or Korean PDFs that do not embed their fonts.

## Building

```shell
# Windows: download the poppler-windows release into this folder
npm run build-popplerpdf-win
npm run dist-popplerpdf-win

# macOS (run on a Mac): install conda-forge Poppler with micromamba, bundle it,
# re-sign it ad hoc and test it from another folder
npm run build-popplerpdf-mac                 # this Mac's architecture
npm run build-popplerpdf-mac -- --arch=x64   # or arm64
npm run dist-popplerpdf-mac
```

The dist step writes the arch-suffixed ZIP to `dist/`. `scripts/prepackage.js`
does the same during a full app build, then removes `plugins/popplerpdf` before
the main Electron package build. The `build-macos` GitHub workflow builds both
macOS ZIPs, prints their SHA-256 and uploads them as artifacts.

After publishing new ZIPs, update the URLs and SHA-256 hashes in
`POPPLER_PLUGIN_DOWNLOADS` in `main.js`. A download whose hash does not match is
refused, and a platform with no hash is not offered.

## TROUBLESHOOTING

If the program doesn't run on Windows, you may need to install the Microsoft Visual C++ 2015 Redistributable from
https://aka.ms/vs/17/release/vc_redist.x64.exe
