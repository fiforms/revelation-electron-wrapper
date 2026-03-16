const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HYMN_INDEX_URL = 'https://www.pastordaniel.net/bigmedia/adventisthymns/hymnindex.json';
const HYMN_INDEX_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

let fetchFn;
try {
  const nf = require('node-fetch');
  fetchFn = nf && (nf.default || nf);
} catch (_err) {
  if (typeof global.fetch === 'function') {
    fetchFn = global.fetch.bind(global);
  } else {
    throw _err;
  }
}

function toYamlScalar(value) {
  const str = String(value || '').trim();
  return str ? JSON.stringify(str) : '';
}

function defaultLogger() {
  return {
    log() {},
    error() {}
  };
}

function readCachedHymnIndex(cachePath) {
  if (!cachePath || !fs.existsSync(cachePath)) return null;
  try {
    const content = fs.readFileSync(cachePath, 'utf8');
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed?.data)) return null;
    return parsed;
  } catch (_err) {
    return null;
  }
}

async function refreshHymnIndexCache(cachePath, indexUrl = HYMN_INDEX_URL) {
  const response = await fetchFn(indexUrl, { redirect: 'follow' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const payload = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error('Hymn index payload is not an array.');
  }

  const nextCache = {
    fetchedAt: new Date().toISOString(),
    data: payload
  };

  if (cachePath) {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(nextCache, null, 2), 'utf8');
  }

  return nextCache;
}

async function getHymnIndex(options = {}) {
  const {
    cachePath = null,
    logger = defaultLogger(),
    indexUrl = HYMN_INDEX_URL,
    maxAgeMs = HYMN_INDEX_CACHE_MAX_AGE_MS
  } = options;

  const cached = readCachedHymnIndex(cachePath);
  const fetchedAtMs = Date.parse(cached?.fetchedAt || '');
  const isFresh = Number.isFinite(fetchedAtMs) && (Date.now() - fetchedAtMs) < maxAgeMs;

  if (cached && isFresh) {
    return cached.data;
  }

  try {
    const refreshed = await refreshHymnIndexCache(cachePath, indexUrl);
    logger.log(`[adventisthymns] Refreshed hymn index cache from ${indexUrl}`);
    return refreshed.data;
  } catch (err) {
    if (cached?.data) {
      logger.log(`[adventisthymns] Failed to refresh hymn index (${err.message}); using stale cache.`);
      return cached.data;
    }
    logger.log(`[adventisthymns] Hymn index unavailable (${err.message}); continuing without index metadata.`);
    return [];
  }
}

function findHymnIndexEntry(indexRows, hymnNumber) {
  const normalized = String(hymnNumber || '').trim();
  if (!normalized) return null;

  const numeric = String(Number.parseInt(normalized, 10));
  return indexRows.find((row) => {
    const rowNo = String(row?.hymn_no || '').trim();
    if (!rowNo) return false;
    if (rowNo === normalized) return true;
    if (Number.isFinite(Number.parseInt(rowNo, 10)) && rowNo === numeric) return true;
    return String(Number.parseInt(rowNo, 10)) === numeric;
  }) || null;
}

function buildCreditsBlock(entry, sourceUrl) {
  if (!entry || typeof entry !== 'object') return '';

  const words = toYamlScalar(entry.words);
  const year = toYamlScalar(entry.year);
  const copyrightHolder = toYamlScalar(entry.copyright);
  const ccliSong = toYamlScalar(entry.cclisong);
  const license = String(entry.license || '').trim().toLowerCase();
  const normalizedLicense = license === 'ccli' ? 'ccli' : 'public';

  const lines = [
    ':credits:',
    `  words: ${words}`,
    `  year: ${year}`
  ];

  if (copyrightHolder) lines.push(`  copyright: ${copyrightHolder}`);
  if (ccliSong) lines.push(`  cclisong: ${ccliSong}`);
  lines.push(`  license: ${normalizedLicense}`);
  lines.push('  source: "AdventistHymns.com"');
  lines.push(`  sourceurl: ${toYamlScalar(sourceUrl)}`);

  return `${lines.join('\n')}\n\n`;
}

function normalizeLicense(value) {
  return String(value || '').trim().toLowerCase();
}

function isPublicDomainEntry(entry) {
  return normalizeLicense(entry?.license) === 'public';
}

function getPublicDomainHymnEntries(indexRows) {
  return indexRows.filter(isPublicDomainEntry);
}

function normalizeMarkdownSpacing(markdown) {
  const lines = String(markdown || '')
    .replace(/\r\n/g, '\n')
    .trim()
    .split('\n');

  const normalized = [];
  let blankPending = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      blankPending = true;
      continue;
    }

    if (trimmed === '---') {
      while (normalized.length && normalized[normalized.length - 1] === '') {
        normalized.pop();
      }
      if (normalized.length) normalized.push('');
      normalized.push('---');
      blankPending = true;
      continue;
    }

    if (blankPending && normalized.length && normalized[normalized.length - 1] !== '') {
      normalized.push('');
    }

    normalized.push(line);
    blankPending = false;
  }

  while (normalized.length && normalized[normalized.length - 1] === '') {
    normalized.pop();
  }

  return normalized.join('\n');
}

async function fetchHymnMarkdown(options = {}) {
  const {
    number,
    logger = defaultLogger(),
    hymnIndex = [],
    baseUrl = `https://adventisthymns.com/en/1985/s/${number}`,
    includeTitleSlide = true,
    includeCredits = true,
    includeSectionHeadings = true,
    includeTrailingColumnBreak = true
  } = options;

  if (!number) {
    throw new Error('A hymn number is required.');
  }

  logger.log(`[adventisthymns] Fetching hymn ${number} from AdventistHymns.com`);
  const hymnIndexEntry = findHymnIndexEntry(hymnIndex, number);

  const response = await fetchFn(baseUrl, { redirect: 'follow' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const html = await response.text();
  const dom = new JSDOM(html);
  const sections = [...dom.window.document.querySelectorAll('.reveal section')];

  if (!sections.length) {
    throw new Error('No slides were found on the hymn page.');
  }

  const firstTitle = sections[0]
    .querySelector('.heading .post__title')
    ?.textContent.trim();

  const toPlainText = (fragment) => {
    const temp = dom.window.document.createElement('div');
    temp.innerHTML = fragment;
    return (temp.textContent || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const buildLyricLines = (paragraph) => {
    if (!paragraph) return [];
    return paragraph.innerHTML
      .split(/<br\s*\/?>/i)
      .map((part) => toPlainText(part))
      .filter(Boolean);
  };

  const slideMarkdowns = sections
    .map((section, index) => {
      const paragraphs = [...section.querySelectorAll('p')];
      const lines = paragraphs.flatMap(buildLyricLines);
      if (!lines.length) return null;
      const slideParts = [];

      if (index === 0 && includeTitleSlide) {
        if (firstTitle) {
          slideParts.push(`# ${firstTitle}\n\n##### Hymn #${number}\n\n`);
        }
        const credits = includeCredits ? buildCreditsBlock(hymnIndexEntry, baseUrl) : '';
        if (credits) {
          slideParts.push(credits);
        }
        if (firstTitle || credits) {
          slideParts.push('---');
        }
      }

      if (includeSectionHeadings) {
        const heading = section
          .querySelector('.heading .line-type')
          ?.textContent.trim();
        if (heading) {
          slideParts.push(`_${heading}_  `);
        }
      }

      slideParts.push(lines.join('  \n'));
      return slideParts.join('\n\n');
    })
    .filter(Boolean);

  const bodySlides = includeTitleSlide ? slideMarkdowns : slideMarkdowns.filter((_, index) => index >= 0);
  let markdown = bodySlides.join('\n\n---\n\n');

  markdown = normalizeMarkdownSpacing(markdown);
  if (includeTrailingColumnBreak && markdown) {
    markdown += '\n\n***\n';
  }

  logger.log(`[adventisthymns] Parsed ${slideMarkdowns.length} slides.`);

  return {
    markdown,
    sourceUrl: baseUrl,
    slideCount: slideMarkdowns.length,
    title: firstTitle || '',
    hymnIndexEntry
  };
}

module.exports = {
  HYMN_INDEX_CACHE_MAX_AGE_MS,
  HYMN_INDEX_URL,
  buildCreditsBlock,
  fetchHymnMarkdown,
  findHymnIndexEntry,
  getHymnIndex,
  getPublicDomainHymnEntries,
  isPublicDomainEntry,
  normalizeMarkdownSpacing,
  readCachedHymnIndex,
  refreshHymnIndexCache,
  toYamlScalar
};
