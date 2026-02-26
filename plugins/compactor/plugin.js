const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');

let AppCtx = null;

const jobs = new Map();
let jobCounter = 0;

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.webm']);

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function toPosixRelative(baseDir, filePath) {
  return path.relative(baseDir, filePath).split(path.sep).join('/');
}

function normalizeOptions(raw = {}) {
  const maxWidth = clampInt(raw.maxWidth, 64, 8192, 1920);
  const maxHeight = clampInt(raw.maxHeight, 64, 8192, 1080);
  const imageQuality = clampInt(raw.imageQuality, 1, 100, 85);
  const compactVideo = Boolean(raw.compactVideo);
  const videoQuality = clampInt(raw.videoQuality, 1, 100, 85);
  return { maxWidth, maxHeight, imageQuality, compactVideo, videoQuality };
}

function collectFilesRecursive(rootDir, allFiles = []) {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      collectFilesRecursive(fullPath, allFiles);
      continue;
    }
    if (entry.isFile()) {
      allFiles.push(fullPath);
    }
  }
  return allFiles;
}

function classifyAssets(allFiles) {
  const images = [];
  const videos = [];
  for (const filePath of allFiles) {
    const ext = path.extname(filePath).toLowerCase();
    if (IMAGE_EXTENSIONS.has(ext)) {
      images.push(filePath);
      continue;
    }
    if (VIDEO_EXTENSIONS.has(ext)) {
      videos.push(filePath);
    }
  }
  return { images, videos };
}

function uniqueCompactedDir(basePresentationsDir, slug) {
  const baseName = `${slug}_compacted`;
  const firstPath = path.join(basePresentationsDir, baseName);
  if (!fs.existsSync(firstPath)) {
    return { targetDir: firstPath, targetSlug: baseName };
  }

  let index = 2;
  while (index < 1000) {
    const candidateSlug = `${baseName}_${index}`;
    const candidatePath = path.join(basePresentationsDir, candidateSlug);
    if (!fs.existsSync(candidatePath)) {
      return { targetDir: candidatePath, targetSlug: candidateSlug };
    }
    index += 1;
  }

  throw new Error('Unable to find an available target folder for compacted presentation.');
}

function configureFfmpegPath() {
  if (AppCtx?.config?.ffmpegPath) {
    ffmpeg.setFfmpegPath(AppCtx.config.ffmpegPath);
    return;
  }
  const bundledFfmpeg = path.join(
    process.resourcesPath,
    'ffmpeg',
    process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  );
  if (fs.existsSync(bundledFfmpeg)) {
    ffmpeg.setFfmpegPath(bundledFfmpeg);
  }
}

function qualityToX264Crf(qualityPercent) {
  const q = clampInt(qualityPercent, 1, 100, 85);
  const normalized = (100 - q) / 100;
  return Math.round(18 + normalized * 16);
}

function qualityToVp9Crf(qualityPercent) {
  const q = clampInt(qualityPercent, 1, 100, 85);
  const normalized = (100 - q) / 100;
  return Math.round(24 + normalized * 18);
}

function qualityToJpegQscale(qualityPercent) {
  const q = clampInt(qualityPercent, 1, 100, 85);
  const normalized = (100 - q) / 100;
  return Math.round(2 + normalized * 29);
}

async function compactImage(filePath, options) {
  configureFfmpegPath();
  const ext = path.extname(filePath).toLowerCase();
  const tempPath = `${filePath}.compactor-tmp${ext}`;
  const scaleFilter = `scale=w=${options.maxWidth}:h=${options.maxHeight}:force_original_aspect_ratio=decrease`;

  const outputOptions = ['-vf', scaleFilter, '-frames:v', '1'];

  if (ext === '.jpg' || ext === '.jpeg') {
    outputOptions.push(
      '-c:v', 'mjpeg',
      '-q:v', String(qualityToJpegQscale(options.imageQuality)),
      '-pix_fmt', 'yuvj420p'
    );
  } else if (ext === '.png') {
    outputOptions.push(
      '-c:v', 'png',
      '-compression_level', String(Math.max(0, Math.min(9, Math.round((100 - options.imageQuality) / 100 * 9))))
    );
  } else if (ext === '.webp') {
    outputOptions.push(
      '-c:v', 'libwebp',
      '-q:v', String(options.imageQuality),
      '-compression_level', '6'
    );
  } else {
    throw new Error(`Unsupported image type: ${ext}`);
  }

  await new Promise((resolve, reject) => {
    ffmpeg(filePath)
      .outputOptions(outputOptions)
      .output(tempPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });

  fs.renameSync(tempPath, filePath);
}

async function compactVideo(filePath, options) {
  configureFfmpegPath();

  const ext = path.extname(filePath).toLowerCase();
  const tempPath = `${filePath}.compactor-tmp${ext}`;
  const scaleFilter = `scale=w=${options.maxWidth}:h=${options.maxHeight}:force_original_aspect_ratio=decrease`;

  const outputOptions = ['-vf', scaleFilter];

  if (ext === '.webm') {
    outputOptions.push(
      '-c:v', 'libvpx-vp9',
      '-b:v', '0',
      '-crf', String(qualityToVp9Crf(options.videoQuality)),
      '-row-mt', '1',
      '-deadline', 'good',
      '-cpu-used', '1',
      '-c:a', 'libopus',
      '-b:a', '128k'
    );
  } else {
    outputOptions.push(
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', String(qualityToX264Crf(options.videoQuality)),
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '160k'
    );
    if (ext === '.mp4' || ext === '.mov') {
      outputOptions.push('-movflags', '+faststart');
    }
  }

  await new Promise((resolve, reject) => {
    ffmpeg(filePath)
      .outputOptions(outputOptions)
      .output(tempPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });

  fs.renameSync(tempPath, filePath);
}

function setJobFailed(job, message) {
  job.status = 'failed';
  job.message = message;
  job.finishedAt = Date.now();
}

async function runCompactionJob(job, sourceDir, targetDir, options) {
  try {
    job.status = 'copying';
    job.message = 'Copying presentation folder...';

    fs.cpSync(sourceDir, targetDir, { recursive: true, errorOnExist: true, force: false });

    const allFiles = collectFilesRecursive(targetDir);
    const { images, videos } = classifyAssets(allFiles);
    const assets = [...images];
    if (options.compactVideo) {
      assets.push(...videos);
    }

    job.totalAssets = assets.length;
    job.message = `Compacting 0 of ${assets.length} assets...`;
    job.status = 'running';

    for (const filePath of assets) {
      const ext = path.extname(filePath).toLowerCase();
      const nextProcessed = job.processedAssets + 1;
      job.currentAsset = toPosixRelative(targetDir, filePath);
      job.message = `Compacting ${nextProcessed} of ${job.totalAssets} assets...`;

      try {
        if (IMAGE_EXTENSIONS.has(ext)) {
          await compactImage(filePath, options);
        } else if (VIDEO_EXTENSIONS.has(ext)) {
          await compactVideo(filePath, options);
        }
      } catch (err) {
        job.failures.push({
          file: toPosixRelative(targetDir, filePath),
          error: err.message
        });
      }

      job.processedAssets = nextProcessed;
    }

    job.status = 'done';
    job.currentAsset = '';
    job.message = `Compaction complete (${job.processedAssets}/${job.totalAssets}).`;
    job.finishedAt = Date.now();
  } catch (err) {
    setJobFailed(job, err.message);
  }
}

const compactorPlugin = {
  clientHookJS: 'client.js',
  priority: 96,
  version: '0.1.0',

  register(AppContext) {
    AppCtx = AppContext;
    AppContext.log('[compactor] Registered.');
  },

  api: {
    async startCompaction(_event, data) {
      const slug = String(data?.slug || '').trim();
      if (!slug) {
        return { success: false, error: 'Missing presentation slug.' };
      }

      const options = normalizeOptions(data?.options || {});
      const presentationsDir = AppCtx?.config?.presentationsDir;
      if (!presentationsDir) {
        return { success: false, error: 'Presentations directory is not configured.' };
      }

      const sourceDir = path.join(presentationsDir, slug);
      if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
        return { success: false, error: `Presentation folder not found: ${slug}` };
      }

      const { targetDir, targetSlug } = uniqueCompactedDir(presentationsDir, slug);

      jobCounter += 1;
      const jobId = `compactor_${Date.now()}_${jobCounter}`;
      const job = {
        id: jobId,
        sourceSlug: slug,
        targetSlug,
        sourceDir,
        targetDir,
        options,
        status: 'queued',
        message: 'Queued',
        totalAssets: 0,
        processedAssets: 0,
        currentAsset: '',
        failures: [],
        createdAt: Date.now(),
        finishedAt: null
      };

      jobs.set(jobId, job);
      runCompactionJob(job, sourceDir, targetDir, options);

      return {
        success: true,
        jobId,
        status: job.status,
        targetSlug,
        targetDir
      };
    },

    async getCompactionStatus(_event, data) {
      const jobId = String(data?.jobId || '').trim();
      const job = jobs.get(jobId);
      if (!job) {
        return { success: false, error: 'Compaction job not found.' };
      }

      return {
        success: true,
        jobId: job.id,
        sourceSlug: job.sourceSlug,
        targetSlug: job.targetSlug,
        status: job.status,
        message: job.message,
        totalAssets: job.totalAssets,
        processedAssets: job.processedAssets,
        currentAsset: job.currentAsset,
        failures: job.failures,
        createdAt: job.createdAt,
        finishedAt: job.finishedAt
      };
    }
  }
};

module.exports = compactorPlugin;
