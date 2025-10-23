const { dialog } = require('electron');
const archiver = require('archiver');
const fs = require('fs');
const path = require('path');

const REVELATION_ROOT = path.resolve(__dirname, '../revelation');

function encodeHTML(str) {
  return str.replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
}

function createOfflineHTML(slug, mdFile, markdownText, remoteServer, includeMedia) {
  const markdownEscaped = encodeHTML(markdownText);
  const mediaLink = includeMedia ? `window.mediaPath = "_resources/_media";` : '';
  const splashscreen = `<script>
    window.splashScreenEnabled = true; // Set to false to disable splash screen
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
  </script>
</head>
<body class="hidden">
    <div class="reveal">
    <div class="slides">
      <section id="markdown-container">Loading...</section>
    </div>
  </div>
  <div id="fixed-overlay-wrapper">
  </div>
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

  ${splashscreen}
  <script src="_resources/offline-bundle.js"></script>
</body>
</html>`;
}

const exportPresentation = {
  remoteServer: null, // to be set in register

  // Register IPC handlers
  register(ipcMain, AppContext) {
    ipcMain.handle('export-presentation', async (_event, slug, includeMedia) => {
      const folderPath = path.join(AppContext.config.presentationsDir, slug);
      this.remoteServer = AppContext.config.revealRemotePublicServer;
      return await this.run(folderPath, slug, includeMedia);
    });
  },

  // Open the export presentation window
  async run(folderPath, slug, includeMedia) {
    if (!fs.existsSync(folderPath)) {
      return { success: false, error: 'Presentation folder not found.' };
    }

    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Export Presentation as ZIP',
      defaultPath: `${slug}.zip`,
      filters: [{ name: 'Zip Files', extensions: ['zip'] }]
    });

    if (canceled || !filePath) return { success: false, canceled: true };

    const createdFiles = [];
    const resourcesDir = path.join(folderPath, '_resources');
    const cssSrc = path.join(REVELATION_ROOT, 'dist', 'css');

    try {
      // Create _resources directory and copy assets
      fs.mkdirSync(resourcesDir, { recursive: true });
      const copyDir = (src, dest) => {
        if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
        for (const file of fs.readdirSync(src)) {
          const srcFile = path.join(src, file);
          const destFile = path.join(dest, file);
          if (fs.statSync(srcFile).isFile()) {
            fs.copyFileSync(srcFile, destFile);
          }
        }
      };

      if (includeMedia) {
        const yaml = require('js-yaml');
        const mediaTarget = path.join(resourcesDir, '_media');
        fs.mkdirSync(mediaTarget, { recursive: true });

        const mdFiles = fs.readdirSync(folderPath).filter(f => f.endsWith('.md'));
        const referencedFiles = new Set();

        // 1️⃣ Parse YAML front matter in each markdown file
        for (const md of mdFiles) {
          const mdPath = path.join(folderPath, md);
          const content = fs.readFileSync(mdPath, 'utf8');
          const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
          if (!match) continue;

          try {
            const frontMatter = yaml.load(match[1]) || {};
            if (frontMatter.media && typeof frontMatter.media === 'object') {
              for (const [tag, info] of Object.entries(frontMatter.media)) {
                if (info.filename) referencedFiles.add(info.filename);
                if (info.large_variant?.filename)
                  referencedFiles.add(info.large_variant.filename);
              }
            }
          } catch (err) {
            console.warn(`⚠️ Could not parse YAML in ${md}: ${err.message}`);
          }
        }

        // 2️⃣ Copy each referenced media file + sidecars from project _media
        const srcMediaDir = path.join(folderPath, '..', '_media');
        for (const filename of referencedFiles) {
          const srcFile = path.join(srcMediaDir, filename);
          const srcJSON = srcFile + '.json';
          const srcThumb = srcFile + '.thumbnail.webp';

          const destFile = path.join(mediaTarget, filename);
          const destJSON = path.join(mediaTarget, path.basename(srcJSON));
          const destThumb = path.join(mediaTarget, path.basename(srcThumb));

          if (fs.existsSync(srcFile)) fs.copyFileSync(srcFile, destFile);
          if (fs.existsSync(srcJSON)) fs.copyFileSync(srcJSON, destJSON);
          if (fs.existsSync(srcThumb)) fs.copyFileSync(srcThumb, destThumb);
        }

        console.log(`✅ Included ${referencedFiles.size} media assets in export`);
      }

      copyDir(cssSrc, path.join(resourcesDir, 'css')); // Optional: include CSS
      const jsSrc = path.join(REVELATION_ROOT, 'dist', 'js','offline-bundle.js');
      fs.copyFileSync(jsSrc,path.join(resourcesDir,'offline-bundle.js'));
      const rcssSrc = path.join(REVELATION_ROOT, 'node_modules', 'reveal.js', 'dist','reveal.css');
      fs.copyFileSync(rcssSrc,path.join(resourcesDir,'css','reveal.css'));


      // Generate one .html file per .md file
      const mdFiles = fs.readdirSync(folderPath).filter(f => f.endsWith('.md'));
      for (const md of mdFiles) {
        const content = fs.readFileSync(path.join(folderPath, md), 'utf-8');
        const html = createOfflineHTML(slug, md, content, this.remoteServer, includeMedia);
        const htmlFile = path.join(folderPath, md.replace(/\.md$/, '.html'));
        fs.writeFileSync(htmlFile, html, 'utf-8');
        createdFiles.push(htmlFile);
      }

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
      if (fs.existsSync(resourcesDir)) {
        fs.rmSync(resourcesDir, { recursive: true, force: true });
      }
    }
  }
};



module.exports = { exportPresentation };

