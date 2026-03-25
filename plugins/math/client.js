// plugins/math/client.js
// Loads the reveal.js math plugin (MathJax2, MathJax3, or KaTeX typesetter)

(function () {
  async function loadMathModule(baseURL) {
    try {
      return await import(`${baseURL}/math/plugin.bundle.mjs`);
    } catch (err) {
      const message = String(err?.message || '');
      const likelyMimeIssue =
        message.includes('Failed to fetch dynamically imported module') ||
        message.includes('Expected a JavaScript-or-Wasm module script');

      if (!likelyMimeIssue) {
        throw err;
      }

      return import(`${baseURL}/math/plugin.bundle.js`);
    }
  }

  window.RevelationPlugins['math'] = {
    name: 'math',
    context: null,

    init(context) {
      this.context = context;
    },

    async getRevealPlugins(isRemote) {
      const module = await loadMathModule(this.context.baseURL);
      const typesetter = (this.context.config.typesetter || 'mathjax2').toLowerCase();

      if (typesetter === 'katex') {
        return [module.default.KaTeX()];
      }
      if (typesetter === 'mathjax3') {
        return [module.default.MathJax3()];
      }
      // Default: mathjax2
      return [module.default.MathJax2()];
    }
  };
})();
