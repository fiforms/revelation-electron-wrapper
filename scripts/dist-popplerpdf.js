// Zip plugins/popplerpdf with whichever Poppler payload it holds (Windows or
// macOS), named for its platform and architecture — see popplerpdf-payload.js.
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { popplerPluginDir, detectPopplerPayload, popplerPluginZipName } = require('./popplerpdf-payload');

const rootDir = path.resolve(__dirname, '..');

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

async function run() {
  const payload = detectPopplerPayload();
  if (!payload) {
    throw new Error('No Poppler payload found in plugins/popplerpdf. Run "npm run build-popplerpdf-win" or "npm run build-popplerpdf-mac" first.');
  }

  const outputZipPath = path.join(rootDir, 'dist', popplerPluginZipName(payload));
  const bytes = await zipDirectory(popplerPluginDir, outputZipPath);
  const mb = (bytes / (1024 * 1024)).toFixed(1);
  console.log(`📦 Built ${outputZipPath} (${mb} MB)`);
}

module.exports = { zipDirectory };

if (require.main === module) {
  run().catch((err) => {
    console.error(`❌ dist-popplerpdf failed: ${err.message}`);
    process.exit(1);
  });
}
