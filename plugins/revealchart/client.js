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
    script.async = false;
    script.addEventListener('load', () => {
      script.dataset.loaded = 'true';
      resolve();
    }, { once: true });
    script.addEventListener('error', () => reject(new Error(`Failed to load ${url}`)), { once: true });
    document.head.appendChild(script);
  });
}

window.RevelationPlugins.revealchart = {
  name: 'revealchart',
  context: null,
  _pluginPromise: null,
  preprocessMarkdown,

  // Builder menu entries are lazy-bound so presentation pages do not load
  // builder UI code unless the user explicitly opens an Add Content action.
  getBuilderTemplates() {
    return [
      {
        label: '📈 Insert Chart Block',
        template: '',
        onSelect: async (ctx) => {
          const mod = await import('./builder.js');
          return mod.openDataBuilderDialog(ctx, 'chart');
        }
      },
      {
        label: '📋 Insert Table Block',
        template: '',
        onSelect: async (ctx) => {
          const mod = await import('./builder.js');
          return mod.openDataBuilderDialog(ctx, 'table');
        }
      }
    ];
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
      await loadScript(`${localBase}/chart.umd.min.js`);
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
