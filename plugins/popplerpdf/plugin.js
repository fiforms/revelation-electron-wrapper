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
  version: '0.1.0',

  register(AppContext) {
    AppContext.log('[popplerpdf-plugin] Registered.');

    const pluginDir = __dirname;
    const popplerRoot = this.findPopplerRoot(pluginDir);
    if (!popplerRoot) {
      AppContext.log('[popplerpdf-plugin] No Poppler payload folder found; skipping Add Media path wiring.');
      return;
    }

    const binDir = path.join(popplerRoot, 'Library', 'bin');
    const pdftoppmPath = path.join(binDir, 'pdftoppm.exe');
    const pdfinfoPath = path.join(binDir, 'pdfinfo.exe');

    if (!fs.existsSync(pdftoppmPath) || !fs.existsSync(pdfinfoPath)) {
      AppContext.log('[popplerpdf-plugin] Poppler binaries missing; expected pdftoppm.exe and pdfinfo.exe.');
      return;
    }

    if (!AppContext.config.pluginConfigs || typeof AppContext.config.pluginConfigs !== 'object') {
      AppContext.config.pluginConfigs = {};
    }
    if (!AppContext.config.pluginConfigs.addmedia || typeof AppContext.config.pluginConfigs.addmedia !== 'object') {
      AppContext.config.pluginConfigs.addmedia = {};
    }

    AppContext.config.pluginConfigs.addmedia.pdftoppmPath = pdftoppmPath;
    AppContext.config.pluginConfigs.addmedia.pdfinfoPath = pdfinfoPath;

    if (AppContext.plugins?.addmedia?.config) {
      AppContext.plugins.addmedia.config.pdftoppmPath = pdftoppmPath;
      AppContext.plugins.addmedia.config.pdfinfoPath = pdfinfoPath;
    }

    saveConfig(AppContext.config);
    AppContext.log(`[popplerpdf-plugin] Configured Add Media Poppler paths from ${popplerRoot}`);
  },

  findPopplerRoot(pluginDir) {
    const entries = fs.readdirSync(pluginDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('poppler-'))
      .map((entry) => entry.name);

    if (!entries.length) {
      return null;
    }

    entries.sort((a, b) => this.compareVersionLabels(b, a));
    for (const folderName of entries) {
      const candidate = path.join(pluginDir, folderName);
      const binProbe = path.join(candidate, 'Library', 'bin', 'pdfimages.exe');
      if (fs.existsSync(binProbe)) {
        return candidate;
      }
    }
    return null;
  },

  compareVersionLabels(a, b) {
    const numsA = String(a).replace(/^poppler-/, '').split(/[^\d]+/).filter(Boolean).map(Number);
    const numsB = String(b).replace(/^poppler-/, '').split(/[^\d]+/).filter(Boolean).map(Number);
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
