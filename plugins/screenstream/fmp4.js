// plugins/screenstream/fmp4.js
//
// Fragmented-MP4 plumbing for the peer receiver: splits ffmpeg's stdout into the init segment and
// moof+mdat fragments, builds the MSE codec string, and finds each fragment's first video keyframe.
// Pure (Buffer in, values out); no Electron, no I/O. Caller: peerReceiver.js. Exports: Fmp4Splitter,
// trackInfoFromInit, fragmentKeyframeTime.
//
// Ported from slideannouncer's srt_stream_bridge.py (box walking, tfhd/tfdt/trun sync-sample parsing).
// Why keyframe times matter: fragments are cut by duration, not at keyframes, so the player must never call
// SourceBuffer.remove() past the last keyframe, or Chromium can drop the whole buffered range.
// Only H.264 (avcC) video is recognised; other codecs yield mime === null and the receiver reports it. An
// 'mp4a' track in the init segment adds mp4a.40.2 (AAC-LC) to the codec string.
// Differences from the Python: a fragment is emitted as soon as its mdat completes (not when the next moof
// starts, which would add one fragment of latency), and 64-bit box sizes are rejected, not skipped.

const SAMPLE_IS_NON_SYNC = 0x00010000;

function* childBoxes(buf) {
  let pos = 0;
  while (pos + 8 <= buf.length) {
    const size = buf.readUInt32BE(pos);
    if (size < 8 || pos + size > buf.length) return;
    yield { type: buf.toString('latin1', pos + 4, pos + 8), payload: buf.subarray(pos + 8, pos + size) };
    pos += size;
  }
}

function findBox(buf, type) {
  if (!buf) return null;
  for (const box of childBoxes(buf)) if (box.type === type) return box.payload;
  return null;
}

// The trak whose handler is 'vide'. hdlr's handler_type sits at a fixed offset, so a byte search is safe.
function videoTrak(moovPayload) {
  for (const box of childBoxes(moovPayload)) {
    if (box.type !== 'trak') continue;
    const idx = box.payload.indexOf('hdlr');
    if (idx !== -1 && box.payload.toString('latin1', idx + 12, idx + 16) === 'vide') return box.payload;
  }
  return null;
}

// tkhd and mdhd share a leading layout: version/flags, two time fields (4 bytes each, 8 in version 1).
function versionedOffset(versionByte) {
  return 4 + (versionByte === 1 ? 16 : 8);
}

/**
 * { trackId, timescale, mime } read from an init segment (ftyp+moov). Any field is null when it can't be
 * determined; `mime` is a full MSE type string for H.264, else null.
 */
function trackInfoFromInit(init) {
  const info = { trackId: null, timescale: null, mime: null };
  try {
    const trak = videoTrak(findBox(init, 'moov'));
    if (!trak) return info;
    const tkhd = findBox(trak, 'tkhd');
    if (tkhd) info.trackId = tkhd.readUInt32BE(versionedOffset(tkhd[0]));
    const mdhd = findBox(findBox(trak, 'mdia'), 'mdhd');
    if (mdhd) info.timescale = mdhd.readUInt32BE(versionedOffset(mdhd[0]));
    const idx = trak.indexOf('avcC');
    if (idx !== -1 && idx + 7 < trak.length) {
      const hex = (n) => n.toString(16).padStart(2, '0');
      const codecs = [`avc1.${hex(trak[idx + 5])}${hex(trak[idx + 6])}${hex(trak[idx + 7])}`];
      // MSE must be told about every track. Our receiver always encodes the sound as AAC-LC.
      if (init.includes('mp4a')) codecs.push('mp4a.40.2');
      info.mime = `video/mp4; codecs="${codecs.join(',')}"`;
    }
  } catch (_) { /* leave what was found */ }
  return info;
}

function parseTfhd(p) {
  const flags = p.readUInt32BE(0) & 0xffffff;
  const out = { trackId: p.readUInt32BE(4), defaultDuration: null, defaultFlags: null };
  let pos = 8;
  if (flags & 0x1) pos += 8;
  if (flags & 0x2) pos += 4;
  if (flags & 0x8) { out.defaultDuration = p.readUInt32BE(pos); pos += 4; }
  if (flags & 0x10) pos += 4;
  if (flags & 0x20) out.defaultFlags = p.readUInt32BE(pos);
  return out;
}

function parseTfdt(p) {
  return p[0] === 1 ? Number(p.readBigUInt64BE(4)) : p.readUInt32BE(4);
}

// Index of the first sync sample in a trun plus every sample's duration. A sample whose sync-ness can't be
// determined counts as non-sync: missing a keyframe is safe, claiming a fake one is not.
function parseTrun(p, defaultFlags, defaultDuration) {
  const flags = p.readUInt32BE(0) & 0xffffff;
  const count = p.readUInt32BE(4);
  let pos = 8;
  if (flags & 0x1) pos += 4;
  let firstSampleFlags = null;
  if (flags & 0x4) { firstSampleFlags = p.readUInt32BE(pos); pos += 4; }
  const durations = [];
  let keyIndex = null;
  for (let i = 0; i < count; i++) {
    let duration = defaultDuration;
    if (flags & 0x100) { if (pos + 4 > p.length) break; duration = p.readUInt32BE(pos); pos += 4; }
    if (flags & 0x200) pos += 4;
    let sampleFlags = null;
    if (flags & 0x400) { if (pos + 4 > p.length) break; sampleFlags = p.readUInt32BE(pos); pos += 4; }
    if (flags & 0x800) pos += 4;
    if (i === 0 && firstSampleFlags !== null) sampleFlags = firstSampleFlags;
    else if (sampleFlags === null) sampleFlags = defaultFlags;
    durations.push(duration == null ? 0 : duration);
    if (keyIndex === null && sampleFlags !== null && !(sampleFlags & SAMPLE_IS_NON_SYNC)) keyIndex = i;
  }
  return { keyIndex, durations };
}

/**
 * Presentation time in seconds of the first video keyframe in one moof+mdat fragment, or null when it has
 * none or anything is unknown. Never throws.
 */
function fragmentKeyframeTime(fragment, trackId, timescale) {
  if (trackId == null || !timescale) return null;
  try {
    const moof = findBox(fragment, 'moof');
    if (!moof) return null;
    for (const box of childBoxes(moof)) {
      if (box.type !== 'traf') continue;
      const tfhdPayload = findBox(box.payload, 'tfhd');
      if (!tfhdPayload) continue;
      const tfhd = parseTfhd(tfhdPayload);
      if (tfhd.trackId !== trackId) continue;
      const tfdt = findBox(box.payload, 'tfdt');
      const trun = findBox(box.payload, 'trun');
      if (!tfdt || !trun) return null;
      const { keyIndex, durations } = parseTrun(trun, tfhd.defaultFlags, tfhd.defaultDuration);
      if (keyIndex === null) return null;
      const offset = durations.slice(0, keyIndex).reduce((a, b) => a + b, 0);
      return (parseTfdt(tfdt) + offset) / timescale;
    }
  } catch (_) { /* fall through */ }
  return null;
}

/**
 * Incremental splitter for ffmpeg's `-f mp4 pipe:1` output. push(chunk) calls
 *   onInit({ data, mime, trackId, timescale })   once, when ftyp+moov are complete
 *   onFragment({ data, keyframeTime })           for each complete moof+mdat
 * onError(message) is called once if the stream cannot be parsed (then the splitter ignores further input).
 */
class Fmp4Splitter {
  constructor({ onInit, onFragment, onError }) {
    this.onInit = onInit;
    this.onFragment = onFragment;
    this.onError = onError || (() => {});
    this.buf = Buffer.alloc(0);
    this.initParts = [];
    this.info = null;
    this.moof = null;
    this.failed = false;
  }

  push(chunk) {
    if (this.failed) return;
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      if (this.buf.length < 8) return;
      const size = this.buf.readUInt32BE(0);
      if (size < 8) return this.fail('Unsupported MP4 box size in the stream.');
      if (this.buf.length < size) return;
      const type = this.buf.toString('latin1', 4, 8);
      const box = this.buf.subarray(0, size);
      this.buf = this.buf.subarray(size);
      this.handleBox(type, box);
      if (this.failed) return;
    }
  }

  handleBox(type, box) {
    if (!this.info) {
      if (type === 'moof') return this.fail('The stream had no init segment.');
      this.initParts.push(box);
      if (type === 'moov') {
        const data = Buffer.concat(this.initParts);
        this.info = trackInfoFromInit(data);
        this.onInit({ data, ...this.info });
      }
      return;
    }
    if (type === 'moof') {
      this.moof = box;
    } else if (type === 'mdat' && this.moof) {
      const data = Buffer.concat([this.moof, box]);
      this.moof = null;
      this.onFragment({ data, keyframeTime: fragmentKeyframeTime(data, this.info.trackId, this.info.timescale) });
    }
  }

  fail(message) {
    this.failed = true;
    this.onError(message);
  }
}

module.exports = { Fmp4Splitter, trackInfoFromInit, fragmentKeyframeTime };
