// plugins/bibletext/plugin.js
const { BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const localBibles = require('./localbiblemanager');

let AppCtx = null;

const ISO3_TO_ISO2 = {
  ara: 'ar',
  ces: 'cs',
  chi: 'zh',
  cze: 'cs',
  deu: 'de',
  dut: 'nl',
  ell: 'el',
  eng: 'en',
  fin: 'fi',
  fra: 'fr',
  fre: 'fr',
  ger: 'de',
  gre: 'el',
  heb: 'he',
  hin: 'hi',
  hun: 'hu',
  ita: 'it',
  jpn: 'ja',
  kor: 'ko',
  lat: 'la',
  nld: 'nl',
  nor: 'no',
  pol: 'pl',
  por: 'pt',
  ron: 'ro',
  rum: 'ro',
  rus: 'ru',
  spa: 'es',
  swe: 'sv',
  tur: 'tr',
  ukr: 'uk',
  zho: 'zh'
};

const LANGUAGE_NAME_TO_CODE = {
  arabic: 'ar',
  chinese: 'zh',
  dutch: 'nl',
  english: 'en',
  french: 'fr',
  german: 'de',
  greek: 'el',
  hebrew: 'he',
  hindi: 'hi',
  italian: 'it',
  japanese: 'ja',
  korean: 'ko',
  latin: 'la',
  norwegian: 'no',
  polish: 'pl',
  portuguese: 'pt',
  romanian: 'ro',
  russian: 'ru',
  spanish: 'es',
  swedish: 'sv',
  turkish: 'tr',
  ukrainian: 'uk'
};

const LANGUAGE_CODE_TO_NAME = {
  ar: 'Arabic',
  cs: 'Czech',
  de: 'German',
  el: 'Greek',
  en: 'English',
  es: 'Spanish',
  fi: 'Finnish',
  fr: 'French',
  he: 'Hebrew',
  hi: 'Hindi',
  hu: 'Hungarian',
  it: 'Italian',
  ja: 'Japanese',
  ko: 'Korean',
  la: 'Latin',
  nl: 'Dutch',
  no: 'Norwegian',
  pl: 'Polish',
  pt: 'Portuguese',
  ro: 'Romanian',
  ru: 'Russian',
  sv: 'Swedish',
  tr: 'Turkish',
  uk: 'Ukrainian',
  zh: 'Chinese'
};

const SCRIPTURE_FROM_BY_LANG = {
  en: 'Scripture from the',
  es: 'Escritura de la',
  fr: "Ecriture de la",
  pt: 'Escritura da',
  de: 'Schrift aus der',
  it: 'Scrittura dalla'
};

function normalizeLanguageInfo(rawLanguage) {
  const raw = String(rawLanguage || '').trim();
  if (!raw) {
    return { languageCode: 'und', languageLabel: 'Unknown' };
  }

  const lower = raw.toLowerCase();
  let languageCode = '';

  if (/^[a-z]{2}(?:-[a-z0-9]+)?$/.test(lower)) {
    languageCode = lower.slice(0, 2);
  } else if (/^[a-z]{3}$/.test(lower)) {
    languageCode = ISO3_TO_ISO2[lower] || lower;
  } else {
    for (const [name, code] of Object.entries(LANGUAGE_NAME_TO_CODE)) {
      if (lower.includes(name)) {
        languageCode = code;
        break;
      }
    }
  }

  if (!languageCode) languageCode = 'und';
  const languageLabel = LANGUAGE_CODE_TO_NAME[languageCode] || (raw.length <= 3 ? raw.toUpperCase() : raw);
  return { languageCode, languageLabel };
}

function resolveScriptureFromPrefix(preferredLanguageCode = '') {
  const normalized = normalizeLanguageInfo(preferredLanguageCode).languageCode;
  if (normalized && SCRIPTURE_FROM_BY_LANG[normalized]) {
    return SCRIPTURE_FROM_BY_LANG[normalized];
  }

  const appLocalized = typeof AppCtx?.translate === 'function'
    ? String(AppCtx.translate('Scripture from the') || '').trim()
    : '';
  if (appLocalized) return appLocalized;

  return SCRIPTURE_FROM_BY_LANG.en;
}

function stripScriptureFromPrefix(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return raw;

  const prefixes = Object.values(SCRIPTURE_FROM_BY_LANG)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  for (const prefix of prefixes) {
    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(`^${escapedPrefix}\\s+`, 'i');
    if (rx.test(raw)) {
      return raw.replace(rx, '').trim();
    }
  }
  return raw;
}

function buildCanonicalReference(apiResponse) {
  const fallback = String(apiResponse?.reference || 'Unknown Reference').trim() || 'Unknown Reference';
  const verses = Array.isArray(apiResponse?.verses) ? apiResponse.verses : [];
  if (!verses.length) return fallback;

  const first = verses[0] || {};
  const last = verses[verses.length - 1] || {};

  const book1 = String(first.book_name || '').trim();
  const book2 = String(last.book_name || book1).trim();
  const chap1 = Number(first.chapter);
  const chap2 = Number(last.chapter);
  const verse1 = Number(first.verse);
  const verse2 = Number(last.verse);

  if (!book1 || !Number.isFinite(chap1) || !Number.isFinite(verse1)) return fallback;
  if (!Number.isFinite(chap2) || !Number.isFinite(verse2)) return `${book1} ${chap1}:${verse1}`;

  if (book1 === book2 && chap1 === chap2) {
    if (verse1 === verse2) return `${book1} ${chap1}:${verse1}`;
    return `${book1} ${chap1}:${verse1}-${verse2}`;
  }
  if (book1 === book2) {
    return `${book1} ${chap1}:${verse1}-${chap2}:${verse2}`;
  }
  return `${book1} ${chap1}:${verse1} - ${book2} ${chap2}:${verse2}`;
}

const bibleTextPlugin = {
  priority: 88,
  version: '0.2.7',
  clientHookJS: 'client.js',
  pluginButtons: [
      { "title": "Bible Text", "page": "search.html" },
    ],
  configTemplate: [
      { name: 'esvApiKey', type: 'string', description: 'ESV API key (from api.esv.org)', default: '' },
      { name: 'bibleAPI', type: 'string', description: 'Bible API URL ("none" to disable)', default: 'https://bible-api.com' },
      { name: 'defaultTranslation', type: 'string', description: 'Default Bible Translation ID (e.g., "KJV.local")', default: 'KJV.local' }
  ],

  register(AppContext) {
    AppCtx = AppContext;
    AppContext.log('[bibletext] Plugin registered.');
    localBibles.loadBibles(path.join(AppContext.config.pluginFolder,'bibletext','bibles'));
  },

  getCfg() {
    const cfg = AppCtx.plugins['bibletext'].config;
    if(!cfg.bibleAPI) {
      cfg.bibleAPI = this.configTemplate.find(c => c.name === 'bibleAPI').default;
    }
    return cfg;
  },

  api: {
    'open-bibletext-dialog': async (_event, params = {}) => {
      const { slug, mdFile } = params;
      const win = new BrowserWindow({
        width: 900, height: 680, modal: true, parent: AppCtx.win,
        webPreferences: { preload: AppCtx.preload }
      });
      win.setMenu(null);
      const key = AppCtx.config.key;
      const query = new URLSearchParams({
        slug: slug || '',
        md: mdFile || '',
        nosidebar: '1'
      });
      if (params.returnKey) query.set('returnKey', params.returnKey);
      const url = `http://${AppCtx.hostURL}:${AppCtx.config.viteServerPort}/plugins_${key}/bibletext/search.html?${query.toString()}`;
      win.loadURL(url);
    },

    'get-translations': async () => {
      const https = require('https');
      const cfg = AppCtx.plugins['bibletext'].getCfg();
      const localList = localBibles.biblelist || [];

      // Step 1 — Convert local bibles to the same format
      const localTranslations = localList.map(b => {
        const lang = normalizeLanguageInfo(b?.info?.language);
        return {
          id: `${b.info.identifier.toUpperCase()}.local`,
          name: `${b.name} [${b.info.identifier.toUpperCase()}.local] (${lang.languageLabel})`,
          language: lang.languageLabel,
          languageCode: lang.languageCode,
          source: 'local'
        };
      });

      // Step 2 — Try online API fetch (non-fatal)
      let onlineTranslations = [];
      if(cfg.bibleAPI && cfg.bibleAPI.toLowerCase() !== 'none') {
        console.log("[bibletext] Fetching online translations from", cfg.bibleAPI);
        
        onlineTranslations = await new Promise(resolve => {
          https.get(cfg.bibleAPI + '/data', res => {
            let data = '';
            res.on('data', chunk => (data += chunk));
            res.on('end', () => {
              try {
                const json = JSON.parse(data);
                if (!Array.isArray(json.translations)) throw new Error('Bad format');

                const list = json.translations.map(t => {
                  const lang = normalizeLanguageInfo(t?.language);
                  return {
                    id: t.identifier.toUpperCase(),
                    name: `${t.name} [${t.identifier.toUpperCase()}] (${lang.languageLabel})`,
                    language: lang.languageLabel,
                    languageCode: lang.languageCode,
                    source: 'online'
                  };
                });

                resolve(list);
              } catch (err) {
                console.warn("⚠ Online translation fetch failed. Using local only.", err.message);
                resolve([]); // online failure → return empty list
              }
            });
          }).on('error', err => {
            console.warn("⚠ Online translation fetch error:", err.message);
            resolve([]); // treat network error as no online list
          });
        });
      }

      // Step 3 — Merge online + local, with stable de-duplication by id
      const mergedTranslations = [...localTranslations, ...onlineTranslations];
      const seenIds = new Set();
      let translations = [];
      for (const item of mergedTranslations) {
        const normalizedId = String(item?.id || '').trim().toUpperCase();
        if (!normalizedId || seenIds.has(normalizedId)) continue;
        seenIds.add(normalizedId);
        translations.push(item);
      }
     
      // Sort alphabetically
      translations.sort((a, b) => a.name.localeCompare(b.name));

      // Add ESV API option if configured
      if (cfg.esvApiKey && cfg.esvApiKey.trim()) {
        translations.unshift({
          id: 'ESV',
          name: 'English Standard Version (api.esv.org)',
          language: 'English',
          languageCode: 'en',
          source: 'online'
        });
      }
    
      // Prioritize Default Translation
      let defaultTrans = 'KJV.local';
      if (cfg.defaultTranslation && cfg.defaultTranslation.trim()) {
        defaultTrans = cfg.defaultTranslation.trim();
      }
      const kjvIndex = translations.findIndex(t => t.id === defaultTrans);
      if (kjvIndex > -1) {
        const [kjv] = translations.splice(kjvIndex, 1);
        translations.unshift(kjv);
      }

      return { success: true, translations };
    },


    'fetch-passage': async (_event, { osis, translation, includeAttribution = true, customAttribution = '', referenceSlidePosition = 'end', translationLanguageCode = '' }) => {
      try {
        const cfg = AppCtx.plugins['bibletext'].getCfg();
        const customAttrib = String(customAttribution || '').trim();
        const referenceSlidePos = ['end', 'beginning', 'none'].includes(String(referenceSlidePosition || '').toLowerCase())
          ? String(referenceSlidePosition || '').toLowerCase()
          : 'end';
        let resolvedTranslationLanguageCode = normalizeLanguageInfo(translationLanguageCode).languageCode;

        let t = translation.toLowerCase();

        let localBible = false;
        // If the user selected a local bible (“KJV.local”), strip the suffix.
        if (t.endsWith('.local')) {
          t = t.slice(0, -6); // remove '.local'
          localBible = localBibles.biblelist.find(
            b => b.info.identifier.toLowerCase() === t
          );
          if (!localBible) {
            return { success: false, error: `Local Bible "${t}" not found.` };
          }
        }

        if (localBible) {
          if (!resolvedTranslationLanguageCode || resolvedTranslationLanguageCode === 'und') {
            resolvedTranslationLanguageCode = normalizeLanguageInfo(localBible?.info?.language).languageCode;
          }
          const scriptureFromPrefix = resolveScriptureFromPrefix(resolvedTranslationLanguageCode);
          const reference = osis.replace(/\./, " ").replace(/\./, ":");
          const result = localBibles.getVerse(localBible.id, reference);

          if (result.error) {
            return { success: false, error: result.error };
          }

          // convert to your API-like structure
          let copyright = `\n\n:ATTRIB:${scriptureFromPrefix} ${localBible.name}`;
          if(localBible.name !== localBible.info.identifier.toUpperCase()) {
            copyright += ` (${localBible.info.identifier.toUpperCase()})`;
          }
          const data = {
            verses: result.verses.map(v => ({
              book_name: result.book,
              chapter: result.chapter,
              verse: v.num,
              text: v.text
            })),
            reference: reference,
            translation_name: localBible.name,
            translation_id: localBible.info.identifier,
            copyright: copyright
          };

          return { success: true, markdown: formatVersesMarkdown(data, includeAttribution, customAttrib, referenceSlidePos, scriptureFromPrefix) };
        }

        const scriptureFromPrefix = resolveScriptureFromPrefix(resolvedTranslationLanguageCode);

        // 2) ESV via API
        if (t === 'esv') {
          const data = await fetchESVPassage(osis, cfg.esvApiKey, scriptureFromPrefix);
          return { success: true, markdown: formatVersesMarkdown(data, includeAttribution, customAttrib, referenceSlidePos, scriptureFromPrefix) };
        }

        // 3) Bible-API or other external API
        const data = await fetchPassage(cfg.bibleAPI, osis, translation, scriptureFromPrefix);
        return { success: true, markdown: formatVersesMarkdown(data, includeAttribution, customAttrib, referenceSlidePos, scriptureFromPrefix) };

      } catch (err) {
        AppCtx.error('[bibletext] fetch error:', err.message);
        return { success: false, error: err.message };
      }
    },


    'insert-passage': async (_event, { slug, mdFile, markdown }) => {
      const mdPath = path.join(AppCtx.config.presentationsDir, slug, mdFile);
      fs.appendFileSync(mdPath, '\n\n' + markdown + '\n');
      return { success: true };
    }
  }
};

async function fetchESVPassage(osis, apiKey, scriptureFromPrefix = 'Scripture from the') {
  const https = require('https');
  const query = encodeURIComponent(osis);
  const options = {
    hostname: 'api.esv.org',
    path: `/v3/passage/text/?q=${query}&include-passage-references=true&include-verse-numbers=true&include-footnotes=false&include-headings=false&include-short-copyright=false`,
    headers: { Authorization: `Token ${apiKey}` }
  };

  return new Promise((resolve, reject) => {
    https.get(options, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try {
          const obj = JSON.parse(data);
          const raw = obj.passages?.[0] || '';
          const ref = obj.canonical || osis;

          // 🔹 Clean and split by verse markers like [16], [17] etc.
          const verseMatches = [...raw.matchAll(/\[(\d+)\]\s*([^[]+)/g)];
          const verses = verseMatches.map(m => ({
            book_name: '', // not provided by ESV
            chapter: '',   // not provided, we can leave blank
            verse: parseInt(m[1]),
            text: m[2].trim()
          }));

          resolve({
            reference: ref,
            translation_name: 'English Standard Version',
            translation_id: 'esv',
            copyright: `\n\n:ATTRIB:${scriptureFromPrefix} ESV® Bible © 2001 by Crossway`,
            copyrightFull: 'Scripture quotations are from the ESV® Bible (The Holy Bible, English Standard Version®), © 2001 by Crossway, a publishing ministry of Good News Publishers. Used by permission. All rights reserved. The ESV text may not be quoted in any publication made available to the public by a Creative Commons license. The ESV may not be translated into any other language.',
            verses
          });
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', reject);
  });
}

async function fetchPassage(apiBase, osis, trans, scriptureFromPrefix = 'Scripture from the') {
  const url = `${apiBase}/${encodeURIComponent(osis)}?translation=${encodeURIComponent(trans)}`;
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const obj = JSON.parse(data);
          obj.copyright = obj.translation_name ? `\n\n:ATTRIB:${scriptureFromPrefix} ${obj.translation_name} (${(obj.translation_id || '').toUpperCase()})` : '';
          resolve(obj);
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', reject);
  });
}

function formatVersesMarkdown(apiResponse, includeAttribution = true, customAttribution = '', referenceSlidePosition = 'end', scriptureFromPrefix = 'Scripture from the') {
  if (!apiResponse) return '⚠️ No passage data.';
  const verses = apiResponse.verses || [];
  const ref = buildCanonicalReference(apiResponse);
  const translation = apiResponse.translation_name || apiResponse.translation_id || '';
  const customAttrib = String(customAttribution || '').trim();
  const referenceAttribution = stripScriptureFromPrefix(customAttrib || translation);
  const copyright = includeAttribution
    ? (customAttrib ? `\n\n:ATTRIB:${scriptureFromPrefix} ${customAttrib}` : (apiResponse.copyright || ''))
    : '';

  const body = verses.map(v => {
    // Normalize: strip leading/trailing spaces, preserve line breaks
    const text = v.text
      .replace(/\[/g, '*')             // Bible module italics markers: [text] -> *text*
      .replace(/\]/g, '*')
      .replace(/\r/g, '')               // remove carriage returns
      .split('\n')                      // split into lines
      .map(line => line.trim())         // remove all leading/trailing whitespace
      .filter(line => line.length > 0)  // remove empty lines
      .join('  \n');                    // Markdown double-space line break

    // Build full verse reference
    const book = v.book_name || (ref.split(' ')[0] ?? '');
    const chap = v.chapter || (ref.match(/\d+/)?.[0] ?? '');
    const verseRef = `${book} ${chap}:${v.verse}`.trim();

    // Return formatted block — no blank line before reference
    return `${text}  \n<cite>${verseRef}</cite>${copyright}`;
  }).join('\n\n---\n\n');

  const referenceSlide = `### ${ref}\n\n*${referenceAttribution}*` +
    (apiResponse.copyrightFull ? `\n\n<cite class="attrib">${apiResponse.copyrightFull}</cite>` : '');

  if (referenceSlidePosition === 'none') {
    return body + `\n\n***\n\n`;
  }

  if (referenceSlidePosition === 'beginning') {
    return referenceSlide + `\n\n---\n\n` + body + `\n\n***\n\n`;
  }

  return body + `\n\n---\n\n` + referenceSlide + `\n\n***\n\n`;
}



module.exports = bibleTextPlugin;
