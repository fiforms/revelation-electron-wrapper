const creditCcliPlugin = {
  clientHookJS: 'client.js',
  exposeToBrowser: true,
  defaultEnabled: true,
  priority: 120,
  version: '0.1.0',
  configTemplate: [
    {
      name: 'licenseNumber',
      type: 'string',
      default: '',
      description: 'CCLI License Number'
    }
  ],
  register(AppContext) {
    AppContext.log('[credit_ccli-plugin] Registered.');
  }
};

module.exports = creditCcliPlugin;
