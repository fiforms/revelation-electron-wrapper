import { preprocessMarkdown } from './markdown-preprocessor.js';

window.RevelationPlugins.credit_ccli = {
  name: 'credit_ccli',
  context: null,
  preprocessMarkdown,

  init(context) {
    this.context = context;
  }
};
