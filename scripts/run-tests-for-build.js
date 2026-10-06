// Pre-packaging test gate: runs the wrapper suite (tests/) and the submodule suite
// (revelation/tests) and exits non-zero if either fails, so a broken build is never packaged.
// Called first by the dist-* npm scripts (`npm run tests:ci`) and by .github/workflows.
// Both suites always run, even if the first fails, so one report shows every failure.
// Output goes to test-results/ (gitignored, excluded from the installer by package.json "build.files"):
//   wrapper.log, wrapper-junit.xml, revelation.log, revelation-actual/ (diffs written on a fixture
//   mismatch), summary.txt. The GitHub workflow uploads that folder as an artifact.
// Set SKIP_BUILD_TESTS=1 to skip (the GitHub workflow runs this as its own step first, so that the
// results are uploaded even on failure, and sets it on the build step to avoid a second run).
// The wrapper suite runs with REQUIRE_BUNDLED_BINARIES=1, so a missing bin/effectgenerator (or bin/ffmpeg on
// macOS/Windows) fails the gate instead of skipping tests/bundledBinaries.test.js.
// Spawns node directly (no npm, no shell) so it behaves the same on Windows, macOS and Linux.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const outDir = path.join(rootDir, 'test-results');

function runSuite(name, args, cwd, logFile, env = {}) {
  return new Promise((resolve) => {
    const log = fs.createWriteStream(path.join(outDir, logFile));
    console.log(`\n=== ${name} tests ===`);
    const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', (chunk) => { process.stdout.write(chunk); log.write(chunk); });
    }
    child.on('error', (err) => { log.write(`Could not start: ${err.message}\n`); log.end(); resolve(1); });
    child.on('close', (code) => log.end(() => resolve(code === null ? 1 : code)));
  });
}

(async () => {
  if (process.env.SKIP_BUILD_TESTS === '1') {
    console.log('SKIP_BUILD_TESTS=1: skipping pre-build tests.');
    return;
  }
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  // The submodule writes failing fixture output to tests/_actual; clear stale results first.
  const actualDir = path.join(rootDir, 'revelation', 'tests', '_actual');
  fs.rmSync(actualDir, { recursive: true, force: true });

  const results = [];
  results.push(['wrapper', await runSuite('Wrapper', [
    path.join('tests', 'run-tests.cjs'),
    '--test-reporter=spec', '--test-reporter-destination=stdout',
    '--test-reporter=junit', `--test-reporter-destination=${path.join(outDir, 'wrapper-junit.xml')}`
  ], rootDir, 'wrapper.log', { REQUIRE_BUNDLED_BINARIES: '1' })]);
  results.push(['revelation', await runSuite('Revelation submodule', [
    path.join('tests', 'run-tests.cjs')
  ], path.join(rootDir, 'revelation'), 'revelation.log')]);

  if (fs.existsSync(actualDir)) {
    fs.cpSync(actualDir, path.join(outDir, 'revelation-actual'), { recursive: true });
  }

  const summary = results.map(([name, code]) => `${name}: ${code === 0 ? 'PASS' : `FAIL (exit ${code})`}`).join('\n');
  fs.writeFileSync(path.join(outDir, 'summary.txt'), `${summary}\n`);
  console.log(`\n=== Test summary ===\n${summary}`);

  const failed = results.some(([, code]) => code !== 0);
  if (failed) console.error('\n❌ Tests failed; not continuing to package. Details in test-results/.');
  process.exit(failed ? 1 : 0);
})();
