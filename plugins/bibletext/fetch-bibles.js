// plugins/bibletext/fetch-bibles.js  (developer/build CLI, not loaded by the app)
// Downloads the Bible modules listed in https://www.pastordaniel.net/bigmedia/bibles/manifest.json into ./bibles/,
// verifying sha256 against the manifest. Run by scripts/fetch-blobs.js (npm install) so a dev checkout has every
// translation; a release build bundles only the KJV (scripts/prepackage.js) and users download the rest from the app
// (bibleDownloader.js, which this script shares its download code with). Network access happens only when this script
// is run by hand or from a build script. A failure is a warning, never an error: the build goes on without Bibles.
const path = require('path');
const { installCollection } = require('./bibleDownloader');

(async function main() {
  console.log('📥 Fetching Bible manifest…');
  try {
    const result = await installCollection({ destDir: path.join(__dirname, 'bibles'), log: console.log });
    if (result.failed.length) console.warn(`⚠️ ${result.failed.length} Bible file(s) failed.`);
    console.log('✔ Bible module sync complete.');
  } catch (e) {
    console.warn('⚠️ Could not load manifest:', e.message);
  }
})();
