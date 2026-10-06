// Window Title Token Module
//
// Wayland compositors can't be told which window to move by PID, because every
// Electron window shares one. Instead we set the window title to a random token
// that the compositor-side helper (GNOME extension or KWin script) matches exactly.

const { app } = require('electron');
const crypto = require('crypto');

// Exports { withTitleToken }. Used by gnomeWindowHelper.placeWindow and kwinWindowHelper.placeWindow only.
const TOKEN_PREFIX = 'revelation-place:';

// Runs fn(token) with win's title set to a fresh token, then restores the page title.
async function withTitleToken(win, fn) {
  const hex = crypto.randomBytes(16).toString('hex');
  const token = `${TOKEN_PREFIX}${hex}`;
  // Stop page title changes from replacing the token while the helper looks for the window.
  const holdTitle = (event) => event.preventDefault();
  win.on('page-title-updated', holdTitle);
  win.setTitle(token);
  try {
    return await fn(token, hex);
  } finally {
    if (!win.isDestroyed()) {
      win.removeListener('page-title-updated', holdTitle);
      win.setTitle(win.webContents.getTitle() || app.getName());
    }
  }
}

module.exports = { withTitleToken };
