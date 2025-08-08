const { BrowserWindow } = require('electron');
const path = require('path');

async function addMissingMediaDialog(slug, mdFile, AppContext) {
  const win = new BrowserWindow({
    width: 500,
    height: 400,
    modal: true,
    parent: AppContext.win,
    webPreferences: {
      preload: AppContext.preload
    }
  });

  const query = `?slug=${encodeURIComponent(slug)}&md=${encodeURIComponent(mdFile)}`;
  const url = `http://${AppContext.hostURL}:${AppContext.config.viteServerPort}/plugins_${AppContext.config.key}/addmedia/add-missing-media.html${query}`;
  win.setMenu(null);
  win.loadURL(url);
}

module.exports = { addMissingMediaDialog };
