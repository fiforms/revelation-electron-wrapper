// plugins/popplerpdf/plugin.js
//
// Poppler PDF binaries: bundles pdftoppm/pdfinfo for the Add Media plugin's PDF
// import (Windows x64, macOS arm64/x64; no Linux payload, Linux uses PATH).
//
// On register(): finds the newest poppler-* payload folder in this directory
// built for the current platform/arch, and if the binaries exist, writes
// pluginConfigs.addmedia.pdftoppmPath / pdfinfoPath into the app config (both
// the persisted config and the live addmedia plugin config) and saveConfig()s
// only when a path actually changed. Silently does nothing when no payload is present.
//
// Hooks: main-process only, priority 93, no clientHookJS, no IPC, no config
// keys of its own. Distributed as a per-platform ZIP (see README.md and
// POPPLER_PLUGIN_DOWNLOADS in lib/popplerRelease.js), not in the source tree by default.

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let saveConfig;
try {
  ({ saveConfig } = require(path.join(app.getAppPath(), 'lib', 'configManager')));
} catch (_err) {
  ({ saveConfig } = require('../../lib/configManager'));
}

const popplerPdfPlugin = {
  priority: 93,

  register(AppContext) {
    AppContext.log('[popplerpdf-plugin] Registered.');

    const pluginDir = __dirname;
    const popplerRoot = this.findPopplerRoot(pluginDir);
    if (!popplerRoot) {
      AppContext.log('[popplerpdf-plugin] No Poppler payload folder found; skipping Add Media path wiring.');
      return;
    }

    const { pdftoppmPath, pdfinfoPath } = this.toolPaths(popplerRoot);

    if (!fs.existsSync(pdftoppmPath) || !fs.existsSync(pdfinfoPath)) {
      AppContext.log(`[popplerpdf-plugin] Poppler binaries missing; expected ${pdftoppmPath} and ${pdfinfoPath}.`);
      return;
    }

    if (!AppContext.config.pluginConfigs || typeof AppContext.config.pluginConfigs !== 'object') {
      AppContext.config.pluginConfigs = {};
    }
    if (!AppContext.config.pluginConfigs.addmedia || typeof AppContext.config.pluginConfigs.addmedia !== 'object') {
      AppContext.config.pluginConfigs.addmedia = {};
    }

    const addmediaCfg = AppContext.config.pluginConfigs.addmedia;
    const changed = addmediaCfg.pdftoppmPath !== pdftoppmPath || addmediaCfg.pdfinfoPath !== pdfinfoPath;
    addmediaCfg.pdftoppmPath = pdftoppmPath;
    addmediaCfg.pdfinfoPath = pdfinfoPath;

    if (AppContext.plugins?.addmedia?.config) {
      AppContext.plugins.addmedia.config.pdftoppmPath = pdftoppmPath;
      AppContext.plugins.addmedia.config.pdfinfoPath = pdfinfoPath;
    }

    if (changed) saveConfig(AppContext.config);
    AppContext.log(`[popplerpdf-plugin] Configured Add Media Poppler paths from ${popplerRoot}`);
  },

  // Windows payloads (poppler-windows layout) keep the tools in Library/bin.
  // macOS payloads from scripts/build-popplerpdf-mac.js keep wrapper scripts in
  // bin/ that point fontconfig at the bundled fonts.conf; Add Media must call
  // those, not the real binaries in libexec/.
  toolPaths(popplerRoot) {
    if (process.platform === 'win32') {
      const binDir = path.join(popplerRoot, 'Library', 'bin');
      return {
        pdftoppmPath: path.join(binDir, 'pdftoppm.exe'),
        pdfinfoPath: path.join(binDir, 'pdfinfo.exe')
      };
    }
    const binDir = path.join(popplerRoot, 'bin');
    return {
      pdftoppmPath: path.join(binDir, 'pdftoppm'),
      pdfinfoPath: path.join(binDir, 'pdfinfo')
    };
  },

  // A payload folder is usable only on the platform and architecture it was
  // built for: poppler-<ver> for Windows, poppler-<ver>-macos-<arch> for macOS.
  payloadMatchesThisMachine(folderName) {
    if (process.platform === 'win32') {
      return !/-macos-/.test(folderName);
    }
    if (process.platform === 'darwin') {
      return folderName.endsWith(`-macos-${process.arch}`);
    }
    return false;
  },

  findPopplerRoot(pluginDir) {
    const entries = fs.readdirSync(pluginDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('poppler-'))
      .map((entry) => entry.name)
      .filter((name) => this.payloadMatchesThisMachine(name));

    if (!entries.length) {
      return null;
    }

    entries.sort((a, b) => this.compareVersionLabels(b, a));
    for (const folderName of entries) {
      const candidate = path.join(pluginDir, folderName);
      if (fs.existsSync(this.toolPaths(candidate).pdftoppmPath)) {
        return candidate;
      }
    }
    return null;
  },

  compareVersionLabels(a, b) {
    const numsA = String(a).replace(/^poppler-/, '').replace(/-macos-.*$/, '').split(/[^\d]+/).filter(Boolean).map(Number);
    const numsB = String(b).replace(/^poppler-/, '').replace(/-macos-.*$/, '').split(/[^\d]+/).filter(Boolean).map(Number);
    const maxLen = Math.max(numsA.length, numsB.length);
    for (let i = 0; i < maxLen; i += 1) {
      const av = numsA[i] || 0;
      const bv = numsB[i] || 0;
      if (av !== bv) return av - bv;
    }
    return 0;
  }
};

module.exports = popplerPdfPlugin;
