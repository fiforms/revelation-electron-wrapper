const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const pluginDir = path.join(rootDir, 'WordPress', 'revelation-presentations');
const runtimeDir = path.join(pluginDir, 'assets', 'runtime');
const runtimeJsDir = path.join(runtimeDir, 'js');
const runtimeCssDir = path.join(runtimeDir, 'css');
const pluginAssetsDir = path.join(pluginDir, 'assets', 'plugins');
const pluginDocsDir = path.join(pluginDir, 'docs');

function ensureExists(targetPath) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Required path not found: ${targetPath}`);
  }
}

function resetDir(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
  fs.mkdirSync(targetPath, { recursive: true });
}

function copyFileStrict(sourcePath, destPath) {
  ensureExists(sourcePath);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.copyFileSync(sourcePath, destPath);
}

function copyDirStrict(sourcePath, destPath) {
  ensureExists(sourcePath);
  fs.cpSync(sourcePath, destPath, { recursive: true, force: true });
}

function copyDirContents(sourceDir, destDir) {
  ensureExists(sourceDir);
  fs.mkdirSync(destDir, { recursive: true });

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      fs.cpSync(sourcePath, destPath, { recursive: true, force: true });
      continue;
    }
    fs.copyFileSync(sourcePath, destPath);
  }
}

function syncRuntimeAssets() {
  fs.mkdirSync(runtimeJsDir, { recursive: true });
  resetDir(runtimeCssDir);

  copyFileStrict(
    path.join(rootDir, 'revelation', 'dist', 'js', 'offline-bundle.js'),
    path.join(runtimeJsDir, 'offline-bundle.js')
  );
  copyFileStrict(
    path.join(rootDir, 'revelation', 'js', 'translate.js'),
    path.join(runtimeJsDir, 'translate.js')
  );
  copyFileStrict(
    path.join(rootDir, 'revelation', 'js', 'translations.json'),
    path.join(runtimeJsDir, 'translations.json')
  );

  copyDirContents(path.join(rootDir, 'revelation', 'dist', 'css'), runtimeCssDir);
  copyFileStrict(
    path.join(rootDir, 'revelation', 'node_modules', 'reveal.js', 'dist', 'reveal.css'),
    path.join(runtimeCssDir, 'reveal.css')
  );
}

function syncHostedPlugins() {
  resetDir(pluginAssetsDir);

  copyFileStrict(
    path.join(rootDir, 'plugins', 'highlight', 'client.js'),
    path.join(pluginAssetsDir, 'highlight', 'client.js')
  );
  copyDirStrict(
    path.join(rootDir, 'plugins', 'highlight', 'highlight'),
    path.join(pluginAssetsDir, 'highlight', 'highlight')
  );
  copyFileStrict(
    path.join(rootDir, 'plugins', 'highlight', 'highlight', 'plugin.bundle.mjs'),
    path.join(pluginAssetsDir, 'highlight', 'highlight', 'plugin.bundle.js')
  );

  copyFileStrict(
    path.join(rootDir, 'plugins', 'markerboard', 'client.js'),
    path.join(pluginAssetsDir, 'markerboard', 'client.js')
  );
  copyDirStrict(
    path.join(rootDir, 'plugins', 'markerboard', 'client'),
    path.join(pluginAssetsDir, 'markerboard', 'client')
  );

  copyFileStrict(
    path.join(rootDir, 'plugins', 'slidecontrol', 'client.js'),
    path.join(pluginAssetsDir, 'slidecontrol', 'client.js')
  );

  copyFileStrict(
    path.join(rootDir, 'plugins', 'captions', 'client.js'),
    path.join(pluginAssetsDir, 'captions', 'client.js')
  );

  copyFileStrict(
    path.join(rootDir, 'plugins', 'revealchart', 'client.js'),
    path.join(pluginAssetsDir, 'revealchart', 'client.js')
  );
  copyFileStrict(
    path.join(rootDir, 'plugins', 'revealchart', 'markdown-preprocessor.js'),
    path.join(pluginAssetsDir, 'revealchart', 'markdown-preprocessor.js')
  );
  copyFileStrict(
    path.join(rootDir, 'plugins', 'revealchart', 'csv-utils.js'),
    path.join(pluginAssetsDir, 'revealchart', 'csv-utils.js')
  );
  copyFileStrict(
    path.join(rootDir, 'plugins', 'revealchart', 'table-processor.js'),
    path.join(pluginAssetsDir, 'revealchart', 'table-processor.js')
  );
  copyFileStrict(
    path.join(rootDir, 'plugins', 'revealchart', 'builder.js'),
    path.join(pluginAssetsDir, 'revealchart', 'builder.js')
  );
  copyFileStrict(
    path.join(rootDir, 'plugins', 'revealchart', 'builder-dialog-template.js'),
    path.join(pluginAssetsDir, 'revealchart', 'builder-dialog-template.js')
  );
  copyDirStrict(
    path.join(rootDir, 'plugins', 'revealchart', 'revealchart'),
    path.join(pluginAssetsDir, 'revealchart', 'revealchart')
  );

  copyFileStrict(
    path.join(rootDir, 'plugins', 'credit_ccli', 'client.js'),
    path.join(pluginAssetsDir, 'credit_ccli', 'client.js')
  );
  copyFileStrict(
    path.join(rootDir, 'plugins', 'credit_ccli', 'markdown-preprocessor.js'),
    path.join(pluginAssetsDir, 'credit_ccli', 'markdown-preprocessor.js')
  );
}

function syncDocumentation() {
  fs.mkdirSync(pluginDocsDir, { recursive: true });

  copyFileStrict(
    path.join(rootDir, 'plugins', 'wordpress_publish', 'README.md'),
    path.join(pluginDocsDir, 'wordpress_publish.en.md')
  );
  copyFileStrict(
    path.join(rootDir, 'doc', 'i18n', 'es', 'plugins', 'wordpress_publish', 'README.md'),
    path.join(pluginDocsDir, 'wordpress_publish.es.md')
  );
}

function run() {
  syncRuntimeAssets();
  syncHostedPlugins();
  syncDocumentation();
  console.log(`Synced runtime assets into ${runtimeDir}`);
  console.log(`Synced hosted plugin assets into ${pluginAssetsDir}`);
  console.log(`Synced documentation into ${pluginDocsDir}`);
}

try {
  run();
} catch (err) {
  console.error(`❌ wp-sync-runtime-assets failed: ${err.message}`);
  process.exit(1);
}
