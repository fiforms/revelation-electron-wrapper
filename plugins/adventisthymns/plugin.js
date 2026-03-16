/**
 * Adventist Hymns Plugin for REVELation
 * Scrapes hymn slides from adventisthymns.com and inserts them as Markdown
 */

const { BrowserWindow, app } = require('electron');
const path = require('path');
const fs = require('fs');
const {
  fetchHymnMarkdown,
  getHymnIndex
} = require('./service');

function appendSlidesMarkdown(presDir, mdFile, slidesMarkdown) {
  const mdPath = path.join(presDir, mdFile);
  if (!fs.existsSync(mdPath)) throw new Error(`Markdown not found: ${mdPath}`);
  fs.appendFileSync(mdPath, '\n\n' + slidesMarkdown + '\n');
}

function getHymnIndexCachePath() {
  return path.join(app.getPath('userData'), 'cache', 'adventisthymns-hymnindex.json');
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
        const hymnIndex = await getHymnIndex({
          cachePath: getHymnIndexCachePath(),
          logger: AppContext
        });

        try {
          const { markdown } = await fetchHymnMarkdown({
            number,
            logger: AppContext,
            hymnIndex,
            baseUrl
          });
          const md = markdown;
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
