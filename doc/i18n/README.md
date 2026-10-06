# Documentation Translations

This directory contains translated documentation files.

## Structure

- One folder per language code (`es`, `fr`, etc.)
- Keep translated filenames aligned with the source files when possible
- Use one flat layout per language: `es/QUICKSTART.md`, `es/SETTINGS.md`, `es/dev/PEERING.md`, `es/plugins/<name>/README.md`.
  Do not add an `es/doc/...` mirror; the docs builder resolves both spellings to the same English source, so a second
  tree only creates duplicates.
- Preserve markdown structure and slide breaks (`---`) from source docs

## Current Languages

- `es` (Spanish)

## Source Files (Canonical)

Any English doc can have a translation. The docs builder (`lib/docsPresentationBuilder.js`) matches a translation to its
source by path (`es/dev/PEERING.md` is the translation of `doc/dev/PEERING.md`). The canonical sources are:

- `/README.md`, `/QUICKSTART.md`, `/LICENSE.md`
- `/doc/*.md` (GUI_REFERENCE, SETTINGS, TROUBLESHOOTING, API_REFERENCE, BUILDER_REFERENCE, MACOS_INSTALL)
- `/doc/dev/*.md` that appear in the in-app Help Contents (INSTALLING, BUILDING, PEERING, PLUGINS, README-PDF, BUILDER, BUILDER_EXTENSIONS, PUBLIC_RELAY, REVEL_FORMAT, REVEL_IMPLEMENTATION)
- `/plugins/<name>/README.md`
- `/revelation/doc/*.md` (translated into `revelation/doc/i18n/<lang>/`)

## Known gaps (Spanish)

Translations that are missing or out of date relative to English are tracked in
[KNOWN_ISSUES.md](../dev/KNOWN_ISSUES.md#documentation-debt).

