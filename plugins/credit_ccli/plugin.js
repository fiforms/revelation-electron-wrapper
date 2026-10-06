// plugins/credit_ccli/plugin.js  (main process)
// Stub: declares config and exposes client.js. Hooks: priority 120, exposeToBrowser,
// configTemplate. Config keys: licenseNumber, streamingLicenseNumber.
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
    AppContext.log('[credit_ccli-plugin] Registered.');
  }
};

module.exports = creditCcliPlugin;
