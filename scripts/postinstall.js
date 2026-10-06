// npm postinstall hook: downloads the remote assets listed in scripts/fetch-blobs.js (Bibles, ffmpeg on
// macOS/Windows, effectgenerator, theme thumbnails, oldcss, mediafx gallery, WordPress plugin PHP libraries).
// Skipped entirely when SKIP_BLOBS=true|1; run `npm run fetch-blobs` later.
const skipBlobs = process.env.SKIP_BLOBS === 'true' || process.env.SKIP_BLOBS === '1';

if (skipBlobs) {
  console.log('⏭️  SKIP_BLOBS is set, skipping remote blob downloads.');
  console.log('   To download blobs later, run: npm run fetch-blobs');
} else {
  require('./fetch-blobs');
}
