import { preprocessMarkdown } from './markdown-preprocessor.js';

const SONGSELECT_TERMS_LINE = /^For use solely with the SongSelect(?:®)? Terms of Use\.?\s+All rights reserved\.\s+www\.ccli\.com\s*$/i;
const SONGSELECT_LICENSE_LINE = /^CCLI License\s*#\s*([A-Za-z0-9-]+)\s*$/i;
const SONGSELECT_CCLI_SONG_LINE = /^CCLI Song\s*#\s*([0-9]+)\s*$/i;
const SONGSELECT_COPYRIGHT_LINE = /^©\s*([0-9]{4})\s+(.+)$/;

function normalizeLines(text = '') {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[\t ]+$/g, ''));
}

function toSectionTitle(raw = '') {
  const source = String(raw || '').trim();
  if (!source) return '';
  return source
    .replace(/\s+/g, ' ')
    .replace(/^(verse|chorus|bridge|pre-chorus|ending|tag|refrain|intro|outro)\b/i, (match) => {
      const lowered = match.toLowerCase();
      return lowered.charAt(0).toUpperCase() + lowered.slice(1);
    });
}

function looksLikeSectionHeading(line = '') {
  return /^(verse|chorus|bridge|pre-chorus|ending|tag|refrain|intro|outro)\b/i.test(String(line || '').trim());
}

function parseSongSelectSpecialPaste(clipboardText = '') {
  const lines = normalizeLines(clipboardText);
  if (!lines.length) return null;

  const nonEmptyLineIndexes = lines
    .map((line, index) => ({ line: String(line || '').trim(), index }))
    .filter(({ line }) => line.length > 0);
  if (nonEmptyLineIndexes.length < 2) return null;

  const finalLine = nonEmptyLineIndexes[nonEmptyLineIndexes.length - 1];
  const penultimateLine = nonEmptyLineIndexes[nonEmptyLineIndexes.length - 2];
  if (!SONGSELECT_TERMS_LINE.test(penultimateLine.line)) return null;
  if (!SONGSELECT_LICENSE_LINE.test(finalLine.line)) return null;
  const lastTermsIndex = penultimateLine.index;

  const contentLines = lines.slice(0, lastTermsIndex).map((line) => String(line || '').trimEnd());
  while (contentLines.length && !contentLines[contentLines.length - 1].trim()) {
    contentLines.pop();
  }
  if (!contentLines.length) return null;

  const title = String(contentLines[0] || '').trim();
  if (!title) return null;

  const creditsMeta = {
    words: '',
    year: '',
    copyright: '',
    cclisong: ''
  };

  let metaStart = contentLines.length;
  for (let i = contentLines.length - 1; i >= 0; i -= 1) {
    const line = String(contentLines[i] || '').trim();
    if (!line) {
      if (metaStart < contentLines.length) {
        break;
      }
      continue;
    }

    const songMatch = line.match(SONGSELECT_CCLI_SONG_LINE);
    if (songMatch) {
      creditsMeta.cclisong = songMatch[1];
      metaStart = i;
      continue;
    }

    const copyrightMatch = line.match(SONGSELECT_COPYRIGHT_LINE);
    if (copyrightMatch) {
      creditsMeta.year = copyrightMatch[1];
      creditsMeta.copyright = copyrightMatch[2].trim();
      metaStart = i;
      continue;
    }

    if (!creditsMeta.words) {
      creditsMeta.words = line;
      metaStart = i;
      continue;
    }

    break;
  }

  const lyricLines = contentLines.slice(1, metaStart).map((line) => line.trim());
  while (lyricLines.length && !lyricLines[0]) lyricLines.shift();
  while (lyricLines.length && !lyricLines[lyricLines.length - 1]) lyricLines.pop();
  if (!lyricLines.length) return null;

  const sections = [];
  let current = null;

  const pushCurrent = () => {
    if (!current) return;
    const filteredLines = current.lines
      .map((line) => line.trim())
      .filter(Boolean);
    if (!filteredLines.length) {
      current = null;
      return;
    }
    sections.push({ title: current.title, lines: filteredLines });
    current = null;
  };

  lyricLines.forEach((line) => {
    if (!line) return;
    if (looksLikeSectionHeading(line)) {
      pushCurrent();
      current = { title: toSectionTitle(line), lines: [] };
      return;
    }
    if (!current) {
      current = { title: '', lines: [] };
    }
    current.lines.push(line);
  });
  pushCurrent();

  if (!sections.length) return null;

  return {
    title,
    credits: creditsMeta,
    sections
  };
}

function renderSongSelectSmartPaste(song = null) {
  if (!song || !song.title || !Array.isArray(song.sections) || !song.sections.length) {
    return '';
  }

  const out = [];
  out.push(`## ${song.title}`);
  out.push(':credits:');
  if (song.credits.words) out.push(`  words: ${song.credits.words}`);
  if (song.credits.year) out.push(`  year: ${song.credits.year}`);
  if (song.credits.copyright) out.push(`  copyright: ${song.credits.copyright}`);
  if (song.credits.cclisong) out.push(`  cclisong: ${song.credits.cclisong}`);
  out.push('  license: ccli');

  song.sections.forEach((section) => {
    out.push('');
    out.push('---');
    out.push('');
    if (section.title) {
      out.push(`_${section.title}_  `);
    }
    out.push(...section.lines.map((line) => `${line}  `));
  });

  return out.join('\n').trim();
}

window.RevelationPlugins.credit_ccli = {
  name: 'credit_ccli',
  context: null,
  preprocessMarkdown,

  init(context) {
    this.context = context;
  },

  onBuilderSmartPaste(payload = {}) {
    const song = parseSongSelectSpecialPaste(payload.clipboardText || '');
    if (!song) {
      return { continueDefault: true };
    }
    const transformed = renderSongSelectSmartPaste(song);
    if (!transformed) {
      return { continueDefault: true };
    }
    return {
      text: transformed,
      continueDefault: false
    };
  }
};
