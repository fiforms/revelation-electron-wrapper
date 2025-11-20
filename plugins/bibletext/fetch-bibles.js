// plugins/bibletext/fetch-bibles.js
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const BASE = "https://www.pastordaniel.net/bigmedia/bibles/";
const MANIFEST_URL = BASE + "manifest.json";
const OUTDIR = path.join(__dirname, "bibles");

(async function main() {
  try {
    fs.mkdirSync(OUTDIR, { recursive: true });
  } catch {}

  console.log("📥 Fetching Bible manifest…");

  let manifest;
  try {
    const txt = await downloadText(MANIFEST_URL);
    manifest = JSON.parse(txt);
  } catch (e) {
    console.warn("⚠️ Could not load manifest:", e.message);
    return;
  }

  if (!Array.isArray(manifest.files)) {
    console.warn("⚠️ Manifest has no files array.");
    return;
  }

  for (const file of manifest.files) {
    const localPath = path.join(OUTDIR, file.name);

    // If present & optionally verify hash
    if (fs.existsSync(localPath)) {
      if (file.sha256 && verifyHash(localPath, file.sha256)) {
        console.log(`✓ ${file.name} up-to-date`);
        continue;
      }
    }

    console.log(`⬇️ Downloading ${file.name}…`);
    try {
      await downloadFile(BASE + file.name, localPath);
      if (file.sha256 && !verifyHash(localPath, file.sha256)) {
        console.warn(`⚠️ Hash mismatch for ${file.name}`);
      } else {
        console.log(`✓ Saved ${file.name}`);
      }
    } catch (e) {
      console.warn(`⚠️ Failed: ${file.name}:`, e.message);
    }
  }

  console.log("✔ Bible module sync complete.");
})();

function downloadText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode !== 200) return reject(new Error("HTTP " + res.statusCode));
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, res => {
      if (res.statusCode !== 200) return reject(new Error("HTTP " + res.statusCode));
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
    }).on("error", reject);
  });
}

function verifyHash(filepath, hex) {
  try {
    const fileBuffer = fs.readFileSync(filepath);
    const hash = crypto.createHash("sha256").update(fileBuffer).digest("hex");
    return hash === hex.toLowerCase();
  } catch {
    return false;
  }
}
