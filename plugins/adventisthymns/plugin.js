/**
 * Adventist Hymns Plugin for REVELation
 * Scrapes hymn slides from adventisthymns.com and inserts them as Markdown
 */

const { BrowserWindow } = require('electron');
const path = require('path');

const adventisthymnsPlugin = {
  name: 'adventisthymns',
  clientHookJS: 'client.js',
  priority: 82,
  exposeToBrowser: true, // required for client.js to find it

  register(AppContext) {
    AppContext.log('[adventisthymns-plugin] Registered adventisthymns plugin.');

    // Define plugin API callable from renderer
    this.api = {
      openDialog: async () => {
        const win = new BrowserWindow({
          width: 600,
          height: 500,
          resizable: true,
          webPreferences: {
            preload: AppContext.preload,
          },
        });

        win.setMenu(null);
        const url = `http://${AppContext.hostURL}:${AppContext.config.viteServerPort}/plugins_${AppContext.config.key}/adventisthymns/hymnsearch.html`;
        AppContext.log(`[adventisthymns] Opening hymnsearch dialog: ${url}`);
        win.loadURL(url);
      },

      // --- Fetch hymn slides from AdventistHymns.com and return Markdown ---
      async fetchHymnSlides(_event, number) {
        AppContext.log(`[adventisthymns] Fetching hymn ${number} from AdventistHymns.com`);
        const baseUrl = `https://adventisthymns.com/en/1985/s/${number}`;

        try {
          const response = await fetch(baseUrl, { redirect: 'follow' });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const html = await response.text();

          const { JSDOM } = require('jsdom');
          const dom = new JSDOM(html);
          const slides = [...dom.window.document.querySelectorAll('.reveal section')];

          const mdSlides = slides
            .map(sec => sec.textContent.trim())
            .filter(Boolean)
            .map(text => `***\n\n# ${text.replace(/\n+/g, '\n\n')}`)
            .join('\n\n');

          const md = `# Hymn ${number}\n\n${mdSlides}\n`;
          AppContext.log(`[adventisthymns] Parsed ${slides.length} slides.`);
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
