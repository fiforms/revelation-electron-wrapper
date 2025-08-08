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
      this.AppContext.log('example-echo trigger fired!')
    }
  }
}

module.exports = testPlugin;