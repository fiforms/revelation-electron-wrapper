// lib/importPresentation.js
const fs = require('fs');
const path = require('path');
const unzipper = require('unzipper');
const { dialog } = require('electron');
const { downloadToTemp } = require('./mediaLibrary'); // adjust path as needed
const yaml = require('js-yaml');
const ffmpeg = require('fluent-ffmpeg');

const importPresentation = {
  register(ipcMain, AppContext) {

    AppContext.callbacks['menu:import-presentation'] = () => {
      console.log('Import Presentation Menu Clicked');
      this.run(AppContext);
    };
  },

  async run(AppContext) {

    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Import Presentation ZIP',
      filters: [{ name: 'Zip Files', extensions: ['zip'] }],
      properties: ['openFile']
    });

    if (canceled || filePaths.length === 0) return;

    const zipPath = filePaths[0];

    try {
      const slug = path.basename(zipPath, '.zip');
      let destPath = path.join(AppContext.config.presentationsDir, slug);

      if(fs.existsSync(destPath)) {
        destPath = path.join(AppContext.config.presentationsDir, `${slug}_${Date.now()}`);
      }

      while(fs.existsSync(destPath)) {
        destPath = destPath + '_1';
      }

      await fs.promises.mkdir(destPath, { recursive: true });
      await new Promise((resolve, reject) => {
        fs.createReadStream(zipPath)
          .pipe(unzipper.Extract({ path: destPath }))
          .on('close', resolve)
          .on('error', reject);
      });

      await importMediaFromResources(destPath, AppContext);
      await importMissingMediaFromYaml(destPath, AppContext);

      // 🧹 Cleanup: remove .html files and _resources
      const files = fs.readdirSync(destPath);
      for (const file of files) {
        const fullPath = path.join(destPath, file);
        if (file.endsWith('.html')) {
          fs.unlinkSync(fullPath);
        }
      }
      const resourcesPath = path.join(destPath, '_resources');
      if (fs.existsSync(resourcesPath)) {
        fs.rmSync(resourcesPath, { recursive: true, force: true });
      }

      AppContext.log(`📥 Imported presentation to ${destPath}`);
      dialog.showMessageBox({ message: `✅ Imported: ${slug} into ${destPath}`, buttons: ['OK'] });

      const indexPath = path.join(AppContext.config.presentationsDir, 'index.json');
      if (fs.existsSync(indexPath)) {
        const time = new Date();
        fs.utimesSync(indexPath, time, time);
      }

    } catch (err) {
      AppContext.error('❌ Import failed:', err.message);
      dialog.showMessageBox({ type: 'error', message: `Import failed:\n${err.message}` });
    }
  }
};

async function importMediaFromResources(importedPresFolder, AppContext) {
  const resMediaPath = path.join(importedPresFolder, '_resources', '_media');
  if (!fs.existsSync(resMediaPath)) return;

  const jsonFiles = fs.readdirSync(resMediaPath).filter(f => f.endsWith('.json'));
  if (!jsonFiles.length) return;

  console.log(`📥 Importing ${jsonFiles.length} media assets from ${resMediaPath}`);

  // Destination: shared media folder (e.g., presentations_<key>/_media)
  const destMediaPath = path.join(AppContext.config.presentationsDir, '_media');
  fs.mkdirSync(destMediaPath, { recursive: true });

  for (const jsonFile of jsonFiles) {
    const metaPath = path.join(resMediaPath, jsonFile);
    let metadata = {};

    try {
      metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8')) || {};
    } catch (err) {
      console.warn(`⚠️ Could not parse metadata for ${jsonFile}: ${err.message}`);
      continue;
    }

    const filename = metadata.filename;
    if (!filename) {
      console.warn(`⚠️ Skipping ${jsonFile}: missing filename`);
      continue;
    }

    const mediaFile = path.join(resMediaPath, filename);
    const destFile = path.join(destMediaPath, filename);
    const destMeta = path.join(destMediaPath, jsonFile);

    try {
      if (fs.existsSync(mediaFile)) {
        fs.copyFileSync(mediaFile, destFile, fs.constants.COPYFILE_EXCL);
      } else {
        console.warn(`⚠️ Missing media file: ${filename}`);
      }

      // Copy JSON metadata
      fs.copyFileSync(metaPath, destMeta, fs.constants.COPYFILE_EXCL);

      // Copy thumbnail if it exists
      const thumbFile = mediaFile + '.thumbnail.jpg';
      if (fs.existsSync(thumbFile)) {
        fs.copyFileSync(thumbFile, path.join(destMediaPath, path.basename(thumbFile)), fs.constants.COPYFILE_EXCL);
      }

      // Handle large variant
      if (metadata.large_variant?.filename) {
        const largeFile = path.join(resMediaPath, metadata.large_variant.filename);
        if (fs.existsSync(largeFile)) {
          fs.copyFileSync(
            largeFile,
            path.join(destMediaPath, metadata.large_variant.filename, fs.constants.COPYFILE_EXCL)
          );
        } else {
          console.warn(`⚠️ Large variant missing: ${metadata.large_variant.filename}`);
        }
      }

      console.log(`✅ Imported ${filename}`);
    } catch (err) {
      console.warn(`⚠️ Error importing ${filename}: ${err.message}`);
    }
  }

  console.log('✅ Finished importing media from _resources/_media');
}

async function importMissingMediaFromYaml(importedPresFolder, AppContext) {
  const mdFiles = fs.readdirSync(importedPresFolder).filter(f => f.endsWith('.md'));
  if (!mdFiles.length) return;

  const destMediaPath = path.join(AppContext.config.presentationsDir, '_media');
  fs.mkdirSync(destMediaPath, { recursive: true });

  configureFfmpeg(AppContext);

  const missingQueue = new Map();
  const largeVariantQueue = new Map();

  for (const md of mdFiles) {
    const mdPath = path.join(importedPresFolder, md);
    const content = fs.readFileSync(mdPath, 'utf8');
    const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
    if (!match) continue;

    let frontMatter = {};
    try {
      frontMatter = yaml.load(match[1]) || {};
    } catch (err) {
      console.warn(`⚠️ Could not parse YAML in ${md}: ${err.message}`);
      continue;
    }

    if (!frontMatter.media || typeof frontMatter.media !== 'object') continue;

    for (const [tag, info] of Object.entries(frontMatter.media)) {
      if (!info || typeof info !== 'object') continue;

      const filename = info.filename;
      if (!filename) {
        console.warn(`⚠️ Missing filename for media tag ${tag} in ${md}`);
        continue;
      }

      const destFile = path.join(destMediaPath, filename);
      const url = info.url_direct || info.url_library || info.url_origin;
      if (!fs.existsSync(destFile)) {
        if (!url) {
          console.warn(`⚠️ No download URL for ${filename} (${tag})`);
        } else if (!missingQueue.has(filename)) {
          missingQueue.set(filename, { info, url });
        }
      }

      if (info.large_variant?.filename && info.large_variant?.url_direct) {
        const largeDest = path.join(destMediaPath, info.large_variant.filename);
        if (!fs.existsSync(largeDest) && !largeVariantQueue.has(info.large_variant.filename)) {
          largeVariantQueue.set(info.large_variant.filename, info.large_variant.url_direct);
        }
      }
    }
  }

  if (!missingQueue.size) return;

  const { response } = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Download', 'Cancel'],
    title: 'Download Missing Media?',
    message: `The imported presentation references (${missingQueue.size}) media files that are missing from your library, but may be downloaded.`,
    detail: 'Should I attempt to download these now? Only do this for presentations that you trust. If you are unsure, click cancel and inspect the markdown first, then try importing again.'
  });

  if (response !== 0) {
    console.log('ℹ️ Skipped downloading missing media.');
    return;
  }

  for (const [filename, { info, url }] of missingQueue.entries()) {
    const destFile = path.join(destMediaPath, filename);
    const destMeta = `${destFile}.json`;
    const destThumb = `${destFile}.thumbnail.webp`;

    try {
      const tmpPath = await downloadToTemp(url);
      fs.copyFileSync(tmpPath, destFile);
      fs.unlinkSync(tmpPath);

      await makeWebpThumbnail(destFile, destThumb, mediaTypeFromFilename(filename));

      const metadata = buildMetadataFromYaml(info, filename, destThumb);
      if (!fs.existsSync(destMeta)) {
        fs.writeFileSync(destMeta, JSON.stringify(metadata, null, 2));
      }

      console.log(`✅ Downloaded and imported missing media: ${filename}`);
    } catch (err) {
      console.warn(`⚠️ Failed downloading ${filename}: ${err.message}`);
    }
  }

  for (const [largeFilename, url] of largeVariantQueue.entries()) {
    const largeDest = path.join(destMediaPath, largeFilename);
    if (fs.existsSync(largeDest)) continue;
    try {
      const tmpLarge = await downloadToTemp(url);
      fs.copyFileSync(tmpLarge, largeDest);
      fs.unlinkSync(tmpLarge);
      console.log(`✅ Downloaded large variant: ${largeFilename}`);
    } catch (err) {
      console.warn(`⚠️ Failed downloading large variant ${largeFilename}: ${err.message}`);
    }
  }
}

function buildMetadataFromYaml(info, filename, thumbPath) {
  const metadata = {};
  if (info.title !== undefined) metadata.title = info.title;
  if (info.keywords !== undefined) metadata.keywords = info.keywords;
  if (info.description !== undefined) metadata.description = info.description;
  if (info.attribution !== undefined) metadata.attribution = info.attribution;
  if (info.license !== undefined) metadata.license = info.license;
  if (info.url_origin !== undefined) metadata.url_origin = info.url_origin;
  if (info.url_library !== undefined) metadata.url_library = info.url_library;
  if (info.url_direct !== undefined) metadata.url_direct = info.url_direct;
  metadata.filename = filename;
  metadata.original_filename = info.original_filename || info.title || filename;
  metadata.thumbnail = path.basename(thumbPath);
  metadata.mediatype = info.mediatype || mediaTypeFromFilename(filename);

  if (info.large_variant && typeof info.large_variant === 'object') {
    const largeVariant = {};
    if (info.large_variant.filename) largeVariant.filename = info.large_variant.filename;
    if (info.large_variant.original_filename) {
      largeVariant.original_filename = info.large_variant.original_filename;
    }
    if (info.large_variant.url_direct) largeVariant.url_direct = info.large_variant.url_direct;
    if (Object.keys(largeVariant).length) metadata.large_variant = largeVariant;
  }

  return metadata;
}

function mediaTypeFromFilename(filename) {
  const ext = path.extname(filename).toLowerCase();
  const isImage = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext);
  const isVideo = ['.mp4', '.webm', '.mov', '.mkv'].includes(ext);
  if (isImage) return 'image';
  if (isVideo) return 'video';
  return 'unknown';
}

function configureFfmpeg(AppContext) {
  if (AppContext.config.ffmpegPath) {
    ffmpeg.setFfmpegPath(AppContext.config.ffmpegPath);
  } else {
    const ffmpegPathCandidate = path.join(
      process.resourcesPath,
      'ffmpeg',
      process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
    );
    if (fs.existsSync(ffmpegPathCandidate)) {
      ffmpeg.setFfmpegPath(ffmpegPathCandidate);
    }
  }
}

async function makeWebpThumbnail(mediaPath, targetPath, mediaType) {
  if (!fs.existsSync(mediaPath)) {
    throw new Error(`Source file not found: ${mediaPath}`);
  }

  return new Promise((resolve, reject) => {
    const command = ffmpeg(mediaPath)
      .outputOptions([
        '-vf', 'scale=w=512:h=512:force_original_aspect_ratio=decrease',
        '-vframes', '1'
      ])
      .output(targetPath)
      .on('end', resolve)
      .on('error', reject);

    if (mediaType === 'video') {
      command.seekInput('00:00:01.000');
    }

    command.run();
  });
}


module.exports = { importPresentation };
