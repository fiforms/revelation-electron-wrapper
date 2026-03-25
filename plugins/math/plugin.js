const mathPlugin = {
  clientHookJS: 'client.js',
  exposeToBrowser: true,
  priority: 130,
  version: '11.11.1.a',
  config: {},
  configTemplate: [
    {
      name: 'typesetter',
      type: 'string',
      description: 'Math typesetting engine',
      default: 'mathjax2',
      ui: 'dropdown',
      dropdownsrc: function () {
        return ['mathjax2', 'mathjax3', 'katex'];
      }
    }
  ],
  register(AppContext) {
    AppContext.log('[math-plugin] Registered!');
  }
};

module.exports = mathPlugin;
