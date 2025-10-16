// plugins/bibletext/plugin.js
const { BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');

let AppCtx = null;

const bibleTextPlugin = {
  priority: 88,
  clientHookJS: 'client.js',
  pluginButtons: [
      { "title": "Bible Text", "page": "search.html" },
    ],
  configTemplate: [
      { name: 'esvApiKey', type: 'string', description: 'ESV API key (from api.esv.org)', default: '' }
  ],

  register(AppContext) {
    AppCtx = AppContext;
    AppContext.log('[bibletext] Plugin registered.');
  },

  api: {
    'open-bibletext-dialog': async (_event, { slug, mdFile }) => {
      const win = new BrowserWindow({
        width: 600, height: 400, modal: true, parent: AppCtx.win,
        webPreferences: { preload: AppCtx.preload }
      });
      win.setMenu(null);
      const key = AppCtx.config.key;
      const url = `http://${AppCtx.hostURL}:${AppCtx.config.viteServerPort}/plugins_${key}/bibletext/search.html?slug=${encodeURIComponent(slug)}&md=${encodeURIComponent(mdFile)}`;
      win.loadURL(url);
    },

'get-translations': async () => {
  const https = require('https');
  const cfg = AppCtx.plugins['bibletext'].config;

  return new Promise((resolve, reject) => {
    https.get('https://bible-api.com/data', res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (!Array.isArray(json.translations)) {
            throw new Error('Unexpected response format');
          }

          // Extract identifier and name
          let translations = json.translations.map(t => ({
            id: t.identifier.toUpperCase(),
            name: `${t.name} (${t.language})`
          }));

          // ✅ Sort alphabetically
          translations.sort((a, b) => a.name.localeCompare(b.name));

          // ✅ Prioritize KJV at top
          const kjvIndex = translations.findIndex(t => t.id === 'KJV');
          if (kjvIndex > -1) {
            const [kjv] = translations.splice(kjvIndex, 1);
            translations.unshift(kjv);
          }

          // ✅ If ESV key is present, put ESV first (it’s not in bible-api list)
          if (cfg.esvApiKey && cfg.esvApiKey.trim()) {
            translations.unshift({ id: 'ESV', name: 'English Standard Version (api.esv.org)' });
          }

          resolve({ success: true, translations });
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', reject);
  }).catch(err => ({ success: false, error: err.message }));
},



    'fetch-passage': async (_event, { osis, translation }) => {
        try {
            const cfg = AppCtx.plugins['bibletext'].config;
            let data;

            if (translation.toLowerCase() === 'esv') {
            data = await fetchESVPassage(osis, cfg.esvApiKey);
            } else {
            data = await fetchPassage(cfg.apiBase, osis, translation);
            }

            return { success: true, markdown: formatVersesMarkdown(data) };
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

async function fetchESVPassage(osis, apiKey) {
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
            verses
          });
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', reject);
  });
}

async function fetchPassage(apiBase, osis, trans) {
  const url = `https://bible-api.com/${encodeURIComponent(osis)}?translation=${encodeURIComponent(trans)}`;
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const obj = JSON.parse(data);
          resolve(obj);
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', reject);
  });
}

function formatVersesMarkdown(apiResponse) {
  if (!apiResponse?.verses?.length) return 'No verses found.';

  const translation = apiResponse.translation_name || apiResponse.translation_id || '';
  const ref = apiResponse.reference || '';

  const verses = apiResponse.verses.map(v => {
    return `> **${v.book_name} ${v.chapter}:${v.verse}**  \n${v.text.trim()}`;
  }).join('\n\n---\n\n');

  return `### ${ref} (${translation})\n\n${verses}\n`;
}


module.exports = bibleTextPlugin;
