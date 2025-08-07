const path = require('path');
const { execSync } = require('child_process');

const revelationPath = path.resolve(__dirname, '..', 'revelation');
const nodeModulesPath = path.join(revelationPath, 'node_modules');
const pluginsPath = path.resolve(__dirname, '..', 'plugins');

// Source plugin directly from node_modules
const pluginJS = path.join(nodeModulesPath, 'reveal.js', 'plugin', 'highlight', 'plugin.js');
const bundleOutDir = path.join(pluginsPath, 'highlight', 'highlight');
const bundleOut = path.join(bundleOutDir, 'plugin.bundle.mjs');
const realHighlightJS = path.join(
  revelationPath,
  'node_modules',
  'highlight.js',
  'es',
  'index.js'
);

// Ensure destination folder exists
require('fs').mkdirSync(bundleOutDir, { recursive: true });

// Bundle in ESM format
console.log('📦 Bundling highlight plugin...');
execSync(
  `npx esbuild "${pluginJS}" --bundle --alias:highlight.js=${realHighlightJS} --outfile=${bundleOut} --format=esm`,
  { stdio: 'inherit' }
);
console.log(`✅ Bundled to: ${bundleOut}`);

// Copy highlight.js theme CSS
const themeSrc = path.join(
  revelationPath,
  'node_modules',
  'highlight.js',
  'styles',
  'github.css' // you can swap this for 'monokai.css', etc.
);
const themeDest = path.join(bundleOutDir, 'github.css');

require('fs').copyFileSync(themeSrc, themeDest);
console.log(`🎨 Copied highlight.js theme to: ${themeDest}`);