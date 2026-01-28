const { BrowserWindow } = require('electron');
const path = require('path');

async function addMissingMediaDialog(slug, mdFile, AppContext, options = {}) {
  const win = new BrowserWindow({
    width: 500,
    height: 700,
    parent: AppContext.win,
    webPreferences: {
      preload: AppContext.preload
    }
  });

  const params = new URLSearchParams();
  params.set('slug', slug);
  params.set('md', mdFile);
  if (options.returnKey) params.set('returnKey', options.returnKey);
  if (options.insertTarget) params.set('insertTarget', options.insertTarget);
  if (options.tagType) params.set('tagType', options.tagType);
  if (options.origin) params.set('origin', options.origin);
  const query = `?${params.toString()}`;
  const url = `http://${AppContext.hostURL}:${AppContext.config.viteServerPort}/plugins_${AppContext.config.key}/addmedia/add-media.html${query}`;
  win.setMenu(null);
  win.loadURL(url);
}

module.exports = { addMissingMediaDialog };
