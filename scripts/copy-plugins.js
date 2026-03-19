const path = require('path');
const fs = require('fs');

const revelationPath = path.resolve(__dirname, '..', 'revelation');
const nodeModulesPath = path.join(revelationPath, 'node_modules');
const pluginsPath = path.resolve(__dirname, '..', 'plugins');

// Source plugin directly from node_modules
const highlightPluginJS = path.join(nodeModulesPath, 'reveal.js', 'plugin', 'highlight', 'plugin.js');
const highlightBundleOutDir = path.join(pluginsPath, 'highlight', 'highlight');
const highlightBundleOut = path.join(highlightBundleOutDir, 'plugin.bundle.mjs');
const highlightBundleJsOut = path.join(highlightBundleOutDir, 'plugin.bundle.js');
const highlightBundleMinOut = path.join(highlightBundleOutDir, 'plugin.bundle.min.js');
const realHighlightJS = path.join(revelationPath, 'node_modules', 'highlight.js', 'es', 'index.js');

function copyHighlightPlugin() {
  // Ensure destination folder exists
  fs.mkdirSync(highlightBundleOutDir, { recursive: true });

  // Bundle a readable ESM build plus a minified JS copy for distribution.
  console.log('📦 Bundling highlight plugin...');
  const esbuildModulePath = path.join(nodeModulesPath, 'esbuild');
  let esbuild;
  try {
    esbuild = require(esbuildModulePath);
  } catch (err) {
    throw new Error(`esbuild module not found at: ${esbuildModulePath}. Run npm install in revelation/ first.`);
  }

  const highlightBuildOptions = {
    entryPoints: [highlightPluginJS],
    bundle: true,
    alias: { 'highlight.js': realHighlightJS },
    format: 'esm',
    sourcemap: true
  };

  esbuild.buildSync({
    ...highlightBuildOptions,
    outfile: highlightBundleOut,
    minify: false
  });
  fs.copyFileSync(highlightBundleOut, highlightBundleJsOut);
  const highlightMapOut = `${highlightBundleOut}.map`;
  if (fs.existsSync(highlightMapOut)) {
    fs.copyFileSync(highlightMapOut, `${highlightBundleJsOut}.map`);
  }
  esbuild.buildSync({
    ...highlightBuildOptions,
    outfile: highlightBundleMinOut,
    minify: true
  });
  console.log(`✅ Bundled readable highlight plugin: ${highlightBundleOut}`);
  console.log(`✅ Bundled minified highlight plugin: ${highlightBundleMinOut}`);

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
  const chartJsReadableSourceFile = path.join(nodeModulesPath, 'chart.js', 'dist', 'chart.umd.js');
  const chartJsSourceFile = path.join(nodeModulesPath, 'chart.js', 'dist', 'chart.umd.min.js');

  const revealChartDestDir = path.join(pluginsPath, 'revealchart', 'revealchart');
  fs.mkdirSync(revealChartDestDir, { recursive: true });

  if (!fs.existsSync(revealChartSourceDir) || !fs.statSync(revealChartSourceDir).isDirectory()) {
    throw new Error(`RevealChart source directory not found: ${revealChartSourceDir}`);
  }
  fs.cpSync(revealChartSourceDir, revealChartDestDir, { recursive: true, force: true });
  console.log(`📈 Copied RevealChart assets from: ${revealChartSourceDir}`);

  if (!fs.existsSync(chartJsReadableSourceFile) || !fs.statSync(chartJsReadableSourceFile).isFile()) {
    throw new Error(`Chart.js readable bundle not found: ${chartJsReadableSourceFile}`);
  }
  if (!fs.existsSync(chartJsSourceFile) || !fs.statSync(chartJsSourceFile).isFile()) {
    throw new Error(`Chart.js minified bundle not found: ${chartJsSourceFile}`);
  }
  const chartJsReadableDestFile = path.join(revealChartDestDir, 'chart.umd.js');
  const chartJsDestFile = path.join(revealChartDestDir, 'chart.umd.min.js');
  fs.copyFileSync(chartJsReadableSourceFile, chartJsReadableDestFile);
  fs.copyFileSync(chartJsSourceFile, chartJsDestFile);
  const chartJsReadableMap = `${chartJsReadableSourceFile}.map`;
  if (fs.existsSync(chartJsReadableMap)) {
    fs.copyFileSync(chartJsReadableMap, `${chartJsReadableDestFile}.map`);
  }
  const chartJsMinMap = `${chartJsSourceFile}.map`;
  if (fs.existsSync(chartJsMinMap)) {
    fs.copyFileSync(chartJsMinMap, `${chartJsDestFile}.map`);
  }
  console.log(`📊 Copied Chart.js readable bundle: ${chartJsReadableSourceFile}`);
  console.log(`📊 Copied Chart.js minified bundle: ${chartJsSourceFile}`);
}

copyHighlightPlugin();
copyRevealChartPlugin();
