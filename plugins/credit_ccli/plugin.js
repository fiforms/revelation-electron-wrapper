// plugins/credit_ccli/plugin.js  (main process)
// Declares config and exposes client.js. Hooks: priority 120, exposeToBrowser, configTemplate;
// register() adds a provider to AppContext.presentationUrlParamProviders so presentation windows
// get `?ccli=<licenseNumber>`. Config keys: licenseNumber, streamingLicenseNumber.
// No IPC, network or file access. See client.js / markdown-preprocessor.js.
const creditCcliPlugin = {
  clientHookJS: 'client.js',
  exposeToBrowser: true,
  priority: 120,
  configTemplate: [
    {
      name: 'licenseNumber',
      type: 'string',
      default: '',
      description: 'CCLI Church Copyright License Number'
    },
    {
      name: 'streamingLicenseNumber',
      type: 'string',
      default: '',
      description: 'CCLI Streaming License Number'
    }
  ],
  register(AppContext) {
    AppContext.presentationUrlParamProviders.set('credit_ccli', (config) => ({
      ccli: String(config?.pluginConfigs?.credit_ccli?.licenseNumber || '').trim()
    }));
    AppContext.log('[credit_ccli-plugin] Registered.');
  }
};

module.exports = creditCcliPlugin;
