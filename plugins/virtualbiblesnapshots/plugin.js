// plugins/virtualbiblesnapshots/plugin.js
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const { BrowserWindow } = require('electron');

let AppCtx = null;

async function downloadToTemp(url) {
  let ext = '';
  let filename = '';

  try {
    const u = new URL(url);
    const filesParam = u.searchParams.get('files');
    if (filesParam) {
      filename = decodeURIComponent(filesParam);
      const m = filename.match(/\.[a-zA-Z0-9]+$/);
      if (m) ext = m[0];
    } else {
      // Fallback: try from pathname
      const pathParts = u.pathname.split('/');
      const last = pathParts[pathParts.length - 1];
      const m = last.match(/\.[a-zA-Z0-9]+$/);
      if (m) ext = m[0];
    }
  } catch (err) {
    console.warn('Could not parse URL for extension:', err);
  }

  if (!ext) {
    // Default to .jpg to satisfy mediaLibrary
    ext = '.jpg';
  }

  const tmp = path.join(os.tmpdir(), 'vbs_' + Date.now() + ext);

  await new Promise((resolve, reject) => {
    const file = fs.createWriteStream(tmp);
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', reject);
  });

  return tmp;
}

function appendSlidesMarkdown(presDir, mdFile, slidesMarkdown) {
  const mdPath = path.join(presDir, mdFile);
  if (!fs.existsSync(mdPath)) throw new Error(`Markdown not found: ${mdPath}`);
  fs.appendFileSync(mdPath, '\n\n' + slidesMarkdown + '\n');
}

const yaml = require('js-yaml');

function addMediaToFrontMatter(mdPath, tag, meta) {
  let content = fs.readFileSync(mdPath, 'utf8');
  let fmStart = content.indexOf('---\n');
  let fmEnd = -1;
  let frontMatter = {};
  let body = content;

  if (fmStart === 0) {
    fmEnd = content.indexOf('\n---', 4);
    if (fmEnd > 0) {
      const yamlText = content.slice(4, fmEnd).trim();
      frontMatter = yaml.load(yamlText) || {};
      body = content.slice(fmEnd + 4).trimStart();
    }
  }

  if (!frontMatter.media) {
    frontMatter.media = {};
  }
  if (!frontMatter.media[tag]) {
    frontMatter.media[tag] = {
      filename: meta.filename || '',
      title: meta.title || '',
      description: meta.description || '',
      copyright: meta.copyright || '',
      url: meta.url || ''
    };
  }

  const newYaml = '---\n' + yaml.dump(frontMatter) + '---\n';
  fs.writeFileSync(mdPath, newYaml + body, 'utf8');
}

const plugin = {
  // optional client hook if you want menu entries later
  priority: 90,
  clientHookJS: 'client.js',

  // Basic configurable bits
  configTemplate: [
    { name: 'apiBase', type: 'string', description: 'VRBM API base', default: 'https://content.vrbm.org' },
    { name: 'libraries', type: 'string', description: 'Comma-separated library paths (e.g. /thumbs,/videos,/illustrations)', default: '/thumbs,/videos,/illustrations' },
    { name: 'downloadIntoMedia', type: 'boolean', description: 'Copy picked assets into _media and use media aliases', default: true }
  ],

  register(AppContext) {
    AppCtx = AppContext;
    AppContext.log('[virtualbiblesnapshots] Registered!');
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
      const url = `http://${AppCtx.hostURL}:${AppCtx.config.viteServerPort}/plugins_${key}/virtualbiblesnapshots/search.html?slug=${encodeURIComponent(slug)}&md=${encodeURIComponent(mdFile)}`;
      win.loadURL(url);
      // win.webContents.openDevTools();
      return true;
    },

    // Called by the dialog when the user chooses an item
    'insert-selected': async (_event, { slug, mdFile, item, insertMode }) => {
      const presDir = path.join(AppCtx.config.presentationsDir, slug);

      // We can either:
      //  A) link directly to the remote image
      //  B) download into _media and create a YAML `media:` alias + use magic image syntax
      //  C) download into the presentation folder and insert
      let slideMD = '';
      try {
        if (insertMode === 'media') {
          // Download original or medium URL
          const srcUrl = item.medurl || item.largeurl;
          if (!srcUrl) throw new Error('Selected item has no downloadable URL.');

          // Download to temp then hand off to media library to hash/store + thumbnail + metadata
          const tmpFile = await downloadToTemp(srcUrl);

          // Reuse the mediaLibrary hasher/storer
          const { mediaLibrary } = require('../../lib/mediaLibrary');
          const meta = {
            title: item.filename || item.desc || 'VRBM Asset',
            description: item.desc || '',
            copyright: item.attribution || item.license || '',
            url: item.sourceurl || ''
          };
          const hashedFilename = await mediaLibrary.hashAndStore(tmpFile, meta, AppCtx);

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

          // Also, try to append media YAML to the top-level front matter automatically if desired:
          // Keeping it simple: we won’t auto-edit YAML here—users can paste YAML from Media Library context menu.

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
        }
        else if (insertMode === 'remote') {
          // Direct link mode
          const src = item.medurl || item.largeurl || (item.src && item.md5 ? `${item.src}/${item.letter}/${item.md5}.768.webp` : null) || item.sourceurl;
          if (!src) throw new Error('No usable image URL found.');
          const attrib = item.attribution || item.license || '';
          slideMD = `![](${src})\n\n${attrib ? `:ATTRIB:${attrib}\n\n` : ''}---`;
        }

        appendSlidesMarkdown(presDir, mdFile, slideMD);
        AppCtx.log(`[virtualbiblesnapshots] Inserted slide in ${slug}/${mdFile}`);
        return { success: true };
      } catch (err) {
        AppCtx.error('[virtualbiblesnapshots] insert-selected failed:', err.message);
        return { success: false, error: err.message };
      }
    }
  }
};

module.exports = plugin;
