const fs = require('fs');
const path = require('path');

// Path to revelation's node_modules
const revelationPath = path.resolve(__dirname, '..', 'revelation');
const nodeModulesPath = path.join(revelationPath, 'node_modules');
const pluginsPath = path.resolve(__dirname, '..','plugins');

if (!fs.existsSync(nodeModulesPath)) {
  console.error('\n❌ revelation/node_modules not found.');
  console.error('   ➜ Please run "npm install" inside the "revelation" directory first.\n');
  process.exit(1); // cancel install
}

// Copy directory recursively
function copyDir(src, dest) {

    // Ensure the source directory exists
    if (!fs.existsSync(src)) {
        console.error(`❌ Cannot find ${src}`);
        console.error('   ➜ Make sure Reveal.js is properly installed in "revelation".\n');
        process.exit(1);
    }

    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }
    for (const item of fs.readdirSync(src)) {
        const srcItem = path.join(src, item);
        const destItem = path.join(dest, item);
        if (fs.statSync(srcItem).isDirectory()) {
            copyDir(srcItem, destItem);
        } else {
            fs.copyFileSync(srcItem, destItem);
        }
    }
}

let srcPluginPath = path.join(nodeModulesPath, 'reveal.js', 'plugin', 'highlight');
let destPluginPath = path.join(pluginsPath,'highlight','highlight');

copyDir(srcPluginPath, destPluginPath);
console.log(`✅ Copied ${srcPluginPath} to: ${destPluginPath}`);
