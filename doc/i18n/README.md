# Documentation Translations

This directory contains translated documentation files.

## Keeping translations current

English is the source of truth. When an English doc changes, update its Spanish copy in the same change and keep `<a id>`
anchors identical. If you cannot, list the file under Documentation debt in
[KNOWN_ISSUES.md](../dev/KNOWN_ISSUES.md). Framework docs live in `revelation/doc/i18n/<lang>/` (submodule).

---

## Structure

- One folder per language code (`es`, `fr`, etc.)
- Keep translated filenames aligned with the source files when possible
- Use one flat layout per language: `es/QUICKSTART.md`, `es/SETTINGS.md`, `es/dev/PEERING.md`.
  Do not add an `es/doc/...` mirror; the docs builder resolves both spellings to the same English source, so a second
  tree only creates duplicates.
- **Plugin READMEs are not translated here.** A plugin carries its own translations at `plugins/<id>/i18n/<lang>/README.md`,
  so the core app does not hold plugin docs and a plugin installed on its own brings its translations. The docs builder reads
  them straight from the plugin folder (the same way it reads the English README) and links to them from translated docs.
  Links inside a plugin translation are relative to its real location (for example `../../../../doc/i18n/es/dev/PEERING.md`).
- Preserve markdown structure and slide breaks (`---`) from source docs

---

## Current Languages

- `es` (Spanish)

## Source Files (Canonical)

Any English doc can have a translation. The docs builder (`lib/docsPresentationBuilder.js`) matches a translation to its
source by path (`es/dev/PEERING.md` is the translation of `doc/dev/PEERING.md`). The canonical sources are:

- `/README.md`, `/QUICKSTART.md`, `/LICENSE.md`
- `/doc/*.md` (GUI_REFERENCE, SETTINGS, TROUBLESHOOTING, API_REFERENCE, BUILDER_REFERENCE, MACOS_INSTALL)
- `/doc/dev/*.md` that appear in the in-app Help Contents (INSTALLING, BUILDING, PEERING, PLUGINS, README-PDF, BUILDER, BUILDER_EXTENSIONS, PUBLIC_RELAY, REVEL_FORMAT, REVEL_IMPLEMENTATION)
- `/plugins/<name>/README.md` (translations: `plugins/<name>/i18n/<lang>/README.md`)
- `/revelation/doc/*.md` (translated into `revelation/doc/i18n/<lang>/`)

## Known gaps (Spanish)

Translations that are missing or out of date relative to English are tracked in
[KNOWN_ISSUES.md](../dev/KNOWN_ISSUES.md#documentation-debt).

