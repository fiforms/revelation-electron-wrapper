const path = require('path');
const fs = require('fs');
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
fs.mkdirSync(bundleOutDir, { recursive: true });

// Bundle in ESM format
console.log('📦 Bundling highlight plugin...');
execSync(
  `npx esbuild "${pluginJS}" --bundle --alias:highlight.js=${realHighlightJS} --outfile=${bundleOut} --format=esm --minify`,
  { stdio: 'inherit' }
);
console.log(`✅ Bundled to: ${bundleOut}`);

// Copy highlight.js theme CSS
const stylesDir = path.join(revelationPath, 'node_modules', 'highlight.js', 'styles');

const themeFiles = fs.readdirSync(stylesDir).filter(f => f.endsWith('.min.css'));
for (const file of themeFiles) {
  const src = path.join(stylesDir, file);
  const dest = path.join(bundleOutDir, file);
  fs.copyFileSync(src, dest);
  console.log(`🎨 Copied highlight.js theme: ${file}`);
}