# CLAUDE.md — REVELation Snapshot Presenter

This file is read automatically by Claude Code on startup.

Full developer and agent onboarding reference: **[AGENTS.md](AGENTS.md)** — read it first for project structure, tech stack, key entry points, the documentation index, and architecture rules.

## Quick orientation

- **How it fits together / where to change things:** [doc/dev/ARCHITECTURE.md](doc/dev/ARCHITECTURE.md) (§10 is a "where do I change…?" table).
- **Open bugs:** [doc/dev/KNOWN_ISSUES.md](doc/dev/KNOWN_ISSUES.md). **Duplicated code to consolidate:** [doc/dev/REFACTOR_CANDIDATES.md](doc/dev/REFACTOR_CANDIDATES.md). **Deferred work and security findings:** [TODO.md](TODO.md).
- Every `lib/*.js`, builder module, plugin entry file and main framework module starts with a header comment (purpose, callers, IPC/routes, gotchas) — read it before editing the file.
- This is **two git repos**: the wrapper and the `revelation/` submodule. Changes inside `revelation/` are committed there first, then the pointer is updated here.

## Working rules

- **Don't launch Electron or any GUI app.** The owner tests the UI themselves.
- **Don't create git commits or pushes** unless asked; the owner handles git.
- **Reuse before you write.** Front-matter parsing, HTML escaping, slugify, path-containment checks, HTTP downloads and server-URL building each already exist in several copies. Use the best existing one; don't add another. See REFACTOR_CANDIDATES.md.
- **Confine renderer-supplied paths** (slug, filename, mdFile) to the presentations directory, and escape anything placed in `innerHTML` (including attributes). Existing code that doesn't do this is listed in KNOWN_ISSUES.md — don't copy it.
- **Server model:** one Vite process on port 8000 hosting three Socket.IO servers on distinct paths, plus the control API on 8900 (`lib/apiServer.js`). Don't add a separate remote-broker process.
- **Plugins** use `api{}` / `presentationApi{}` (via `plugin-trigger` IPC), never `ipcMain` directly. First-run enablement is `defaultPlugins` in `lib/configManager.js`; `defaultEnabled` in `plugin.js` is not read.
- Run `npm run tests` after wrapper changes (CLI only, no GUI; see [tests/README.md](tests/README.md)). `npm run tests:all` also runs the submodule compiler suite (`cd revelation && npm run tests`). Add a test when you fix a bug in `lib/` or a plugin's main half.
- When you fix something listed in KNOWN_ISSUES.md or REFACTOR_CANDIDATES.md, remove it there and note it in CHANGELOG.md.
