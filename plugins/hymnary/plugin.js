/**
 * Hymnary Plugin for REVELation
 * Searches for public domain hymn lyrics on hymnary.org and inserts them as Markdown
 */

const { BrowserWindow, app } = require('electron');
const path = require('path');
const fs = require('fs');
const { parse } = require('csv-parse/sync');
let fetch;
try {
  // node-fetch v2 (CJS) exports the function directly, v3 (ESM) when required will be on .default
  const nf = require('node-fetch');
  fetch = nf && (nf.default || nf);
} catch (e) {
  // Fallback to global fetch (Node 18+ / Electron builds that expose fetch)
  if (typeof global.fetch === 'function') {
    fetch = global.fetch.bind(global);
  } else {
    throw e;
  }
}

const hymnaryPlugin = {
  name: 'hymnary',
  clientHookJS: 'client.js',
  priority: 81,
  version: '0.1.0',
  exposeToBrowser: true, // required for client.js to find it

  register(AppContext) {
    AppContext.log('[hymnary-plugin] Registered hymnary plugin.');

    // Define plugin API callable from renderer
    this.api = {
      openDialog: async (_event, params = {}) => {
        const win = new BrowserWindow({
          width: 700,
          height: 800,
          resizable: true,
          webPreferences: {
            preload: AppContext.preload,
          },
          
        });
        // win.webContents.openDevTools(); // Uncomment to debug
        win.setMenu(null);
        const url = `http://${AppContext.hostURL}:${AppContext.config.viteServerPort}/plugins_${AppContext.config.key}/hymnary/hymnarysearch.html?params=${encodeURIComponent(JSON.stringify(params))}`;
        AppContext.log(`[hymnary] Opening hymnsearch dialog: ${url}`);
        win.loadURL(url);
      },

      searchHymns: async (obj, query, limit = 10) => {
        AppContext.log(`[hymnary] Searching Hymnary.org for query: "${query}" (limit ${limit})`);
        const encoded = encodeURIComponent(`all:${query} in:text`);
        const url = `https://hymnary.org/texts?qu=${encoded}&export=csv&limit=${limit}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const csv = await response.text();
        return parse(csv, { columns: true, skip_empty_lines: true });
      },

      getLyrics: async (obj, textAuthNumber) => {
        AppContext.log(`[hymnary] Fetching lyrics for text auth number: ${textAuthNumber}`);
        const url = `https://hymnary.org/text/${textAuthNumber}`;
        const response = await fetch(url);
        const html = await response.text();
        console.log(html);

        // Extract "Representative Text" section
        let match = html.match(/<div[^>]*id=['"]at_fulltext['"][^>]*>([\s\S]+?)<div class=['"]authority_bottom_bar['"]/i);
        if (!match) {
          // fallback: sometimes markup slightly differs (e.g. capitalisation or missing bottom bar)
          match = html.match(/<div[^>]*id=['"]at_fulltext['"][^>]*>([\s\S]+?)<\/div>\s*<\/div>/i);
        }
        if (!match) return null;

        const inner = match[1];

        // Extract verses from <p>...</p> blocks
        const verses = [...inner.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map(v => v[1]);

        // Convert <br> to line breaks and strip tags
        const clean = verses
          .map(v => v
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<[^>]+>/g, '')
            .trim()
          )
          .filter(Boolean)
          .join('\n\n');

        return clean;


        return text;
      },

    };
  },
};

module.exports = hymnaryPlugin;
