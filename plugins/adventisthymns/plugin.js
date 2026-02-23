/**
 * Adventist Hymns Plugin for REVELation
 * Scrapes hymn slides from adventisthymns.com and inserts them as Markdown
 */

const { BrowserWindow, app } = require('electron');
const path = require('path');
const fs = require('fs');

const jsdomPath = path.join(app.getAppPath(), 'node_modules', 'jsdom');
console.log(jsdomPath);
const { JSDOM } = require(jsdomPath);

function appendSlidesMarkdown(presDir, mdFile, slidesMarkdown) {
  const mdPath = path.join(presDir, mdFile);
  if (!fs.existsSync(mdPath)) throw new Error(`Markdown not found: ${mdPath}`);
  fs.appendFileSync(mdPath, '\n\n' + slidesMarkdown + '\n');
}

const adventisthymnsPlugin = {
  name: 'adventisthymns',
  clientHookJS: 'client.js',
  priority: 82,
  version: '0.2.7',
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

        try {
          const response = await fetch(baseUrl, { redirect: 'follow' });
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

              if (index === 0 && firstTitle) {
                slideParts.push(`# ${firstTitle}\n\n##### Hymn #${number}\n\n---\n\n`);
              }

              if (heading) {
                slideParts.push(`\n\n<cite>${heading}</cite>`);
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
