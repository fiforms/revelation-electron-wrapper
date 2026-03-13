// Call fetch-bibles.js after install to ensure bibles are present
require('../plugins/bibletext/fetch-bibles');
// Call fetch-effectgenerator.js after install to ensure mediafx binary is present
require('./fetch-effectgenerator');
// Call fetch-theme-thumbnails.js after install to ensure theme thumbnails are present
require('./fetch-theme-thumbnails');
// Call fetch-mediafx-gallery.js after install to ensure gallery previews are present
require('./fetch-mediafx-gallery');
// Call download-libs.js for WordPress plugin bundled libraries
const { execSync } = require('child_process');
const path = require('path');
try {
  execSync('node scripts/download-libs.js', { stdio: 'inherit', cwd: __dirname + '/..' });
} catch (error) {
  console.warn('Warning: Failed to download WordPress plugin libraries:', error.message);
}
