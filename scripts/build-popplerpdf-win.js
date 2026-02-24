const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const unzipper = require('unzipper');

const POPPLER_WIN_URL = process.env.POPPLER_WIN_URL
  || 'https://github.com/oschwartz10612/poppler-windows/releases/download/v25.12.0-0/Release-25.12.0-0.zip';

const rootDir = path.resolve(__dirname, '..');
const pluginDir = path.join(rootDir, 'plugins', 'popplerpdf');
const tmpZipPath = path.join(os.tmpdir(), 'revelation-popplerpdf-win.zip');

function ensurePluginDir() {
  fs.mkdirSync(pluginDir, { recursive: true });
}

function removeExistingPopplerPayloads() {
  if (!fs.existsSync(pluginDir)) return;
  const entries = fs.readdirSync(pluginDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.startsWith('poppler-')) continue;
    fs.rmSync(path.join(pluginDir, entry.name), { recursive: true, force: true });
  }
}

function downloadFile(url, destination, redirectDepth = 0) {
  return new Promise((resolve, reject) => {
    if (redirectDepth > 5) {
      reject(new Error('Too many redirects while downloading Poppler zip.'));
      return;
    }

    const req = https.get(url, (res) => {
      const code = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(code) && res.headers.location) {
        res.resume();
        downloadFile(res.headers.location, destination, redirectDepth + 1).then(resolve).catch(reject);
        return;
      }
      if (code < 200 || code >= 300) {
        res.resume();
        reject(new Error(`Download failed with HTTP ${code}`));
        return;
      }

      const out = fs.createWriteStream(destination);
      res.pipe(out);
      out.on('finish', () => out.close(resolve));
      out.on('error', reject);
    });

    req.on('error', reject);
    req.setTimeout(120000, () => {
      req.destroy(new Error('Download timed out.'));
    });
  });
}

async function extractZip(zipPath, destinationDir) {
  await fs.createReadStream(zipPath)
    .pipe(unzipper.Extract({ path: destinationDir }))
    .promise();
}

async function run() {
  ensurePluginDir();
  console.log(`📥 Downloading Poppler Windows package from ${POPPLER_WIN_URL}`);
  await downloadFile(POPPLER_WIN_URL, tmpZipPath);
  console.log(`✅ Downloaded to ${tmpZipPath}`);

  removeExistingPopplerPayloads();
  await extractZip(tmpZipPath, pluginDir);
  fs.rmSync(tmpZipPath, { force: true });

  console.log(`✅ Poppler payload extracted into ${pluginDir}`);
}

run().catch((err) => {
  console.error(`❌ build-popplerpdf-win failed: ${err.message}`);
  process.exit(1);
});
