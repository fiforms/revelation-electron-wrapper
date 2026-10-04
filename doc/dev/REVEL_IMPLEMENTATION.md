# `.revel` in REVELation Snapshot Presenter: Implementation Notes

How this application exports, imports, opens, registers and secures `.revel` files. The format
itself (container, layout, manifest, media) is specified in [REVEL_FORMAT.md](REVEL_FORMAT.md),
which is written to be shared with other implementers. This document is specific to this
codebase and none of it is required of other implementations.

For the user-facing workflow see [GUI_REFERENCE.md](../GUI_REFERENCE.md#gui-opening-revel-files).

| Concern | Code |
|---|---|
| Export | [lib/exportPresentation.js](../../lib/exportPresentation.js) |
| Manifest | [lib/presentationManifest.js](../../lib/presentationManifest.js) |
| Extract / import | [lib/importPresentation.js](../../lib/importPresentation.js) (`runZipImport`) |
| Read-only open | [lib/openedPresentation.js](../../lib/openedPresentation.js) |
| Lightbox | `revelation/js/presentationlist.js` (`renderOpenedPresentationLightbox`) |
| Builder read-only mode | [http_admin/builder/readonly.js](../../http_admin/builder/readonly.js) |
| OS registration | `build` section of [package.json](../../package.json) |

---

## Export

The export window's **REVELation (.revel)** format (the `export-presentation` IPC in
`lib/exportPresentation.js`) writes a ZIP with the `.revel` extension. A standalone export
(**Create Standalone Presentation**) is not a `.revel`: it generates a runnable website (HTML plus
`_resources/` CSS and JavaScript) and saves a plain `.zip` (the save dialog defaults to
`<slug>.zip`). The app does not open those as presentations. This keeps `.revel` files free of the
generated files the format forbids (see REVEL_FORMAT.md section 3): the HTML and the runtime files
under `_resources/` are only generated when **Create Standalone Presentation** is ticked, so a
`.revel` export contains at most `_resources/_media/`.

What gets written:

- The presentation folder is zipped at the archive root with deflate level 9, using
  `archiver`.
- `manifest.json` is rebuilt with `forceRecompute` immediately before zipping, so sizes and hashes
  are current. It carries `appVersion`, `exportedAt`, `markdownFiles`, `presentations`,
  `presentationId` and `files`. Ordinary saves write the same manifest with `savedAt` instead of
  `exportedAt` and no `presentations`.
- `presentationId` is created once (`crypto.randomUUID()`) and preserved by every manifest
  rewrite, so it also travels through cloud sync and URL import.
- **Include media** copies each media file referenced by the front matter `media` map, with its
  `.json` sidecar, `.thumbnail.jpg` and large variant, from the shared `_media/` library into
  `_resources/_media/`. Without it the archive has no `_resources/`.

What is left out:

- Hidden (dot-prefixed) paths such as `.thumbs` (the builder's thumbnail cache) and
  `.sync-conflicts` (local WordPress sync backups), and `__builder_temp.md` (the builder's preview
  file).
- Anything the format prohibits; see "Content restrictions and versioning" below.
- `_resources/` is generated for the export and removed afterwards, along with any temporary HTML.

### Content restrictions and versioning

[REVEL_FORMAT.md section 3.1](REVEL_FORMAT.md#31-content-restrictions) prohibits scripts,
executables, macro-enabled Office files and archives that contain them, and defines the SVG policy.
Enforcement is in [lib/revelFormat.js](../../lib/revelFormat.js), which has no Electron
dependency. The lists live in `PROHIBITED_EXTENSIONS` and `MEDIA_EXTENSIONS`; change them there.

How this app applies the spec's grey areas:

- **Archives:** blocked by file extension (`.zip`, `.tar`, `.gz`, `.7z`, `.rar`, `.iso`, `.dmg`, …).
  We block all archives rather than scan them. ZIP-based *document* formats (`.docx`, `.pptx`,
  `.xlsx`, `.odp`, `.key`) are not archives and are kept.
- **Other files:** unrecognised types are kept, including `.pdf`, `.pptx`, `.docx`, `.key` and
  other project files, so a presentation folder can carry its source material. Macro-enabled
  Office files (`.docm`, `.xlsm`, `.pptm`, and the template and add-in variants) are blocked.
  Legacy binary Office files (`.doc`, `.xls`, `.ppt`) can contain macros but are not blocked.
- **Documents:** PDF, Office, OpenDocument and Keynote files are passed through and not scanned
  for active content. The app never opens them itself, and they carry the download-origin mark
  (see below). Scanning PDFs reliably needs a PDF parser, since most PDFs compress their objects
  and a simple search for `/JavaScript` or `/Launch` misses many; that is not implemented.
- **Content checks:** executable or script content (`MZ`, ELF, Mach-O, `#!`) is refused under any
  non-text name. Archive content is refused only under a media or font name (`.png`, `.jpg`,
  `.mp4`, `.woff2`, …), where it can only be a disguised archive.

**On export** (`planRevelContents`, `writeRevelArchive`):

- Before the save dialog, the folder is scanned. If anything would be omitted, a dialog says: "This
  presentation contains some prohibited file types, which are omitted from the exported file.
  Export as a standalone presentation to include these." It lists the files and offers **Continue
  Export** or **Cancel**.
- The archive is built entry by entry from the plan, not by globbing the folder. Prohibited files
  (by extension, or by the content checks above) are left out, SVG files are sanitized, and any SVG that cannot be made safe is omitted.
- Hidden (dot-prefixed) paths and `__builder_temp.md` are never included. This is stricter than
  before: only `.thumbs` and `.sync-conflicts` were excluded.
- `manifest.json` is built to describe exactly what was archived: omitted files are not listed,
  and a sanitized SVG is listed with the size and SHA-1 of the sanitized bytes (`exclude` and
  `overrides` options in `lib/presentationManifest.js`).
- The export result carries `omitted` and `cleaned`, and the export window appends "(N prohibited
  files omitted)" to its status line.
- A standalone export is a plain `.zip` website and is not filtered, which is why the warning
  suggests it.

**On extraction** (`extractRevelArchive`), used by import, open and the Open Presentation menu:

- Entries are skipped, not extracted, when the name is unsafe (absolute, drive letter, `..`), the
  extension is prohibited, or the content checks above fail. Text-parsed types (`.md`, `.json`,
  `.css`, `.txt`, `.yaml`, `.svg`) are not signature-checked, since a Markdown file may
  legitimately begin with "MZ".
- Hidden paths are ignored silently. SVG is sanitized (script and `foreignObject` elements, event
  handlers, `javascript:` URLs, non-fragment `href`s, external CSS `url()` and `@import`,
  DOCTYPE and entity declarations); an SVG that cannot be parsed, or is over 10 MB, is skipped.
- Limits: 20,000 entries and 8 GiB uncompressed in total. Declared sizes are checked up front and
  the bytes actually written are counted while streaming.
- Skipped and sanitized files are excluded from manifest validation so they do not raise false
  "missing" or "hash mismatch" errors. The import result carries `skipped` and `cleaned`, and the
  Import window message says how many files were skipped.
- URL import applies the same name, signature and SVG rules to each downloaded file.
- A file opened from the OS shows a notice in the lightbox when files were skipped.

**Download-origin marks** ([lib/originMark.js](../../lib/originMark.js)). Browsers and mail clients
mark downloaded files so the OS can apply Protected View, macro blocking and Gatekeeper. Archive
tools copy the archive's mark onto what they extract; Node's extraction does not, so after
extraction the app does it:

- Only files REVELation does not consume itself are marked (`needsOriginMark`): everything except
  text-parsed types (`.md`, `.json`, `.css`, `.txt`, `.yaml`, `.svg`) and web media and fonts. In
  practice that is documents, PDFs and other project files.
- **Windows:** if the `.revel` has a `Zone.Identifier` alternate data stream, its bytes are written
  as the same stream on each such file. A file with no stream (it was not downloaded) leaves the
  extracted files unmarked, exactly as Explorer would. File systems without streams (FAT, exFAT,
  some network shares) are skipped silently.
- **macOS:** the `com.apple.quarantine` attribute is read with `/usr/bin/xattr -p` and applied with
  `xattr -w`, 50 files per call.
- **URL import:** files the app downloads itself get a fresh mark: `ZoneId=3` with `HostUrl` on
  Windows, and a hand-built `0081;<time>;REVELation;` quarantine value on macOS.
- **Linux:** no equivalent exists, so nothing is marked.
- Marking is best effort. A failure is logged and never fails the import.
- Marks are local state. They are not written into exported `.revel` files; the OS applies its own
  mark when the file is downloaded.

**Version check.** After extraction, `manifest.json`'s `appVersion` is compared with the running
app version (`compareVersions`, dotted numeric). A newer file produces a result `newerVersion` and
a lightbox notice ("made by a newer version of REVELation … may not display correctly"). The
import still proceeds. A missing or older `appVersion` produces no notice.

---

## Import and extraction

`runZipImport` in `lib/importPresentation.js` is used by **Import Presentation**, by **Open
Presentation**, and by a file association open:

1. **Validate the path:** the file exists and ends in `.revel` or `.zip`.
2. **Extract** with `extractRevelArchive` (see above): content rules, SVG sanitizing and size limits.
3. **Validate against `manifest.json`** (size and SHA-1 per entry). Failures show a dialog; the user
   may continue, or cancel, which deletes the extracted folder. A missing or unparseable manifest
   skips validation.
4. **Move embedded media** from `_resources/_media/` into the shared `_media/` library, never
   overwriting an existing library file.
5. **Offer to download missing media** referenced in front matter via `url_direct`, `url_library`
   or `url_origin`. The user is asked first.
6. **Clean up:** delete top-level `.html` files and `_resources/`, and bump markdown modification
   times so file watchers refresh.

Because step 4 merges into the shared library, opening a file adds its media to the library even
if the presentation is never imported.

---

## Opening a file

A `.revel` file arrives from the OS (double-click, Open With, drop on the dock icon) or from
**Presentation > Open Presentation**. Both end in `openFile()` in `lib/openedPresentation.js`.

How the path reaches the app:

| Platform | Mechanism |
|---|---|
| Windows, Linux | Command-line argument. A second launch is forwarded to the running instance by the `second-instance` event (the app holds a single-instance lock). |
| macOS | The `open-file` event, which can arrive before the app is ready and while it is running. |

The path is queued and handled once the main window exists, then:

1. The file is extracted into the fixed slug **`_current_open`** inside the presentations
   directory, replacing any previous opened copy.
2. The main process reads the front matter for title, description and thumbnail, and looks for an
   existing library presentation with the same `presentationId`.
3. The presentation list shows a lightbox over the list (see below).

### The transient slug

`_current_open` is not passed through `slugify()` (which would strip its leading underscore), so a
user-chosen slug can never equal it, and `runZipImport` rejects it as a destination for an ordinary
import. It is excluded everywhere a presentation is enumerated:

| Place | How |
|---|---|
| Presentation index | `generatePresentationIndex()` in `revelation/vite.plugins.js` skips the directory |
| WordPress listing and sync | already skips `_`-prefixed folders |
| Media usage scan | counts it as using its media (protective: its media is not offered for deletion) |

It is a normal directory under the presentations folder, so the presentation window, handout view
and builder load it by slug exactly as any other presentation. A dot-directory was rejected
because the static file server refuses to serve dot paths.

Lifetime: replaced by the next open, deleted by **Close without importing**, and deleted at
application startup (`cleanupOnStartup`). It is not deleted at quit.

### Read-only enforcement

- **Main process.** `assertWritableSlug()` rejects the transient slug in the markdown save,
  variant, metadata-save and missing-media IPC handlers. The builder's temporary preview file
  (`__builder_temp.md`) may still be written, since the builder preview needs it.
- **Builder.** `http_admin/builder/readonly.js` disables Save, shows a banner with an **Import**
  button, and arms a guard on the dirty flag: any edit shows a reminder and is undone (with a
  reload as a fallback). The builder window for this slug closes without any unsaved-changes
  prompt.
- **Not enforced.** Plugin handlers (for example add-media) can still write to the slug if invoked
  directly. The UI does not expose them for the opened copy. Plugins cannot import the guard from
  `lib/`, so a complete fix needs a server-side check.

### Import to Library

`importOpened()` renames `_current_open` to a unique slug from the file name (`my-talk`, then
`my-talk-2`, …) and clears the lightbox. A read-only builder window is closed and the builder is
reopened on the new slug. If another library presentation has the same `presentationId`, the
lightbox shows a warning first; Import still creates a separate copy.

After import the presentation is an ordinary library entry. Edits are saved only to the local
library; the original `.revel` file is never modified. The user must export again to update it,
and the UI says so.

---

## Security analysis

A `.revel` opened by double-click is untrusted input that arrives with less deliberate intent than
the Import wizard, so it matters more that the shared extraction path is hardened.

| Concern | Status |
|---|---|
| Path traversal in entry names | Entries with absolute, drive-letter or `..` names are skipped, and the resolved destination must stay inside the target folder. |
| Scripts, executables, macro-enabled Office files, archives | Skipped by name, plus the content checks above. |
| Allowed project files (`.pdf`, `.pptx`, `.docx`, `.key`) | Extracted as-is, never scanned or opened by the app. They carry the download-origin mark of the archive (see "Download-origin marks"), so Office's Protected View and Gatekeeper still apply when the user opens them. "Show Presentation Files" opens the folder in the file manager, where a double-click launches the file. |
| SVG | Sanitized on export, import and URL import; unparseable SVG is dropped. |
| Zip bombs (size, entry count) | Capped at 20,000 entries and 8 GiB uncompressed (declared sizes checked first, then bytes written). There is no per-entry compression-ratio check. |
| Content injection through Markdown | Same sanitization, Content Security Policy and live-DOM pass as any presentation. See [revelation/doc/SECURITY.md](../../revelation/doc/SECURITY.md). |
| Code execution | Nothing in the archive is executed on open. Other files are extracted but not interpreted, except a stylesheet a presentation references. |
| Network access | The missing-media download fetches URLs from the file's front matter. It runs only after the user confirms. |
| Library pollution | Embedded media is merged into the shared library on open (import step 4), never overwriting. |
| Widgets and plugins | Whether an untrusted presentation may use overlay widgets and other plugin syntax is decided by the normal presentation security model, not by this feature. |
| Local state in the file | Dot-prefixed paths in an archive are extracted but ignored by the manifest. They are not trusted as sync state; sync peers live in app storage, not in the presentation folder. |

---

## OS registration

The installers register the extension. The app does not write file associations at runtime.

| Platform | Mechanism | On uninstall |
|---|---|---|
| Windows (NSIS) | Registry keys generated from `fileAssociations` | Removed |
| Linux deb, rpm | `.desktop` `MimeType=` entry and a shared-mime-info XML | Removed by package hooks |
| Linux AppImage | None. There is no install step and it is not a configured target. | n/a |
| macOS | `CFBundleDocumentTypes` plus a `UTExportedTypeDeclarations` entry from `mac.extendInfo` | Trashing the app removes it eventually |

Configuration, all in the `build` section of `package.json`:

- `fileAssociations`: extension `revel`, media type `application/vnd.revelation.presentation+zip`,
  name and description "REVELation Presentation", role `Viewer`, icon `file-icon`.
- `mac.extendInfo`: declares `com.revelation.snapshot.presentation`, conforming to
  `public.zip-archive`, tagged with the extension and the media type.

Icons are in `build-resources/`: `file-icon.ico` (Windows), `file-icon.icns` (macOS), and
`file-icon.png` (1024 px master). electron-builder falls back to the application icon if a
platform file is missing. It does not support custom file icons on Linux, where the generic
document icon is used.

Platform notes:

- Windows does not let an installer silently take over a default handler. If no other program
  claims `.revel`, the app is used; otherwise the user chooses once from **Open with**.
- macOS registers the association when the app is first launched or placed in /Applications.
- An unsigned build still registers the association but triggers Gatekeeper prompts. The
  `build-macos.yml` workflow has no signing or notarization step and needs no changes for the
  association.

To verify a packaged build: install it, double-click a `.revel` file, and confirm it opens in the
lightbox; uninstall and confirm the association is gone. Packaging details are in
[BUILDING.md](BUILDING.md#file-association-for-revel-files).

---

## Changing the format

Before changing what the exporter or manifest writes, update [REVEL_FORMAT.md](REVEL_FORMAT.md),
keep changes additive, and check that the reader paths above (validation, media move, listing)
still ignore unknown fields.
