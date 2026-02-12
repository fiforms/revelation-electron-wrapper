/*
 * Slide timing recorder for autoslide macros.
 */
import {
  trFormat,
  recordSlideTimingsBtn,
  state
} from './context.js';
import { markDirty, setStatus } from './app-state.js';
import { renderSlideList, selectSlide } from './slides.js';

function makeSlideKey(h, v) {
  return `${h}:${v}`;
}

function upsertTimingEntry(entries, h, v, elapsedMs) {
  const safeElapsed = Math.max(0, Math.round(elapsedMs));
  const idx = entries.findIndex((entry) => entry.h === h && entry.v === v);
  if (idx >= 0) {
    entries[idx].ms += safeElapsed;
    return;
  }
  entries.push({ h, v, ms: safeElapsed });
}

function stripAutoslideLines(body) {
  if (!body) return '';
  const lines = String(body).split(/\r?\n/);
  const filtered = lines.filter((line) => !/^:autoslide:\s*\d+\s*:\s*$/i.test(line.trim()));
  while (filtered.length && filtered[0].trim() === '') {
    filtered.shift();
  }
  while (filtered.length && filtered[filtered.length - 1].trim() === '') {
    filtered.pop();
  }
  return filtered.join('\n');
}

function withAutoslideLine(body, elapsedMs) {
  const stripped = stripAutoslideLines(body);
  const line = `:autoslide:${Math.max(0, Math.round(elapsedMs))}:`;
  return stripped ? `${line}\n\n${stripped}` : line;
}

function appendCurrentSlideElapsed(nowMs) {
  const rec = state.timingRecorder;
  if (!rec?.active || !rec.current) return;
  const elapsed = Math.max(0, Math.round(nowMs - rec.startedAtMs));
  upsertTimingEntry(rec.timings, rec.current.h, rec.current.v, elapsed);
  rec.startedAtMs = nowMs;
}

function updateRecordButtonLabel() {
  if (!recordSlideTimingsBtn) return;
  if (state.timingRecorder?.active) {
    recordSlideTimingsBtn.textContent = tr('Stop Recording');
  } else {
    recordSlideTimingsBtn.textContent = tr('Record Slide Timings');
  }
}

function startSlideTimingRecording(deck) {
  if (!deck || typeof deck.getIndices !== 'function') {
    setStatus(tr('Preview is not ready yet.'));
    return false;
  }
  if (state.columnMarkdownMode) {
    setStatus(tr('Exit column markdown mode before recording slide timings.'));
    return false;
  }
  const indices = deck.getIndices() || { h: 0, v: 0 };
  state.timingRecorder = {
    active: true,
    current: { h: indices.h ?? 0, v: indices.v ?? 0 },
    startedAtMs: performance.now(),
    timings: []
  };
  updateRecordButtonLabel();
  setStatus(tr('Recording slide timings…'));
  return true;
}

function applyRecordedTimings() {
  const rec = state.timingRecorder;
  if (!rec) return { affected: 0, changed: 0 };
  const touchedKeys = new Set();
  let changed = 0;
  rec.timings.forEach((entry) => {
    const slide = state.stacks[entry.h]?.[entry.v];
    if (!slide) return;
    touchedKeys.add(makeSlideKey(entry.h, entry.v));
    const nextBody = withAutoslideLine(slide.body || '', entry.ms);
    if (nextBody !== (slide.body || '')) {
      slide.body = nextBody;
      changed += 1;
    }
  });

  return { affected: touchedKeys.size, changed };
}

function stopSlideTimingRecording() {
  const rec = state.timingRecorder;
  if (!rec?.active) return { updatedCount: 0 };
  appendCurrentSlideElapsed(performance.now());
  rec.active = false;
  state.recordedSlideTimings = rec.timings.map((entry) => ({ ...entry }));
  const { affected, changed } = applyRecordedTimings();
  state.timingRecorder = null;
  updateRecordButtonLabel();
  if (changed > 0) {
    markDirty();
    renderSlideList();
    selectSlide(state.selected.h, state.selected.v);
    setStatus(trFormat('Recorded timings for {count} slides.', { count: affected }));
  } else if (affected > 0) {
    setStatus(trFormat('Recorded timings for {count} slides.', { count: affected }));
  } else {
    setStatus(tr('No slides were recorded.'));
  }
  return { updatedCount: changed, affectedCount: affected };
}

function toggleSlideTimingRecording(deck) {
  if (state.timingRecorder?.active) {
    return stopSlideTimingRecording();
  }
  const started = startSlideTimingRecording(deck);
  return { started, updatedCount: 0 };
}

function handlePreviewSlideChanged(indices) {
  const rec = state.timingRecorder;
  if (!rec?.active || !indices) return;
  const nextH = indices.h ?? 0;
  const nextV = indices.v ?? 0;
  if (rec.current && rec.current.h === nextH && rec.current.v === nextV) return;
  appendCurrentSlideElapsed(performance.now());
  rec.current = { h: nextH, v: nextV };
}

export {
  toggleSlideTimingRecording,
  handlePreviewSlideChanged,
  updateRecordButtonLabel
};
