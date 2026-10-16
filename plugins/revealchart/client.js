// plugins/revealchart/client.js (ES module: static import of the preprocessor)
//
// Browser-side hook for RevealChart.
//   - preprocessMarkdown: turns :chart: / :table: YAML blocks into HTML
//     (markdown-preprocessor.js, table-processor.js, csv-utils.js)
//   - getBlockTools + onRichMacroEdit (Rich Builder: "Chart…" / "Table…" in the Animation menu
//     and the dialogs for editing a `:chart:` / `:table:` card; chart-builder.js and
//     table-builder.js, lazy-imported, builder page only)
//   - getRevealPlugins: loads vendored revealchart/chart.umd.js (or .min.js) and
//     revealchart/plugin.js on demand and returns window.RevealChart

import { preprocessMarkdown } from './markdown-preprocessor.js';

const LOCAL_DIR = '/revealchart';

// Load an external script exactly once and resolve when it is ready.
// Reuses existing <script> tags so repeated calls are idempotent.
function loadScript(url) {
  return new Promise((resolve, reject) => {
    const existing = Array.from(document.querySelectorAll('script')).find((s) => s.src === url);
    if (existing) {
      if (existing.dataset.loaded === 'true') {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`Failed to load ${url}`)), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = url;
    script.crossOrigin = 'anonymous';
    script.async = false;
    script.addEventListener('load', () => {
      script.dataset.loaded = 'true';
      resolve();
    }, { once: true });
    script.addEventListener('error', () => reject(new Error(`Failed to load ${url}`)), { once: true });
    document.head.appendChild(script);
  });
}

async function loadScriptWithFallback(urls) {
  let lastError = null;
  for (const url of urls) {
    try {
      await loadScript(url);
      return;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('Failed to load script asset');
}

window.RevelationPlugins.revealchart = {
  name: 'revealchart',
  context: null,
  _pluginPromise: null,
  preprocessMarkdown,

  // Rich Builder Animation menu, "Plugin Blocks" section (getBlockTools hook).
  getBlockTools() {
    if (String(this.context?.page || '').trim().toLowerCase() !== 'builder') return [];
    return [
      {
        label: tr('Chart…'),
        onSelect: async (ctx) => {
          const mod = await import('./chart-builder.js');
          return mod.insertChartBlock(ctx, () => this.ensureChartJs());
        }
      },
      {
        label: tr('Table…'),
        onSelect: async (ctx) => {
          const mod = await import('./table-builder.js');
          return mod.insertTableBlock(ctx);
        }
      }
    ];
  },

  // Rich Builder: clicking a `:chart:` / `:table:` card opens its dialog.
  async onRichMacroEdit(payload) {
    if (payload?.tag === ':chart:') {
      const mod = await import('./chart-builder.js');
      return mod.editChartCard(payload, () => this.ensureChartJs());
    }
    if (payload?.tag === ':table:') {
      const mod = await import('./table-builder.js');
      return mod.editTableCard(payload);
    }
    return false;
  },

  // Load only Chart.js (no reveal plugin); the builder dialog uses it for its live preview.
  async ensureChartJs() {
    if (!window.Chart) {
      const localBase = `${this.context.baseURL}${LOCAL_DIR}`;
      await loadScriptWithFallback([`${localBase}/chart.umd.js`, `${localBase}/chart.umd.min.js`]);
    }
    if (!window.Chart) throw new Error('Chart.js did not register on window after script load');
    return window.Chart;
  },

  // Plugin loader initialization hook.
  // Receives base URL and config from revelation/js/pluginloader.js.
  init(context) {
    this.context = context;
  },

  // Ensure Chart.js + revealchart runtime scripts are loaded before Reveal init.
  // Promise is memoized so multiple callers share the same load operation.
  async ensureLoaded() {
    if (this._pluginPromise) {
      return this._pluginPromise;
    }

    const localBase = `${this.context.baseURL}${LOCAL_DIR}`;

    this._pluginPromise = (async () => {
      await loadScriptWithFallback([
        `${localBase}/chart.umd.js`,
        `${localBase}/chart.umd.min.js`
      ]);
      await loadScript(`${localBase}/plugin.js`);

      if (!window.RevealChart) {
        throw new Error('RevealChart did not register on window after script load');
      }
    })();

    return this._pluginPromise;
  },

  // Reveal plugin hook: return the runtime Reveal plugin instances.
  async getRevealPlugins() {
    await this.ensureLoaded();
    return [window.RevealChart];
  }
};
