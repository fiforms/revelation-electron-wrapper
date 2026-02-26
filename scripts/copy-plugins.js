const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const revelationPath = path.resolve(__dirname, '..', 'revelation');
const nodeModulesPath = path.join(revelationPath, 'node_modules');
const pluginsPath = path.resolve(__dirname, '..', 'plugins');

// Source plugin directly from node_modules
const highlightPluginJS = path.join(nodeModulesPath, 'reveal.js', 'plugin', 'highlight', 'plugin.js');
const highlightBundleOutDir = path.join(pluginsPath, 'highlight', 'highlight');
const highlightBundleOut = path.join(highlightBundleOutDir, 'plugin.bundle.mjs');
const realHighlightJS = path.join(revelationPath, 'node_modules', 'highlight.js', 'es', 'index.js');

function copyHighlightPlugin() {
  // Ensure destination folder exists
  fs.mkdirSync(highlightBundleOutDir, { recursive: true });

  // Bundle in ESM format
  console.log('📦 Bundling highlight plugin...');
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  execFileSync(
    npxCmd,
    [
      'esbuild',
      highlightPluginJS,
      '--bundle',
      `--alias:highlight.js=${realHighlightJS}`,
      `--outfile=${highlightBundleOut}`,
      '--format=esm',
      '--minify'
    ],
    { stdio: 'inherit' }
  );
  console.log(`✅ Bundled to: ${highlightBundleOut}`);

  // Copy highlight.js theme CSS
  const stylesDir = path.join(revelationPath, 'node_modules', 'highlight.js', 'styles');
  const themeFiles = fs.readdirSync(stylesDir).filter(f => f.endsWith('.min.css'));
  for (const file of themeFiles) {
    const src = path.join(stylesDir, file);
    const dest = path.join(highlightBundleOutDir, file);
    fs.copyFileSync(src, dest);
    console.log(`🎨 Copied highlight.js theme: ${file}`);
  }
}

function copyRevealChartPlugin() {
  const revealChartSourceDir = path.join(nodeModulesPath, 'reveal.js-plugins', 'chart');
  const chartJsSourceFile = path.join(nodeModulesPath, 'chart.js', 'dist', 'chart.umd.min.js');

  const revealChartDestDir = path.join(pluginsPath, 'revealchart', 'revealchart');
  fs.mkdirSync(revealChartDestDir, { recursive: true });

  if (!fs.existsSync(revealChartSourceDir) || !fs.statSync(revealChartSourceDir).isDirectory()) {
    throw new Error(`RevealChart source directory not found: ${revealChartSourceDir}`);
  }
  fs.cpSync(revealChartSourceDir, revealChartDestDir, { recursive: true, force: true });
  console.log(`📈 Copied RevealChart assets from: ${revealChartSourceDir}`);

  if (!fs.existsSync(chartJsSourceFile) || !fs.statSync(chartJsSourceFile).isFile()) {
    throw new Error(`Chart.js bundle not found: ${chartJsSourceFile}`);
  }
  const chartJsDestFile = path.join(revealChartDestDir, 'chart.umd.min.js');
  fs.copyFileSync(chartJsSourceFile, chartJsDestFile);
  console.log(`📊 Copied Chart.js bundle: ${chartJsSourceFile}`);
}

copyHighlightPlugin();
copyRevealChartPlugin();
