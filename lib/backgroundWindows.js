/**
 * backgroundWindows.js -- registry of hidden, user-invisible BrowserWindows (offscreen capture for thumbnails,
 * exports) so they don't count as "other windows" when the user closes the main window.
 *
 * markBackground(win): call right after creating the hidden window. isBackground(win).
 * foregroundWindows(windows, mainWin): the windows that should block closing the main window.
 * shouldRestoreMainWindow({ mainWin, quitting }): second-instance decision -- true when the main window was
 *   closed while background work kept the app alive, and no real quit has started yet.
 *
 * Callers: lib/exportWindow.js (marks), lib/mainWindow.js (close guard), main.js (second-instance, before-quit).
 * Shutdown model: closing the main window with only background windows left lets them finish; Electron's
 *   'window-all-closed' (main.js) then quits and 'before-quit' stops Vite, so the capture still has its server.
 *   A second launch in that gap reopens the main window, which cancels the shutdown (window-all-closed
 *   no longer fires because a window exists again). Once 'before-quit' has run, the new instance loses.
 */

const background = new WeakSet();

function markBackground(win) {
  if (win && typeof win === 'object') background.add(win);
  return win;
}

function isBackground(win) {
  return !!win && background.has(win);
}

function foregroundWindows(windows, mainWin) {
  return (windows || []).filter((win) => win !== mainWin && !win.isDestroyed() && !isBackground(win));
}

function shouldRestoreMainWindow({ mainWin, quitting }) {
  if (quitting) return false;
  return !mainWin || mainWin.isDestroyed();
}

module.exports = { markBackground, isBackground, foregroundWindows, shouldRestoreMainWindow };
