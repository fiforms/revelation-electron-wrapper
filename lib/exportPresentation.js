const { dialog, app } = require('electron');
const archiver = require('archiver');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { MANIFEST_FILENAME, buildPresentationManifest } = require('./presentationManifest');

const REVELATION_ROOT = path.resolve(__dirname, '../revelation');
const FONT_CDN_BASE = 'https://www.pastordaniel.net/bigmedia/revelation/fonts/';

function encodeHTML(str) {
  return str.replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
}

function sanitizeInlineJSON(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function normalizeTagList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((tag) => typeof tag === 'string' && tag.trim().length > 0)
    .map((tag) => tag.trim());
}

function createOfflineHTML(slug, mdFile, markdownText, remoteServer, includeMedia, appVersion, showSplashscreen, extras = {}) {
  const markdownEscaped = encodeHTML(markdownText);
  const mediaLink = includeMedia ? `window.mediaPath = "_resources/_media";` : '';
  const versionLine = appVersion ? `window.exportedAppVersion = "${appVersion}";` : '';
  const splashEnabled = showSplashscreen ? 'true' : 'false';
  const headTags = normalizeTagList(extras.headTags).join('\n  ');
  const bodyTags = normalizeTagList(extras.bodyTags).join('\n  ');
  const offlinePluginBootstrap = extras.pluginList && Object.keys(extras.pluginList).length > 0
    ? `<script>window.__offlinePluginList = ${sanitizeInlineJSON(extras.pluginList)};</script>`
    : '';
  const splashscreen = `<script>
    window.splashScreenEnabled = ${splashEnabled}; // Set to false to disable splash screen
  </script>`;
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${slug} (Offline)</title>
  <link rel="stylesheet" href="_resources/css/reveal.css">
  <link id="theme-stylesheet" rel="stylesheet" href="">
  <style type="text/css">
    body.hidden {
      opacity: 0;
      transition: opacity 0.8s ease-in-out;
      background: #000; /* avoid white flash */
      overflow: hidden; /* prevent scroll during load */
    }
    #revelation-offline-markdown {
      display: none;
    }
  </style>
  <script>
    window.revealRemoteServer = "${remoteServer}";
    ${mediaLink}
    ${versionLine}
  </script>
  ${headTags}
</head>
<body class="hidden">
    <div class="reveal">
    <div class="slides">
      <section id="markdown-container">Loading...</section>
    </div>
  </div>
  <div id="fixed-overlay-wrapper">
  </div>
  <div id="fixed-tint-wrapper">
  </div>
  <!-- Invisible Audio Player -->
  <audio id="background-audio-player" loop></audio>
  <!-- DO NOT EDIT THE ESCAPED MARKDOWN BELOW, IT WILL BE OVERWRITTEN. -->

  <textarea id="revelation-offline-markdown">${markdownEscaped}</textarea>
  </section>

  <script type="text/javascript">
  const md_textarea = document.getElementById('revelation-offline-markdown');
  if (md_textarea) {
    window.offlineMarkdown = md_textarea.textContent;
    md_textarea.remove();
  } else {
    console.warn('[offline.js] No embedded markdown found in <textarea>');
  }
  </script>

  ${bodyTags}
  ${offlinePluginBootstrap}
  ${splashscreen}
  <script src="_resources/offline-bundle.js"></script>
  <script src="_resources/translate.js"></script>
</body>
</html>`;
}

function parseFrontMatter(mdText) {
  const match = mdText.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return {};
  try {
    return yaml.load(match[1]) || {};
  } catch (err) {
    console.warn(`⚠️ Could not parse YAML: ${err.message}`);
    return {};
  }
}

function createIndexMenuHTML(slug, presentations) {
  const listItems = presentations.map((pres) => {
    return `      <li><a href="${pres.htmlFile}">${encodeHTML(pres.title)}</a><span class="meta">${encodeHTML(pres.mdFile)}</span></li>`;
  }).join('\n');

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${encodeHTML(slug)} (Offline)</title>
  <style>
    :root {
      color-scheme: light;
    }
    body {
      margin: 0;
      font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, "URW Palladio L", serif;
      background: #f7f1e7;
      color: #1b1b1b;
    }
    .wrap {
      max-width: 900px;
      margin: 0 auto;
      padding: 3rem 1.5rem 4rem;
    }
    h1 {
      font-size: 2.2rem;
      margin: 0 0 0.5rem;
      letter-spacing: 0.02em;
    }
    p {
      margin: 0 0 2rem;
      color: #4b4035;
    }
    ul {
      list-style: none;
      padding: 0;
      margin: 0;
      display: grid;
      gap: 0.75rem;
    }
    li {
      background: #fffaf3;
      border: 1px solid #e6d9c8;
      border-radius: 12px;
      padding: 0.9rem 1rem;
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 1rem;
    }
    a {
      color: #5b2b0c;
      font-weight: 600;
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
    .meta {
      color: #7b6b5c;
      font-size: 0.9rem;
      white-space: nowrap;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>${encodeHTML(slug)} (Offline Export)</h1>
    <p>Select a presentation to open.</p>
    <ul>
${listItems}
    </ul>
  </div>
</body>
</html>`;
}

function rewriteCssForExport(cssText) {
  return cssText
    .replace(/@import\s+url\(\.?\/fonts\/(.+?)\);/g, `@import url(${FONT_CDN_BASE}$1);`)
    .replace(/@import\s+"\.?\/fonts\/(.+?)";/g, `@import url(${FONT_CDN_BASE}$1);`)
    .replace(/url\(["']?fonts\/symbols\/aigenerated\.webp["']?\)/g, `url("${FONT_CDN_BASE}symbols/aigenerated.webp")`);
}

function safeRequireFresh(modulePath) {
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

function isInsideDir(targetPath, basePath) {
  const relative = path.relative(basePath, targetPath);
  return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function toPosixRel(inputPath) {
  return String(inputPath || '').replace(/\\/g, '/');
}

async function collectPluginOfflineExportData(AppCtx, folderPath, resourcesDir, includeMedia, presentations) {
  const pluginFolder = AppCtx?.config?.pluginFolder;
  if (!pluginFolder || !fs.existsSync(pluginFolder)) {
    return { headTags: [], bodyTags: [], pluginList: {} };
  }

  const headTags = [];
  const bodyTags = [];
  const pluginList = {};

  for (const [pluginName, plugin] of Object.entries(AppCtx.plugins || {})) {
    const pluginDir = path.join(pluginFolder, pluginName);
    const offlineHookPath = path.join(pluginDir, 'offline.js');
    if (!fs.existsSync(offlineHookPath)) {
      continue;
    }

    let offlineHookModule;
    try {
      offlineHookModule = safeRequireFresh(offlineHookPath);
    } catch (err) {
      throw new Error(`[offline-export/${pluginName}] Failed to load offline.js: ${err.message}`);
    }

    const exportHook = typeof offlineHookModule?.export === 'function'
      ? offlineHookModule.export
      : typeof offlineHookModule?.onExport === 'function'
      ? offlineHookModule.onExport
      : null;

    if (!exportHook) {
      continue;
    }

    const context = {
      pluginName,
      plugin,
      pluginDir,
      pluginConfig: plugin?.config || {},
      presentationFolder: folderPath,
      resourcesDir,
      includeMedia,
      presentations,
      appContext: AppCtx
    };

    let hookResult = {};
    try {
      hookResult = await exportHook(context);
    } catch (err) {
      throw new Error(`[offline-export/${pluginName}] export() failed: ${err.message}`);
    }

    if (!hookResult || typeof hookResult !== 'object') {
      continue;
    }

    headTags.push(...normalizeTagList(hookResult.headTags));
    bodyTags.push(...normalizeTagList(hookResult.bodyTags));

    if (hookResult.pluginListEntry && typeof hookResult.pluginListEntry === 'object') {
      pluginList[pluginName] = hookResult.pluginListEntry;
    }

    const copyItems = Array.isArray(hookResult.copy) ? hookResult.copy : [];
    for (const item of copyItems) {
      if (!item || typeof item !== 'object') continue;

      const fromInput = String(item.from || '').trim();
      const toInput = toPosixRel(item.to || '').trim();
      if (!fromInput || !toInput) continue;

      const fromPath = path.isAbsolute(fromInput) ? fromInput : path.join(pluginDir, fromInput);
      if (!fs.existsSync(fromPath)) {
        throw new Error(`[offline-export/${pluginName}] Missing copy source: ${fromPath}`);
      }

      if (path.isAbsolute(toInput) || toInput.startsWith('..') || toInput.includes('/../')) {
        throw new Error(`[offline-export/${pluginName}] Invalid copy destination: ${toInput}`);
      }

      const destinationPath = path.join(resourcesDir, toInput);
      if (!isInsideDir(destinationPath, resourcesDir)) {
        throw new Error(`[offline-export/${pluginName}] Destination escapes export resources: ${toInput}`);
      }

      const sourceStat = fs.statSync(fromPath);
      if (sourceStat.isDirectory()) {
        fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
        fs.cpSync(fromPath, destinationPath, { recursive: true, force: true });
      } else {
        fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
        fs.copyFileSync(fromPath, destinationPath);
      }
    }
  }

  return { headTags, bodyTags, pluginList };
}

const exportPresentation = {
  remoteServer: null, // to be set in register
  AppCtx: null, // to be set in register

  // Register IPC handlers
  register(ipcMain, AppContext) {
    this.AppCtx = AppContext;
    ipcMain.handle('export-presentation', async (event, slug, includeMedia, showSplashscreen = true) => {
      const folderPath = path.join(AppContext.config.presentationsDir, slug);
      this.remoteServer = AppContext.config.revealRemotePublicServer;
      return await this.run(folderPath, slug, includeMedia, showSplashscreen, event);
    });
  },

  // Open the export presentation window
  async run(folderPath, slug, includeMedia, showSplashscreen, event) {
    if (!fs.existsSync(folderPath)) {
      return { success: false, error: 'Presentation folder not found.' };
    }

    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Export Presentation as ZIP',
      defaultPath: `${slug}.zip`,
      filters: [{ name: 'Zip Files', extensions: ['zip'] }]
    });

    if (canceled || !filePath) return { success: false, canceled: true };

    if (event?.sender) {
      event.sender.send('export-status', 'exporting');
    }

    const createdFiles = [];
    const replacedFiles = new Map();
    const resourcesDir = path.join(folderPath, '_resources');
    const cssSrc = path.join(REVELATION_ROOT, 'dist', 'css');

    try {
      // Create _resources directory and copy assets
      fs.mkdirSync(resourcesDir, { recursive: true });
      const copyDir = (src, dest, transform) => {
        if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
        for (const file of fs.readdirSync(src)) {
          const srcFile = path.join(src, file);
          const destFile = path.join(dest, file);
          if (fs.statSync(srcFile).isFile()) {
            if (transform) {
              const content = fs.readFileSync(srcFile, 'utf-8');
              fs.writeFileSync(destFile, transform(content), 'utf-8');
            } else {
              fs.copyFileSync(srcFile, destFile);
            }
          }
        }
      };

      const writeFileTracked = (filePath, content) => {
        if (fs.existsSync(filePath)) {
          replacedFiles.set(filePath, fs.readFileSync(filePath));
        } else {
          createdFiles.push(filePath);
        }
        fs.writeFileSync(filePath, content, 'utf-8');
      };

      const mdFiles = fs.readdirSync(folderPath).filter(f => f.endsWith('.md')).sort();
      if (mdFiles.length === 0) {
        return { success: false, error: 'No markdown files found to export.' };
      }

      const appVersion = app.getVersion();
      const presentations = mdFiles.map((md, index) => {
        const content = fs.readFileSync(path.join(folderPath, md), 'utf-8');
        const frontMatter = parseFrontMatter(content);
        const title = frontMatter.title || path.basename(md, '.md');
        return {
          mdFile: md,
          title,
          content,
          htmlFile: mdFiles.length > 1 ? `presentation${index + 1}.html` : 'index.html'
        };
      });

      if (includeMedia) {
        this.AppCtx.log('Including media in export');
        const mediaTarget = path.join(resourcesDir, '_media');
        fs.mkdirSync(mediaTarget, { recursive: true });

        const referencedFiles = new Set();

        // 1️⃣ Parse YAML front matter in each markdown file
        for (const pres of presentations) {
          const frontMatter = parseFrontMatter(pres.content);
          if (frontMatter.media && typeof frontMatter.media === 'object') {
            for (const info of Object.values(frontMatter.media)) {
              if (info.filename) referencedFiles.add(info.filename);
              if (info.large_variant?.filename) {
                referencedFiles.add(info.large_variant.filename);
              }
            }
          }
        }

        // 2️⃣ Copy each referenced media file + sidecars from project _media
        const srcMediaDir = path.join(folderPath, '..', '_media');
        for (const filename of referencedFiles) {
          const srcFile = path.join(srcMediaDir, filename);
          const srcJSON = srcFile + '.json';
          const srcThumb = srcFile + '.thumbnail.jpg';

          const destFile = path.join(mediaTarget, filename);
          const destJSON = path.join(mediaTarget, path.basename(srcJSON));
          const destThumb = path.join(mediaTarget, path.basename(srcThumb));

          if (fs.existsSync(srcFile)) fs.copyFileSync(srcFile, destFile);
          if (fs.existsSync(srcJSON)) fs.copyFileSync(srcJSON, destJSON);
          if (fs.existsSync(srcThumb)) fs.copyFileSync(srcThumb, destThumb);
        }

        console.log(`✅ Included ${referencedFiles.size} media assets in export`);
      }

      copyDir(cssSrc, path.join(resourcesDir, 'css'), rewriteCssForExport); // CDN fonts for export
      const jsSrc = path.join(REVELATION_ROOT, 'dist', 'js','offline-bundle.js');
      fs.copyFileSync(jsSrc,path.join(resourcesDir,'offline-bundle.js'));
      const rcssSrc = path.join(REVELATION_ROOT, 'node_modules', 'reveal.js', 'dist','reveal.css');
      fs.copyFileSync(rcssSrc,path.join(resourcesDir,'css','reveal.css'));
      const translationsSrc = path.join(REVELATION_ROOT, 'js', 'translations.json');
      fs.copyFileSync(translationsSrc, path.join(resourcesDir, 'translations.json'));
      const translateSrc = path.join(REVELATION_ROOT, 'js', 'translate.js');
      fs.copyFileSync(translateSrc, path.join(resourcesDir, 'translate.js'));

      const pluginOfflineAssets = await collectPluginOfflineExportData(
        this.AppCtx,
        folderPath,
        resourcesDir,
        includeMedia,
        presentations
      );

      // Generate offline HTML
      for (const pres of presentations) {
        const html = createOfflineHTML(
          slug,
          pres.mdFile,
          pres.content,
          this.remoteServer,
          includeMedia,
          appVersion,
          showSplashscreen,
          pluginOfflineAssets
        );
        const htmlFile = path.join(folderPath, pres.htmlFile);
        writeFileTracked(htmlFile, html);
      }

      if (mdFiles.length > 1) {
        const indexHtml = createIndexMenuHTML(slug, presentations);
        writeFileTracked(path.join(folderPath, 'index.html'), indexHtml);
      }

      const manifest = buildPresentationManifest(folderPath, {
        appVersion,
        exportedAt: new Date().toISOString(),
        markdownFiles: mdFiles,
        presentations: presentations.map(pres => ({
          mdFile: pres.mdFile,
          title: pres.title,
          htmlFile: pres.htmlFile
        }))
      });
      writeFileTracked(path.join(folderPath, MANIFEST_FILENAME), JSON.stringify(manifest, null, 2));

      // Create the zip
      await new Promise((resolve, reject) => {
        const output = fs.createWriteStream(filePath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', resolve);
        archive.on('error', err => reject(err));
        archive.pipe(output);
        archive.directory(folderPath, false); // include all contents of folder
        archive.finalize();
      });

      return { success: true, filePath };
    } catch (err) {
      return { success: false, error: err.message };
    } finally {
      // Clean up generated files
      for (const file of createdFiles) {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      }
      for (const [file, content] of replacedFiles.entries()) {
        fs.writeFileSync(file, content);
      }
      if (fs.existsSync(resourcesDir)) {
        fs.rmSync(resourcesDir, { recursive: true, force: true });
      }
    }
  }
};



module.exports = { exportPresentation };
