// plugins/mathjax/client.js  (browser)
// Hooks: init, preprocessMarkdown (`:mathjax:` YAML blocks -> formula HTML, from mathjax-block.js),
//   getRevealPlugins (a reveal.js plugin that loads the bundled MathJax 4 and typesets the slides,
//   via mathjax-loader.js), getBlockTools + onRichMacroEdit (Rich Builder: "Math Formula…" in the
//   Animation menu and the dialog for editing a `:mathjax:` card; both live in builder.js,
//   lazy-imported, builder page only).
// `$$…$$`, `\[…\]` and `\(…\)` written directly in a slide are typeset too (older presentations).
import { preprocessMathjaxBlocks } from './mathjax-block.js';
import { loadMathJax, typesetFormulas } from './mathjax-loader.js';

window.RevelationPlugins.mathjax = {
  name: 'mathjax',
  context: null,

  init(context) {
    this.context = context;
  },

  preprocessMarkdown(markdown, context = {}) {
    return preprocessMathjaxBlocks(markdown, context.parseYAML);
  },

  async getRevealPlugins() {
    const baseURL = this.context.baseURL;
    return [{
      id: 'mathjax',
      async init(deck) {
        try {
          const mathjax = await loadMathJax(baseURL);
          // Typeset now and again at 'ready': the markdown plugin may not have built the slides yet.
          const typeset = async () => {
            await typesetFormulas(mathjax, deck.getSlidesElement());
            deck.layout();
          };
          deck.on('ready', () => typeset().catch((err) => console.warn('[mathjax] Typesetting failed:', err)));
          await typeset();
        } catch (err) {
          console.warn('[mathjax] MathJax unavailable; formulas will show as plain TeX:', err);
        }
      }
    }];
  },

  // Rich Builder Animation menu, "Plugin Blocks" section (getBlockTools hook).
  getBlockTools() {
    if (String(this.context?.page || '').trim().toLowerCase() !== 'builder') return [];
    return [
      {
        label: tr('Math Formula…'),
        onSelect: async (ctx) => {
          const mod = await import('./builder.js');
          return mod.insertMathFormula(ctx, this.context.baseURL);
        }
      }
    ];
  },

  // Rich Builder: clicking a `:mathjax:` card opens the formula dialog.
  async onRichMacroEdit(payload) {
    if (payload?.tag !== ':mathjax:') return false;
    const mod = await import('./builder.js');
    return mod.editMathFormulaCard(payload, this.context.baseURL);
  }
};
