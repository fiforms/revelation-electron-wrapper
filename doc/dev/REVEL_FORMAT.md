# The `.revel` File Format

**Status:** specification of the format as written by REVELation Snapshot Presenter. A file's
version is the `appVersion` in its `manifest.json`; see [section 9](#9-versioning-and-compatibility).

A `.revel` file packs one REVELation presentation, its language variants, and optionally its
media into a single file for sharing, archiving, and transfer between applications. This document
specifies the container and its metadata so that other applications can read and write it.

---

It deliberately does **not** specify the presentation language itself. A `.revel` file carries
Markdown with YAML front matter; the syntax and meaning of that content is defined by the
REVELation Markdown specification:

- [revelation/doc/AUTHORING_REFERENCE.md](../../revelation/doc/AUTHORING_REFERENCE.md): extended Markdown syntax, macros, media aliases
- [revelation/doc/METADATA_REFERENCE.md](../../revelation/doc/METADATA_REFERENCE.md): YAML front matter schema
- [revelation/doc/REFERENCE.md](../../revelation/doc/REFERENCE.md): index of the framework documentation

How the REVELation application itself exports, imports, opens, registers and secures `.revel`
files is described separately in [REVEL_IMPLEMENTATION.md](REVEL_IMPLEMENTATION.md). Nothing in
that document is required of other implementations.

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are used as in
[RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

---

## 1. Identification

| | |
|---|---|
| File extension | `.revel` |
| Media type | `application/vnd.revelation.presentation+zip` |
| macOS UTI | `com.revelation.snapshot.presentation`, conforming to `public.zip-archive` |
| Structured syntax | ZIP (the `+zip` suffix, [RFC 6839](https://www.rfc-editor.org/rfc/rfc6839)) |

The media type is not registered with IANA. The format has no magic number of its own: a `.revel`
file begins with the ZIP signature, and is identified by its extension or media type.

An archive made before the `.revel` name existed is an ordinary `.zip` with the same layout.
Readers SHOULD accept such archives.

---

## 2. Container

- The file MUST be a ZIP archive as defined by the PKWARE APPNOTE. Entries SHOULD be stored with
  deflate or store.
- Encrypted entries and multi-volume archives are not supported.
- Entry names MUST be relative paths using `/` as the separator, and SHOULD be UTF-8. They MUST NOT
  be absolute, contain a drive letter, or contain a `..` segment.
- The archive root is the presentation folder. There is **no** wrapping directory.

---

## 3. Layout

```
example.revel
├── manifest.json              # index and integrity data (section 6); SHOULD be present
├── presentation.md            # one or more Markdown files (section 4); at least one is REQUIRED
├── presentation.es.md         # optional variants
├── presentation.thumb.jpg     # optional thumbnails (section 5)
├── custom.css                 # optional files referenced by the Markdown
└── _resources/
    └── _media/                # optional embedded media (section 7)
        ├── photo.jpg
        ├── photo.jpg.json
        └── photo.jpg.thumbnail.jpg
```

---

### 3.1 Content restrictions

A `.revel` file is a data file. Opening one MUST never run code, so it must not carry content that
a desktop system would execute with the user's permissions.

**Prohibited.** A `.revel` file MUST NEVER contain, and a writer MUST NEVER add, any of the
following, at any path:

| Category | Extensions (case-insensitive; the list is not exhaustive) |
|---|---|
| Files that can run code | `.html` `.htm` `.xhtml` `.js` `.mjs` `.cjs` `.sh` `.bat` `.cmd` `.ps1` `.vbs` `.wsf` `.exe` `.com` `.scr` `.msi` `.dll` `.so` `.dylib` `.jar` `.app` `.lnk` `.desktop` `.py` |
| Other scripts, shortcuts, installers and active content | `.hta` `.jse` `.vbe` `.wsh` `.reg` `.scf` `.url` `.pif` `.msc` `.swf` `.xsl` `.xslt` `.svgz` (compressed SVG cannot be sanitized) `.appimage` `.pkg` `.deb` `.rpm` `.apk` |
| Macro-enabled Office files | `.docm` `.dotm` `.xlsm` `.xlam` `.pptm` `.potm` `.ppsm` `.sldm` |

---

The categories matter more than the lists: anything that a desktop system would execute or interpret
as a script is prohibited. A file MUST NOT be accepted by renaming it: an entry whose content is an
executable or script (for example begins with `MZ`, `\x7fELF`, a Mach-O header, or `#!`) is
prohibited whatever its name, unless it is a text-based file type such as Markdown.

**Archives.** An archive, compressed file or disk image (for example `.zip` `.tar` `.gz` `.tgz`
`.xz` `.bz2` `.7z` `.rar` `.cab` `.iso` `.dmg` `.img`) that **contains** any prohibited content is
itself prohibited. An implementation MAY choose how to meet that rule:

- block all archives, which is the simplest and RECOMMENDED for implementations that do not scan; or
- scan archives, including nested ones, and block those that contain prohibited content.

An implementation that blocks archives SHOULD do so by file extension. Document formats that are
themselves ZIP containers (such as `.docx`, `.xlsx`, `.pptx`, `.odt`, `.ods`, `.odp` and Keynote
`.key`) are documents, not archives, for the purpose of this rule.

---

**Other files.** A `.revel` file MAY contain other file types that REVELation itself does not use,
for example `.pdf`, `.pptx`, `.docx` and `.key`. The presentation folder is often a project folder
that also holds the source files and reference material a presentation was built from, and
`.revel` can carry them. These files are not interpreted by the format.

This is deliberately a grey area. An implementation MAY block or drop file types it does not
recognise, and a writer MUST NOT assume that another implementation preserves them. A reader that
preserves such files SHOULD NOT open them automatically, and SHOULD keep the platform's
download-origin mark on them (Mark-of-the-Web on Windows, the quarantine attribute on macOS) so
that the operating system's protections still apply when the user opens them. See also the
note on documents under "Conditionally permitted".

---

**Conditionally permitted.**

- **`.svg`.** SVG is rendered by the reader, and it can carry script. A writer or reader MAY scan
  SVG files and remove unsafe parts (script elements, event-handler attributes, `javascript:`
  URLs, `foreignObject`, external references), and MAY drop a file that cannot be made safe. A
  reader that does not scan SHOULD display SVG only in a context that does not run script, such as
  an image element.
- **Documents (`.pdf`, Office and OpenDocument files, and similar).** These can carry active
  content: script, launch actions, remote links, or embedded objects. The format does not
  interpret them, and the viewer that opens them later is responsible for most of the risk. An
  implementation MAY scan them and MAY drop or block a file that contains active content. It
  SHOULD NOT rewrite a document to remove such content, since that changes the document. A reader
  that opens these files itself SHOULD do so with scripting disabled. Keeping the download-origin
  mark (see "Other files" above) is the main protection for documents the reader does not open.

---

**Permitted.**

- **Media:** any valid web-compatible image, audio or video file that poses no inherent security
  risk, for example `.jpg` `.jpeg` `.png` `.gif` `.webp` `.avif` `.mp4` `.webm` `.mp3` `.ogg`
  `.opus` `.wav` `.m4a` `.aac`. A file with a media name whose content is an archive is a disguised
  archive and falls under the archive rule above.
- **Fonts:** for example `.woff` `.woff2` `.ttf` `.otf`.
- **Stylesheets:** `.css`.
- Markdown, `manifest.json`, media sidecars and thumbnails as defined in this specification.

**Enforcement.** A writer MUST NOT write a prohibited entry. A reader MUST NOT execute, and MUST NOT
extract, a prohibited entry. It SHOULD skip it, tell the user, and continue with the rest of the
archive, and it MAY reject the whole file. Older archives (including offline "standalone" website
exports, which contain HTML and scripts) fall under this rule: they are not `.revel` files, and a
runnable website SHOULD be shared as a plain `.zip` instead.

`_resources/` is reserved. Only `_resources/_media/` (section 7) is defined; a reader SHOULD ignore
anything else under it.

---

## 4. Presentation files

- The archive MUST contain at least one Markdown file (`*.md`) at the archive root.
- Each Markdown file is a presentation or a variant of one (for example a translation), with YAML
  front matter followed by slide Markdown. The syntax is defined by the REVELation Markdown
  specification linked above.
- File names are not significant to the format.
- The format does not designate a primary file. A reader that must pick one SHOULD prefer
  `presentation.md` and otherwise the first `.md` file in lexicographic order.
- Front matter MAY hide a file as an alternate (see the metadata reference); readers SHOULD honor
  that when listing presentations.

---

## 5. Thumbnails

A Markdown file MAY have a thumbnail, named by its `thumbnail` front matter field. When the field
is absent the thumbnail name is `<basename>.thumb.jpg`, where `<basename>` is the Markdown file
name without `.md`, in the same directory. Thumbnails are optional; readers MUST handle their
absence.

---

## 6. `manifest.json`

A UTF-8 JSON object at the archive root. Writers SHOULD include it. A reader MUST NOT reject an
archive because the manifest is absent or unparseable, though it MAY warn.

### 6.1 Fields

| Field | Type | Meaning |
|---|---|---|
| `presentationId` | string | RECOMMENDED. Lowercase UUID (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`) identifying the presentation across copies. Created once and preserved by every writer that rewrites the file. Readers use it to recognise that two copies are the same presentation. |
| `files` | array | RECOMMENDED. Integrity index, see 6.2. |
| `markdownFiles` | array of string | The Markdown files in the archive, as relative paths. Informational. |
| `presentations` | array of object | Optional per-file summary: `mdFile`, `title`, and `htmlFile`. `htmlFile` exists for compatibility with standalone exports and has no meaning in a `.revel`; readers SHOULD ignore it. |
| `appVersion` | string | RECOMMENDED. The version of the file, written as the REVELation release version (for example `1.0.13`) whose rules the file follows. Used to determine compatibility; see section 9. |
| `exportedAt` | string | ISO 8601 time the archive was created. Informational. |
| `savedAt` | string | ISO 8601 time of last save, written instead of `exportedAt` by some writers. Informational. |

---

Readers MUST ignore fields they do not recognise.

### 6.2 `files`

Each element describes one archive entry:

| Field | Type | Meaning |
|---|---|---|
| `filename` | string | Path relative to the archive root, using `/`. |
| `size` | number | Uncompressed size in bytes. |
| `modified` | string | ISO 8601 modification time. Informational. |
| `sha1` | string | Lowercase hexadecimal SHA-1 of the uncompressed content. |

---

Rules:

- The list SHOULD cover every file in the archive other than local-only state. A path with a
  dot-prefixed segment (`.thumbs/…`, `.hidden`) is local-only state: writers MUST NOT list it and
  readers MUST ignore it.
- Under `_resources/`, only `_resources/_media/` is listed.
- `manifest.json` itself is listed with `filename`, `size` and `modified` but **no** `sha1`, because
  it cannot contain its own hash.
- Entries SHOULD be sorted by `filename`.
- A file present in the archive but absent from `files` is permitted.

### 6.3 Verification

A reader that verifies integrity SHOULD, for every listed entry other than `manifest.json` that has
`size` or `sha1`, check that the file exists and that its size and SHA-1 match. It SHOULD report
mismatches to the user and MAY let the user continue. An entry with neither `size` nor `sha1` is
not checked.

---

### 6.4 Example

```json
{
  "appVersion": "1.0.13",
  "exportedAt": "2026-10-03T21:30:00.000Z",
  "markdownFiles": ["presentation.md", "presentation.es.md"],
  "presentations": [
    { "mdFile": "presentation.md", "title": "My Talk", "htmlFile": "index.html" }
  ],
  "presentationId": "6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f",
  "files": [
    { "filename": "manifest.json", "size": 1234, "modified": "2026-10-03T21:30:00.000Z" },
    { "filename": "presentation.md", "size": 2048, "modified": "2026-10-03T21:29:00.000Z", "sha1": "…40 hex digits…" }
  ]
}
```

---

## 7. Embedded media

Media MAY travel inside the file under `_resources/_media/`. How the Markdown refers to media (the
`media` map in front matter, aliases, and the URL fields) is defined in the REVELation Markdown
specification. This section covers only the files in the archive.

For each embedded item the archive contains:

| Entry | Purpose |
|---|---|
| `_resources/_media/<name>` | The media file. |
| `_resources/_media/<name>.json` | Metadata sidecar: a JSON object whose `filename` is `<name>`, plus optional fields such as `large_variant`. |
| `_resources/_media/<name>.thumbnail.jpg` | Optional thumbnail. |
| `_resources/_media/<large name>` | Optional large variant, named by `large_variant.filename` in the sidecar. |

A file without embedded media is valid. Media may instead be referenced by the URL fields in front
matter (`url_direct`, `url_library`, `url_origin`), which a reader MAY use to obtain media that is
not embedded.

---

## 8. Reading safely

A `.revel` file can come from an untrusted source. A reader:

- MUST reject, or skip, entries whose names are absolute or contain `..`, so that extraction can
  never write outside the destination.
- MUST NOT extract entries prohibited by section 3.1, and SHOULD NOT open extracted files
  automatically.
- SHOULD limit total uncompressed size, entry count and compression ratio before extracting.
- MUST treat the Markdown, front matter and all embedded files as untrusted input, and MUST NOT
  execute any content in the archive.
- SHOULD NOT fetch network resources named in the file without the user's consent.

---

## 9. Versioning and compatibility

- **The version of a `.revel` file is the `appVersion` attribute of its `manifest.json`.** It is the
  REVELation release version whose format rules the file follows. There is no separate format
  version number.
- A writer other than REVELation MUST write the REVELation version whose specification it
  implements, not its own product version.
- A reader determines compatibility by comparing `appVersion` with the REVELation version it
  implements. It SHOULD warn the user when the file is newer than the reader understands, and MAY
  continue on a best-effort basis. It SHOULD accept older versions.
- If `appVersion` is absent (hand-made files, or archives older than version stamping) the reader
  MUST NOT reject the file; it SHOULD treat the file as legacy.
- Changes are expected to be additive: new optional manifest fields and new optional entries. This
  is why readers MUST ignore fields and entries they do not recognise.

---

## 10. Minimal file

The smallest valid file is a ZIP whose root contains one Markdown file:

```
minimal.revel
└── presentation.md
```

Writers are encouraged to also include `manifest.json` with a `presentationId` and a complete
`files` list.

---

## 11. Serving over HTTP

Serve `.revel` files with the media type in section 1 so that browsers download them:

```
# nginx (mime.types)
application/vnd.revelation.presentation+zip  revel;

# Apache
AddType application/vnd.revelation.presentation+zip .revel
```

`Content-Disposition: attachment` is recommended. A server that does not know the extension and
sends `application/octet-stream` still delivers a usable file; `application/zip` is an acceptable
fallback.
