const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const rootDir = path.resolve(__dirname, '..');
const pluginDir = path.join(rootDir, 'plugins', 'popplerpdf');
const outputZipPath = path.join(rootDir, 'dist', 'popplerpdf.zip');

function zipDirectory(sourceDir, destinationZip) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(destinationZip), { recursive: true });
    const output = fs.createWriteStream(destinationZip);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve(archive.pointer()));
    output.on('error', reject);
    archive.on('error', reject);

    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

function hasPopplerPayload() {
  if (!fs.existsSync(pluginDir)) return false;
  const entries = fs.readdirSync(pluginDir, { withFileTypes: true });
  return entries.some((entry) => entry.isDirectory() && entry.name.startsWith('poppler-'));
}

async function run() {
  if (!hasPopplerPayload()) {
    throw new Error('No Poppler payload found in plugins/popplerpdf. Run "npm run build-popplerpdf-win" first.');
  }

  const bytes = await zipDirectory(pluginDir, outputZipPath);
  const mb = (bytes / (1024 * 1024)).toFixed(1);
  console.log(`📦 Built ${outputZipPath} (${mb} MB)`);
}

run().catch((err) => {
  console.error(`❌ dist-popplerpdf-win failed: ${err.message}`);
  process.exit(1);
});
