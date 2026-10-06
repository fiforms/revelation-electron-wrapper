// scripts/lib/download.js: shared https download for the build/fetch scripts (they can't use lib/httpUtil.js, which
// belongs to the Electron app). downloadFile(url, dest, { maxRedirects = 5, timeoutMs = 120000 }) follows redirects,
// writes to <dest>.part and renames on success (an interrupted run never leaves a truncated file), and rejects with
// Error('HTTP <status>') so callers can test /HTTP 404/.
// Callers: scripts/fetch-ffmpeg.js, fetch-effectgenerator.js, fetch-theme-thumbnails.js, fetch-mediafx-gallery.js,
// download-libs.js, build-popplerpdf-win.js. Not used by revelation/scripts/fetch-oldcss.js (submodule) or
// plugins/bibletext/fetch-bibles.js.
const fs = require('fs');
const https = require('https');

function downloadFile(url, dest, { maxRedirects = 5, timeoutMs = 120000 } = {}) {
  const part = `${dest}.part`;
  const attempt = (currentUrl, redirectsLeft) => new Promise((resolve, reject) => {
    const req = https.get(currentUrl, (res) => {
      const code = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(code) && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) return reject(new Error(`Too many redirects downloading ${url}`));
        const next = new URL(res.headers.location, currentUrl).toString();
        return attempt(next, redirectsLeft - 1).then(resolve, reject);
      }
      if (code !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${code}`));
      }
      const out = fs.createWriteStream(part);
      res.pipe(out);
      out.on('finish', () => out.close(resolve));
      out.on('error', reject);
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Download timed out.')));
  });

  return attempt(url, maxRedirects).then(
    () => fs.renameSync(part, dest),
    (err) => {
      fs.rmSync(part, { force: true });
      throw err;
    }
  );
}

module.exports = { downloadFile };
