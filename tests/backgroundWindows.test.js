// Closing the main window must not be blocked by hidden background windows (thumbnail/export capture),
// and a second launch while the app lingers for them must reopen the main window (unless quit has begun).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { installElectronStub } = require('./helpers/electron-stub');

installElectronStub();
const { markBackground, isBackground, foregroundWindows, shouldRestoreMainWindow } = require('../lib/backgroundWindows');

const win = (destroyed = false) => ({ isDestroyed: () => destroyed });

test('foregroundWindows ignores the main window, destroyed windows and background windows', () => {
  const main = win();
  const capture = markBackground(win());
  const presentation = win();
  assert.ok(isBackground(capture));
  assert.ok(!isBackground(presentation));
  assert.deepStrictEqual(foregroundWindows([main, capture, win(true)], main), []);
  assert.deepStrictEqual(foregroundWindows([main, capture, presentation], main), [presentation]);
});

test('second instance: the main window is restored only if it is gone and quit has not started', () => {
  assert.strictEqual(shouldRestoreMainWindow({ mainWin: win(true), quitting: false }), true);
  assert.strictEqual(shouldRestoreMainWindow({ mainWin: null, quitting: false }), true);
  assert.strictEqual(shouldRestoreMainWindow({ mainWin: win(), quitting: false }), false);
  assert.strictEqual(shouldRestoreMainWindow({ mainWin: win(true), quitting: true }), false);
});

test('wiring: the capture window is marked background, the close guard and second-instance use the helpers', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  assert.match(read('lib/exportWindow.js'), /markBackground\(win\)/);
  assert.match(read('lib/mainWindow.js'), /foregroundWindows\(BrowserWindow\.getAllWindows\(\), AppContext\.win\)/);
  const main = read('main.js');
  assert.match(main, /shouldRestoreMainWindow\(/);
  assert.match(main, /appQuitting = true/);
});
