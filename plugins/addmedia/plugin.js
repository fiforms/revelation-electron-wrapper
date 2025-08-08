
// plugins/addmedia/plugin.js

let AppCtx = null;

const addMissingMediaPlugin = {
  clientHookJS: 'client.js',

  register(AppContext) {
    AppCtx = AppContext;
    AppContext.log('[add-missing-media-plugin] Registered!');
  },

  api: {
    'add-missing-media': async function (_event, data) {
      const { slug, mdFile } = data;
      const { addMissingMediaDialog } = require('./dialogHandler');
      await addMissingMediaDialog(slug, mdFile, AppCtx);
    },
    'process-missing-media': async function (_event, data) {
      // FIXME: Please Implement this.
      console.log('process-missing-media was triggered in addmedia plugin, but is not yet implemented');
    }
  }
};

module.exports = addMissingMediaPlugin;
