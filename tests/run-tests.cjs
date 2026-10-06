#!/usr/bin/env node
// Entry point for `npm run tests`. Runs every tests/**/*.test.js with Node's built-in test runner
// (no extra dependencies). Pass file paths or --test-name-pattern=... to narrow a run. Nothing
// here launches Electron or opens a window; main-process modules load against tests/helpers/electron-stub.js.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function collect(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (entry.name.endsWith('.test.js')) out.push(full);
  }
  return out;
}

const args = process.argv.slice(2);
const explicit = args.filter((a) => !a.startsWith('-'));
const flags = args.filter((a) => a.startsWith('-'));
const files = explicit.length ? explicit : collect(__dirname).sort();

const result = spawnSync(process.execPath, ['--test', ...flags, ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
