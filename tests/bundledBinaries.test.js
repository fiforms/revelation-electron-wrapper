// Bundled helper binaries (bin/effectgenerator, bin/ffmpeg/ffmpeg[.exe]): each must start and report a version on this platform.
// Catches a wrong-architecture or truncated download (fetch-effectgenerator.js, fetch-ffmpeg.js) before packaging.
// A missing binary skips the test (SKIP_BLOBS, or Linux where ffmpeg is the system one); with
// REQUIRE_BUNDLED_BINARIES=1 (set by scripts/run-tests-for-build.js) a missing binary fails instead.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const binDir = path.join(__dirname, '..', 'bin');
const exe = (name) => (process.platform === 'win32' ? `${name}.exe` : name);
const required = process.env.REQUIRE_BUNDLED_BINARIES === '1';

function checkBinary(t, file, args, expectedOutput) {
  if (!fs.existsSync(file)) {
    if (required) assert.fail(`Bundled binary missing: ${file} (run npm run fetch-blobs)`);
    t.skip(`not present: ${file}`);
    return;
  }
  const res = spawnSync(file, args, { encoding: 'utf8', timeout: 20000, windowsHide: true });
  assert.ifError(res.error);
  assert.strictEqual(res.status, 0, `${file} exited ${res.status}: ${res.stderr}`);
  assert.match(`${res.stdout}${res.stderr}`, expectedOutput);
}

test('bin/effectgenerator runs on this platform', (t) => {
  checkBinary(t, path.join(binDir, exe('effectgenerator')), ['--version'], /Effect Generator.*version/i);
});

test('bin/ffmpeg runs on this platform (macOS and Windows bundle one)', (t) => {
  const file = path.join(binDir, 'ffmpeg', exe('ffmpeg'));
  if (!fs.existsSync(file) && process.platform !== 'darwin' && process.platform !== 'win32') {
    t.skip('no bundled ffmpeg on this platform; the system ffmpeg is used');
    return;
  }
  checkBinary(t, file, ['-version'], /ffmpeg version/i);
});
