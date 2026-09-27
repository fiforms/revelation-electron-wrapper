// Frameless splash screen shown the moment Electron is ready, before Vite
// and the other startup work run. It is a static page loaded from disk, so it
// paints even when the machine is under load and the server is slow to start.
//
// The main window is created hidden; handOffTo() shows it and closes the
// splash once the main window has loaded and had time to settle.

const path = require('path');
const { BrowserWindow } = require('electron');

// Minimum time the splash stays visible, so it never just flickers.
const SPLASH_MIN_MS = 1500;
// Settle time after the main window finishes loading, before switching.
const MAIN_SETTLE_MS = 1500;
// Switch anyway if the main window never reports ready. Longer than the
// 120s Vite wait plus main-window load retries.
const SPLASH_MAX_MS = 180000;

const splashWindow = {
    win: null,
    _hidden: false,
    _shownAt: 0,
    _mainWindow: null,
    _handOffTimer: null,
    _fallbackTimer: null,

    show() {
        if (this.win && !this.win.isDestroyed()) return;

        const isWin = process.platform === 'win32';
        this.win = new BrowserWindow({
            width: 800,
            height: 450,
            frame: false,
            resizable: false,
            movable: true,
            minimizable: false,
            maximizable: false,
            fullscreenable: false,
            alwaysOnTop: true,
            center: true,
            show: false,
            backgroundColor: '#120d2e',
            icon: path.join(__dirname, '..', 'assets', isWin ? 'icon.ico' : 'icon.png'),
            webPreferences: {
                sandbox: true,
                contextIsolation: true,
                nodeIntegration: false
            }
        });

        // Until the page paints, count from creation so a slow first paint
        // doesn't stretch the minimum display time.
        this._shownAt = Date.now();
        this.win.once('ready-to-show', () => {
            if (this.win && !this.win.isDestroyed() && !this._hidden) {
                this.win.show();
                this._shownAt = Date.now();
            }
        });
        this.win.on('closed', () => {
            this.win = null;
        });
        this.win.loadFile(path.join(__dirname, '..', 'assets', 'splash', 'splash.html'));

        this._fallbackTimer = setTimeout(() => this._switchToMain(), SPLASH_MAX_MS);
    },

    // Temporarily step aside (e.g. for the first-run language prompt).
    hide() {
        this._hidden = true;
        if (this.win && !this.win.isDestroyed()) this.win.hide();
    },

    unhide() {
        if (!this._hidden) return;
        this._hidden = false;
        if (this.win && !this.win.isDestroyed()) {
            this.win.show();
            this._shownAt = Date.now();
        }
    },

    // Keep mainWindow hidden until `readyPromise` settles (the main window is
    // showing the app or an error page) plus MAIN_SETTLE_MS, and the splash has
    // been up SPLASH_MIN_MS; then show it and close the splash.
    handOffTo(mainWindow, readyPromise) {
        if (!mainWindow || mainWindow.isDestroyed()) {
            this.close();
            return;
        }
        if (!this.win || this.win.isDestroyed()) {
            mainWindow.show();
            return;
        }
        this._mainWindow = mainWindow;

        const onReady = () => {
            if (this._mainWindow !== mainWindow) return;
            const minRemaining = SPLASH_MIN_MS - (Date.now() - this._shownAt);
            const delay = Math.max(MAIN_SETTLE_MS, minRemaining);
            this._handOffTimer = setTimeout(() => this._switchToMain(), delay);
        };
        Promise.resolve(readyPromise).then(onReady, onReady);

        mainWindow.once('closed', () => {
            if (this._mainWindow === mainWindow) this._mainWindow = null;
            this.close();
        });
    },

    _switchToMain() {
        const main = this._mainWindow;
        this._mainWindow = null;
        if (main && !main.isDestroyed() && !main.isVisible()) {
            main.show();
            main.focus();
        }
        // The splash is always-on-top, so closing it just after the main
        // window is shown avoids any gap with nothing on screen.
        setTimeout(() => this.close(), 50);
    },

    close() {
        if (this._handOffTimer) {
            clearTimeout(this._handOffTimer);
            this._handOffTimer = null;
        }
        if (this._fallbackTimer) {
            clearTimeout(this._fallbackTimer);
            this._fallbackTimer = null;
        }
        if (this.win && !this.win.isDestroyed()) this.win.close();
        this.win = null;
    }
};

module.exports = { splashWindow };
