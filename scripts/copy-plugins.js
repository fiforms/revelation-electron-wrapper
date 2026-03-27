const path = require('path');
const fs = require('fs');

const revelationPath = path.resolve(__dirname, '..', 'revelation');
const nodeModulesPath = path.join(revelationPath, 'node_modules');
const wrapperNodeModulesPath = path.resolve(__dirname, '..', 'node_modules');
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

function copyMathPlugin() {
  const mathPluginJS = path.join(nodeModulesPath, 'reveal.js', 'plugin', 'math', 'plugin.js');
  const mathBundleOutDir = path.join(pluginsPath, 'math', 'math');
  const mathBundleOut = path.join(mathBundleOutDir, 'plugin.bundle.mjs');
  const mathBundleJsOut = path.join(mathBundleOutDir, 'plugin.bundle.js');
  const mathBundleMinOut = path.join(mathBundleOutDir, 'plugin.bundle.min.js');

  fs.mkdirSync(mathBundleOutDir, { recursive: true });

  console.log('📦 Bundling math plugin...');
  const esbuildModulePath = path.join(nodeModulesPath, 'esbuild');
  let esbuild;
  try {
    esbuild = require(esbuildModulePath);
  } catch (err) {
    throw new Error(`esbuild module not found at: ${esbuildModulePath}. Run npm install in revelation/ first.`);
  }

  const mathBuildOptions = {
    entryPoints: [mathPluginJS],
    bundle: true,
    format: 'esm',
    sourcemap: true
  };

  esbuild.buildSync({
    ...mathBuildOptions,
    outfile: mathBundleOut,
    minify: false
  });
  fs.copyFileSync(mathBundleOut, mathBundleJsOut);
  const mathMapOut = `${mathBundleOut}.map`;
  if (fs.existsSync(mathMapOut)) {
    fs.copyFileSync(mathMapOut, `${mathBundleJsOut}.map`);
  }
  esbuild.buildSync({
    ...mathBuildOptions,
    outfile: mathBundleMinOut,
    minify: true
  });
  console.log(`✅ Bundled readable math plugin: ${mathBundleOut}`);
  console.log(`✅ Bundled minified math plugin: ${mathBundleMinOut}`);
}

function copyAppearancePlugin() {
  const appearanceSourceDir = path.join(wrapperNodeModulesPath, 'reveal.js-appearance', 'plugin', 'appearance');
  const appearanceDestDir = path.join(pluginsPath, 'appearance', 'appearance');
  fs.mkdirSync(appearanceDestDir, { recursive: true });

  const srcMjs = path.join(appearanceSourceDir, 'appearance.mjs');
  const srcCss = path.join(appearanceSourceDir, 'appearance.css');

  if (!fs.existsSync(srcMjs)) {
    throw new Error(`reveal.js-appearance ESM file not found: ${srcMjs}. Run npm install first.`);
  }
  if (!fs.existsSync(srcCss)) {
    throw new Error(`reveal.js-appearance CSS not found: ${srcCss}. Run npm install first.`);
  }

  const destMjs = path.join(appearanceDestDir, 'plugin.bundle.mjs');
  const destJs  = path.join(appearanceDestDir, 'plugin.bundle.js');
  const destMin = path.join(appearanceDestDir, 'plugin.bundle.min.js');
  const destCss = path.join(appearanceDestDir, 'appearance.css');

  fs.copyFileSync(srcMjs, destMjs);
  fs.copyFileSync(srcMjs, destJs);
  fs.copyFileSync(srcMjs, destMin);
  fs.copyFileSync(srcCss, destCss);

  console.log(`✅ Copied appearance plugin: ${destMjs}`);
  console.log(`🎨 Copied appearance CSS: ${destCss}`);
}

copyHighlightPlugin();
copyRevealChartPlugin();
copyMathPlugin();
copyAppearancePlugin();
