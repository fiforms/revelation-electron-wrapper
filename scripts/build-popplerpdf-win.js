const fs = require('fs');
const path = require('path');
const os = require('os');
const unzipper = require('unzipper');
const { downloadFile } = require('./lib/download');

const POPPLER_WIN_URL = process.env.POPPLER_WIN_URL
  || 'https://github.com/oschwartz10612/poppler-windows/releases/download/v26.09.0-0/Release-26.09.0-0.zip';

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
