/**
 * Hymnary Plugin for REVELation
 * Searches for public domain hymn lyrics on hymnary.org and inserts them as Markdown
 */

const { BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { parse } = require('csv-parse/sync');
const { ref } = require('process');
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

function appendSlidesMarkdown(presDir, mdFile, slidesMarkdown) {
  const mdPath = path.join(presDir, mdFile);
  if (!fs.existsSync(mdPath)) throw new Error(`Markdown not found: ${mdPath}`);
  fs.appendFileSync(mdPath, '\n\n' + slidesMarkdown + '\n');
}

const hymnaryPlugin = {
  name: 'hymnary',
  clientHookJS: 'client.js',
  priority: 81,
  version: '0.2.7',
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
        //win.webContents.openDevTools(); // Uncomment to debug
        win.setMenu(null);
        const query = new URLSearchParams({
          slug: params.slug || '',
          md: params.mdFile || ''
        });
        if (params.returnKey) query.set('returnKey', params.returnKey);
        const url = `http://${AppContext.hostURL}:${AppContext.config.viteServerPort}/plugins_${AppContext.config.key}/hymnary/hymnarysearch.html?${query.toString()}`;
        AppContext.log(`[hymnary] Opening hymnsearch dialog: ${url}`);
        win.loadURL(url);
      },

      searchHymns: async (obj, params) => {
        AppContext.log(`[hymnary] Searching Hymnary.org for query: "${params.query}" (language ${params.language} limit ${params.limit})`);
        const encoded = encodeURIComponent(`all:${params.query} in:text textClassification:textIsPublicDomain textLanguages:${params.language}`);
        const url = `https://hymnary.org/texts?qu=${encoded}&export=csv&limit=${params.limit}`;
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

        // Convert <br> to real newlines and strip tags
        let rawText = verses
          .map(v => v
            .replace(/\n/gi, ' ')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<[^>]+>/g, '')
            .trim()
          )
          .filter(Boolean)
          .join('\n\n'); // double newlines separate paragraphs

        // Normalize newlines
        rawText = rawText.replace(/\r\n/g, '\n');

        // Split paragraphs (each <p> block from hymnary)
        const paragraphs = rawText.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);

        let slides = [];
        let refrainBlock = null;
        let pendingRefrainTitle = '';

        for (let para of paragraphs) {
          // Detect Chorus/Refrain markers

          const paraLines = para.split(/\n+/).map(l => l.trim()).filter(Boolean);

          const chorusMatch = paraLines[0].match(/^(chorus|refrain)\s*[:.]?\s*(.*)$/i);
          if (chorusMatch) {
            const tag = chorusMatch[1].replace(/[:.]$/, '').trim();
            paraLines.shift(); // remove the chorus/refrain title line
            const remainder = paraLines.join('  \n');

            // If there’s text after "Refrain:", that’s the refrain body
            if (remainder) {
              refrainBlock = `<cite>${tag}</cite>\n${remainder}`;
              slides.push(refrainBlock);
            } else {
              // otherwise the next paragraph is the refrain
              pendingRefrainTitle = tag;
            }
            continue;
          }

          // Verse number pattern: "1 Amazing grace..."
          const verseMatch = para.match(/^(\d+)[\s.]+(.*)$/s);
          let heading = '';
          if (verseMatch) {
            heading = `<cite>Verse ${verseMatch[1]}</cite>\n`;
            para = verseMatch[2];
          }

          // Split into lines and add two spaces at end of each for Markdown hard breaks
          const lines = para.split(/\n+/).map(l => l.trim()).filter(Boolean);
          const formatted = `${heading}${lines.map(l => `${l}  `).join('\n')}`;

          // If we just saw a "Chorus:" marker, this paragraph is the refrain text
          if (pendingRefrainTitle && !refrainBlock) {
            refrainBlock = `<cite>${pendingRefrainTitle}</cite>\n${formatted.replace(/^<cite>.*\n/, '')}`;
            pendingRefrainTitle = '';
          }

          // Detect inline [Chorus] or [Refrain] at end of paragraph
          if (/\[(chorus|refrain)\]/i.test(formatted) && refrainBlock) {
            const cleaned = formatted.replace(/\s*\[(chorus|refrain)\]\s*/gi, '').trim();
            slides.push(cleaned);
            slides.push(refrainBlock);
          } else if (verseMatch && refrainBlock) {
            // If this is a verse and we have a refrain, add the refrain after the verse
            slides.push(formatted);
            slides.push(refrainBlock);
          } else {
            slides.push(formatted);
          }
        }
        
        // Extract title from <h1>...</h1>
        let titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
        let title = titleMatch ? titleMatch[1].trim() : 'Untitled Hymn';

        // Extract author from <h2 id="Author">Author: <span property="name">...</span>
        let authorMatch = html.match(/<h2[^>]*id=["']Author["'][^>]*>\s*Author:\s*<span[^>]*property=["']name["'][^>]*>([^<]+)<\/span>/i);
        let author = authorMatch ? authorMatch[1].trim() : 'Unknown Author';

        const titleSlide = `# ${title}\n\n*by ${author}*\n\n(From [Hymnary.org](https://hymnary.org/text/${textAuthNumber}))`;
        slides.unshift(titleSlide);

        // Join slides properly (one per verse/refrain)
        const lyrics = slides.join('\n\n---\n\n') + '\n\n***\n';

        return { lyrics, title, author };

      },

      appendLyricsToMarkdown: async (obj, params) => {
        const { slug, mdFile, lyrics } = params;
        const presDir = path.join(AppContext.config.presentationsDir, slug);
        appendSlidesMarkdown(presDir, mdFile, lyrics);
        return { success: true };
      }

    };
  },
};

module.exports = hymnaryPlugin;
