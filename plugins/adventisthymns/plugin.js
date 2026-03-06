/**
 * Adventist Hymns Plugin for REVELation
 * Scrapes hymn slides from adventisthymns.com and inserts them as Markdown
 */

const { BrowserWindow, app } = require('electron');
const path = require('path');
const fs = require('fs');
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

function appendSlidesMarkdown(presDir, mdFile, slidesMarkdown) {
  const mdPath = path.join(presDir, mdFile);
  if (!fs.existsSync(mdPath)) throw new Error(`Markdown not found: ${mdPath}`);
  fs.appendFileSync(mdPath, '\n\n' + slidesMarkdown + '\n');
}

function toYamlScalar(value) {
  const str = String(value || '').trim();
  return str ? JSON.stringify(str) : '';
}

function getHymnIndexCachePath() {
  return path.join(app.getPath('userData'), 'cache', 'adventisthymns-hymnindex.json');
}

function readCachedHymnIndex(cachePath) {
  if (!fs.existsSync(cachePath)) return null;
  try {
    const content = fs.readFileSync(cachePath, 'utf8');
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed?.data)) return null;
    return parsed;
  } catch (_err) {
    return null;
  }
}

async function refreshHymnIndexCache(cachePath) {
  const response = await fetchFn(HYMN_INDEX_URL, { redirect: 'follow' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error('Hymn index payload is not an array.');
  }

  const nextCache = {
    fetchedAt: new Date().toISOString(),
    data: payload
  };
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(nextCache, null, 2), 'utf8');
  return nextCache;
}

async function getHymnIndex(AppContext) {
  const cachePath = getHymnIndexCachePath();
  const cached = readCachedHymnIndex(cachePath);
  const fetchedAtMs = Date.parse(cached?.fetchedAt || '');
  const isFresh = Number.isFinite(fetchedAtMs) && (Date.now() - fetchedAtMs) < HYMN_INDEX_CACHE_MAX_AGE_MS;

  if (cached && isFresh) {
    return cached.data;
  }

  try {
    const refreshed = await refreshHymnIndexCache(cachePath);
    AppContext.log(`[adventisthymns] Refreshed hymn index cache from ${HYMN_INDEX_URL}`);
    return refreshed.data;
  } catch (err) {
    if (cached?.data) {
      AppContext.log(`[adventisthymns] Failed to refresh hymn index (${err.message}); using stale cache.`);
      return cached.data;
    }
    AppContext.log(`[adventisthymns] Hymn index unavailable (${err.message}); continuing without index metadata.`);
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

const adventisthymnsPlugin = {
  name: 'adventisthymns',
  clientHookJS: 'client.js',
  priority: 82,
  version: '0.2.8',
  exposeToBrowser: true, // required for client.js to find it

  register(AppContext) {
    AppContext.log('[adventisthymns-plugin] Registered adventisthymns plugin.');

    // Define plugin API callable from renderer
    this.api = {
      openDialog: async (_event, params = {}) => {
        const win = new BrowserWindow({
          width: 600,
          height: 700,
          resizable: true,
          webPreferences: {
            preload: AppContext.preload,
          },
        });

        win.setMenu(null);
        const url = `http://${AppContext.hostURL}:${AppContext.config.viteServerPort}/plugins_${AppContext.config.key}/adventisthymns/hymnsearch.html?params=${encodeURIComponent(JSON.stringify(params))}`;
        AppContext.log(`[adventisthymns] Opening hymnsearch dialog: ${url}`);
        win.loadURL(url);
      },

      // --- Fetch hymn slides from AdventistHymns.com and return Markdown ---
      async fetchHymnSlides(_event, options) {
        const number = options.number;
        const slug = options.slug;
        const mdFile = options.mdFile;
        AppContext.log(`[adventisthymns] Fetching hymn ${number} from AdventistHymns.com`);
        const baseUrl = `https://adventisthymns.com/en/1985/s/${number}`;
        const hymnIndex = await getHymnIndex(AppContext);
        const hymnIndexEntry = findHymnIndexEntry(hymnIndex, number);

        try {
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

          const toPlainText = fragment => {
            const temp = dom.window.document.createElement('div');
            temp.innerHTML = fragment;
            return (temp.textContent || '')
              .replace(/\u00a0/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();
          };

          const buildLyricLines = paragraph => {
            if (!paragraph) return [];
            return paragraph.innerHTML
              .split(/<br\s*\/?>/i)
              .map(part => toPlainText(part))
              .filter(Boolean);
          };

          const slideMarkdowns = sections
            .map((section, index) => {
              const paragraphs = [...section.querySelectorAll('p')];
              const lines = paragraphs.flatMap(buildLyricLines);
              if (!lines.length) return null;

              const heading = section
                .querySelector('.heading .line-type')
                ?.textContent.trim();

              const slideParts = [];

              if (index === 0) {
                if (firstTitle) {
                  slideParts.push(`# ${firstTitle}\n\n##### Hymn #${number}\n\n---\n\n`);
                }
                const credits = buildCreditsBlock(hymnIndexEntry, baseUrl);
                if (credits) {
                  slideParts.push(credits);
                }
              }

              if (heading) {
                slideParts.push(`\n\n_${heading}_`);
              }

              const lyricParagraph = lines.join('  \n');
              slideParts.push(lyricParagraph);

              return `${slideParts.join('\n')}\n\n---\n`;
            })
            .filter(Boolean);

          const mdSlides = slideMarkdowns.join('\n\n');

          // Remove the trailing slide separator added in the loop ("\n\n---\n")
          const trailingSep = '\n\n---\n';
          let md = mdSlides;
          if (md.endsWith(trailingSep)) {
            md = md.slice(0, -trailingSep.length);
          }
          // Ensure file ends with a slide break ***
          md = md.trimEnd() + '\n\n***\n\n';
          AppContext.log(`[adventisthymns] Parsed ${slideMarkdowns.length} slides.`);
          if(mdFile) {
            appendSlidesMarkdown(path.join(AppContext.config.presentationsDir, slug), mdFile, md);
            AppContext.log(`[adventisthymns] Appended hymn ${number} to ${mdFile}`);
          }
          return md;
        } catch (err) {
          AppContext.error(`[adventisthymns] Fetch failed: ${err.message}`);
          throw err;
        }
      },

    };
  },
};

module.exports = adventisthymnsPlugin;
