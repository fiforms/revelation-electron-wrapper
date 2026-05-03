const creditCcliPlugin = {
  clientHookJS: 'client.js',
  exposeToBrowser: true,
  defaultEnabled: true,
  priority: 120,
  version: '1.0.7',
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
