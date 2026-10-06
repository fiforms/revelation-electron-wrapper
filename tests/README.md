# Wrapper Tests

`npm run tests` runs everything here from the command line. It never launches Electron or opens a window.
`npm run tests:all` also runs the submodule's compiler suite (`revelation/tests`).

Uses Node's built-in test runner (`node:test`), so there are no extra dependencies. Needs Node 22.12+.

```
npm run tests                                  # everything
npm run tests -- tests/revelFormat.test.js     # one file
npm run tests -- --test-name-pattern="zip"     # tests whose name matches
```

## What is covered

| File | Checks |
|------|--------|
| `static.test.js` | `node --check` on all main-process JS; browser JS parses; all JSON valid; `lib/` header comments; every `ipcRenderer.invoke` channel in a preload has an `ipcMain` handler |
| `modules-load.test.js` | Every `lib/*.js` and `plugins/*/plugin.js` can be `require()`d (catches load-time errors) |
| `plugins.test.js` | Manifest fields, id matches folder, hook files exist, `api{}` members are functions, `defaultPlugins` exist |
| `revelFormat.test.js` | `.revel` rules: prohibited types, content sniffing, zip-slip, SVG sanitizing, size limits, pack/extract round trip |
| `peerAuth.test.js` | Peer signatures, domain separation, protocol constants match `revelation/peer-server.js` |
| `syncPlan.test.js` | Three-way sync planning and the per-machine peer store |
| `manifest.test.js` | `manifest.json` contents, presentationId, hash cache, exclusions |
| `apiServer.test.js` | Control API over loopback HTTP: auth, methods, formats, input validation |
| `mdvalidate.test.js` | The Markdown Validator plugin against small temp presentations |
| `misc-lib.test.js` | URL building, config helpers and `loadConfig`, origin marks |

## Not covered

Anything that needs a real window or the Electron runtime: BrowserWindow behavior, IPC round trips, menus, the Vite
server process, mDNS, ffmpeg/LibreOffice/Poppler conversions, and the admin pages' DOM. Test those by hand.

## Writing tests

- Name files `*.test.js`; the runner picks them up automatically.
- A test that loads anything under `lib/` or a plugin must call `installElectronStub()` from `helpers/electron-stub.js`
  **before** the first `require`. Its `app.getPath()` points at a throwaway temp directory, so tests never touch the real
  user profile. `helpers/raw-zip.js` builds hostile ZIPs (real zip libraries normalise `../` names away).
- Use `tmpDir()` from `helpers/paths.js` and remove what you create.
- Prefer injecting dependencies (see `originMark.js`) or env overrides (`REVELATION_SYNC_STORE_PATH`) over mocking.

## Before packaging

`npm run tests:ci` (`scripts/run-tests-for-build.js`) runs this suite and the submodule's, always both, and exits non-zero
if either fails. The `dist-win`, `dist-linux`, `dist-mac` and `dist-mac-intel` scripts run it first, so a failing test
stops the build before anything is packaged. Output goes to `test-results/` (`wrapper.log`, `wrapper-junit.xml`,
`revelation.log`, `revelation-actual/` on a fixture mismatch, `summary.txt`). The GitHub workflow uploads that folder as the
`test-results-*` artifact even when tests fail, and sets `SKIP_BUILD_TESTS=1` on the build step so the suite is not run twice.

Neither suite ships: `tests/` and `test-results/` are excluded by `build.files` in `package.json`, and the submodule's
`tests/` by the `extraResources` filter for `revelation`.
