// plugins/bibletext/plugin.js
const { BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');

let AppCtx = null;

const bibleTextPlugin = {
  priority: 88,
  version: '0.1.3git',
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
      const url = `http://${AppCtx.hostURL}:${AppCtx.config.viteServerPort}/plugins_${key}/bibletext/search.html?slug=${encodeURIComponent(slug)}&md=${encodeURIComponent(mdFile)}&nosidebar=1`;
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
            copyright: '\n\n:ATTRIB:Scripture from the ESV® Bible © 2001 by Crossway',
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

async function fetchPassage(apiBase, osis, trans) {
  const url = `https://bible-api.com/${encodeURIComponent(osis)}?translation=${encodeURIComponent(trans)}`;
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const obj = JSON.parse(data);
          obj.copyright = obj.translation_name ? `\n\n:ATTRIB:Scripture from the ${obj.translation_name} (${(obj.translation_id || '').toUpperCase()})` : '';
          resolve(obj);
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', reject);
  });
}

function formatVersesMarkdown(apiResponse) {
  if (!apiResponse) return '⚠️ No passage data.';
  const verses = apiResponse.verses || [];
  const ref = apiResponse.reference || 'Unknown Reference';
  const translation = apiResponse.translation_name || apiResponse.translation_id || '';
  const copyright = apiResponse.copyright || '';

  const body = verses.map(v => {
    // Normalize: strip leading/trailing spaces, preserve line breaks
    const text = v.text
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
    return `${text}  \n*${verseRef}*${copyright}`;
  }).join('\n\n---\n\n');

  return body + `\n\n---\n\n*${ref} (${translation})*` + 
      (apiResponse.copyrightFull ? `\n\n${apiResponse.copyrightFull}` : '') +
      `\n\n***\n\n`;
}



module.exports = bibleTextPlugin;
