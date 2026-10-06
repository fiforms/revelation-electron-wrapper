// plugins/test/plugin.js
//
// Developer example/test plugin: demonstrates every plugin hook. Not for
// production use; not in the default plugin list.
//
// Hooks demonstrated: priority 42, clientHookJS 'client.js', register() adding a
// "Plugins > Example Test Plugin" menu item (via AppContext.mainMenuTemplate),
// and api['example-echo'] (IPC plugin-trigger 'test' 'example-echo').
// Note: api functions are invoked as api[name](...), so `this` inside them is the
// api object, not the plugin; 'example-echo' therefore uses the module-level plugin.

const testPlugin = {
  priority: 42,
  clientHookJS: 'client.js',
  AppContext: null,
  register(AppContext) {
    AppContext.log('[test-plugin] Registered!');
    this.AppContext = AppContext;

    // Find the "Plugins" menu item
    const pluginsMenu = this.AppContext.mainMenuTemplate.find(menu => menu.label === 'Plugins');
    if (pluginsMenu && Array.isArray(pluginsMenu.submenu)) {
      pluginsMenu.submenu.push({
        label: 'Example Test Plugin',
        click: () => this.menuTest()
      });
    }
  },
  menuTest() {
      this.AppContext.log('example-echo Menu Clicked!');
  },
  api: {
    'example-echo': function(event,data) {
      testPlugin.AppContext?.log('example-echo trigger fired!');
      return { success: true, echo: data };
    }
  }
}

module.exports = testPlugin;