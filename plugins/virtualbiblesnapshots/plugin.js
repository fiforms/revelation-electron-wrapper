// plugins/virtualbiblesnapshots/plugin.js
const path = require('path');
const fs = require('fs');
const { BrowserWindow } = require('electron');
const { mediaLibrary, downloadToTemp, addMediaToFrontMatter } = require('../../lib/mediaLibrary');

let AppCtx = null;

function appendSlidesMarkdown(presDir, mdFile, slidesMarkdown) {
  const mdPath = path.join(presDir, mdFile);
  if (!fs.existsSync(mdPath)) throw new Error(`Markdown not found: ${mdPath}`);
  fs.appendFileSync(mdPath, '\n\n' + slidesMarkdown + '\n');
}

function openPluginWindow(params = {}) {
  /*
  const { BrowserWindow } = require('electron');
  const win = new BrowserWindow({
    width: 1000,
    height: 800, modal: true, parent: AppCtx.win,
        webPreferences: { preload: AppCtx.preload }
  });
  */
  const url = `http://${AppCtx.hostURL}:${AppCtx.config.viteServerPort}/plugins_${AppCtx.config.key}/virtualbiblesnapshots/search.html?parames=${encodeURIComponent(JSON.stringify(params))}`;
  AppCtx.win.loadURL(url);
  // win.setMenu(null);
}

const plugin = {
  // optional client hook if you want menu entries later
  priority: 90,
  clientHookJS: 'client.js',
  pluginButtons: [
      { "title": "VRBM Media", "page": "search.html" },
    ],
  // Basic configurable bits
  configTemplate: [
    { name: 'apiBase', type: 'string', description: 'VRBM API base', default: 'https://content.vrbm.org' },
    { name: 'libraries', type: 'string', description: 'Comma-separated library paths (e.g. /thumbs,/videos,/illustrations)', default: '/thumbs,/videos,/illustrations' },
    { name: 'downloadIntoMedia', type: 'boolean', description: 'Copy picked assets into _media and use media aliases', default: true }
  ],

  register(AppContext) {
    AppCtx = AppContext;
    AppContext.log('[virtualbiblesnapshots] Registered!');

    // Find the "Plugins" menu item
    const pluginsMenu = AppCtx.mainMenuTemplate.find(menu => menu.label === 'Plugins');
    if (pluginsMenu && Array.isArray(pluginsMenu.submenu)) {
      pluginsMenu.submenu.push({
        label: 'Browse VRBM Library (Save to Media)',
        click: () => {
          openPluginWindow({
            slug: '',      // no presentation
            mdFile: '',    // no markdown file
            libraryOnly: true // custom flag so search.js knows to hide insert buttons
          });
        }
      });
    }
  },

  api: {
    // Open the search dialog
    'open-search': async (_event, { slug, mdFile }) => {
      const win = new BrowserWindow({
        width: 960, height: 720, modal: true, parent: AppCtx.win,
        webPreferences: { preload: AppCtx.preload }
      });
      win.setMenu(null);
      const key = AppCtx.config.key;
      const url = `http://${AppCtx.hostURL}:${AppCtx.config.viteServerPort}/plugins_${key}/virtualbiblesnapshots/search.html?slug=${encodeURIComponent(slug)}&md=${encodeURIComponent(mdFile)}&nosidebar=1`;
      win.loadURL(url);
      // win.webContents.openDevTools();
      return true;
    },

    // Called by the dialog when the user chooses an item
    'insert-selected': async (_event, { slug, mdFile, item, insertMode }) => {

      // We can either:
      //  A) link directly to the remote image
      //  B) download into _media and create a YAML `media:` alias + use magic image syntax
      //  C) download into the presentation folder and insert
      let slideMD = '';
      const presDir = slug ? path.join(AppCtx.config.presentationsDir, slug) : '';

      try {
        if (insertMode === 'media' || insertMode === 'save') {
          // Download original or medium URL
          const srcUrl = item.medurl || item.largeurl;
          if (!srcUrl) throw new Error('Selected item has no downloadable URL.');

          // Download to temp then hand off to media library to hash/store + thumbnail + metadata
          const tmpFile = await downloadToTemp(srcUrl);

          const cfg = AppCtx.plugins['virtualbiblesnapshots'].config;
          const libraryURL = `${cfg.apiBase}/browse/image/${item.md5}/${item.filename}`;
          const meta = {
            title: item.filename || 'VRBM Asset',
            keywords: item.dir || '',
            description: item.desc || '',
            attribution: item.attribution || '',
            license: item.license || '',
            url_origin: item.sourceurl || '',
            url_library: libraryURL || '',
            url_direct: srcUrl 
          };
          const hashedFilename = await mediaLibrary.hashAndStore(tmpFile, meta, AppCtx);
          if(AppCtx.config.preferHighBitrate && 
                  item.medurl && item.largeurl && item.ftype === 'video') {
              AppCtx.log('[virtualbiblesnapshots] Loading high-bitrate video variant...');
              const highFile = await downloadToTemp(item.largeurl);
              const highFileName = await mediaLibrary.hashAndStore(highFile, { url_direct: item.largeurl }, AppCtx, hashedFilename);
              meta.large_variant = {
                  filename: highFileName,
                };
          }

          if(insertMode === 'media' && mdFile && slug) {
            // Build a nice short tag name (best-effort)
            const baseTag = (item.filename || 'vrbm').split(/\W+/)[0].slice(0,7) || 'vrbm';
            const digits = (hashedFilename.match(/\d/g) || []).slice(0,3).join('') || '000';
            const tag = `${baseTag}${digits}`;

            // ADD YAML entry:
            addMediaToFrontMatter(path.join(presDir, mdFile), tag, {
              filename: hashedFilename,
              ...meta
            });

            // Emit YAML snippet (if user later wants to paste it into frontmatter) and slide
            // For now we just insert a slide referencing the alias; they can add YAML via Media Library UI too.
            slideMD = `![](${item.ftype === 'video' ? `media:${tag}` : `media:${tag}`})\n\n---`;

            appendSlidesMarkdown(presDir, mdFile, slideMD);
            AppCtx.log(`[virtualbiblesnapshots] Inserted slide media in ${slug}/${mdFile}`);
          }

        }
        else if (insertMode === 'inline') {
          // Download original or medium URL
          const srcUrl = item.largeurl || item.medurl;
          if (!srcUrl) throw new Error('Selected item has no downloadable URL.');

          // Pick a safe filename (remove weird chars, keep extension)
          let filename = '';
          try {
            const u = new URL(srcUrl);
            const filesParam = u.searchParams.get('files');
            if (filesParam) {
              filename = decodeURIComponent(filesParam);
            } else {
              filename = path.basename(u.pathname);
            }
          } catch {
            filename = path.basename(srcUrl.split('?')[0] || 'vrbm_image.jpg');
          }
          if (!path.extname(filename)) {
            filename += '.jpg'; // default extension
          }
          const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');

          // Destination: same folder as the mdFile
          const mdPath = path.join(presDir, mdFile);
          const presFolder = path.dirname(mdPath);
          const destPath = path.join(presFolder, safeFilename);

          // Download to temp then copy
          const tmpFile = await downloadToTemp(srcUrl);
          fs.copyFileSync(tmpFile, destPath);

          // Build relative path from mdFile to the image
          const relPath = path.relative(presFolder, destPath).replace(/\\/g, '/');

          const attrib = item.attribution || item.license || '';
          slideMD = `![](${relPath})\n\n${attrib ? `:ATTRIB:${attrib}\n\n` : ''}---`;
          appendSlidesMarkdown(presDir, mdFile, slideMD);
        }
        else if (insertMode === 'remote') {
          // Direct link mode
          const src = item.medurl || item.largeurl || (item.src && item.md5 ? `${item.src}/${item.letter}/${item.md5}.768.webp` : null) || item.sourceurl;
          if (!src) throw new Error('No usable image URL found.');
          const attrib = item.attribution || item.license || '';
          slideMD = `![](${src})\n\n${attrib ? `:ATTRIB:${attrib}\n\n` : ''}---`;
          appendSlidesMarkdown(presDir, mdFile, slideMD);
        }

        return { success: true };
      } catch (err) {
        AppCtx.error('[virtualbiblesnapshots] insert-selected failed:', err.message);
        return { success: false, error: err.message };
      }
    }
  }
};

module.exports = plugin;
