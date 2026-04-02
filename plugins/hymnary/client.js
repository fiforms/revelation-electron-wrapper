(function () {
  window.RevelationPlugins['hymnary'] = {
    name: 'hymnary',
    priority: 81,
    init(ctx) {
      this.context = ctx;
    },

    /*
    getListMenuItems(pres) {
      return [
        {
          label: '🎵 Insert Hymn from Hymnary.org…',
          action: async () => {
            // Ask Electron to open popup dialog, passing current presentation slug and markdown file
            await window.electronAPI.pluginTrigger('hymnary', 'openDialog', {slug: pres.slug, mdFile: pres.md});
          },
        },
      ];
    },
    */

    getContentCreators(pres) {
      return [
        {
          label: '🎵 Add Hymn from Hymnary.org…  (Ctrl+H)',
          action: async ({ slug, mdFile, returnKey }) => {
            await window.electronAPI.pluginTrigger('hymnary', 'openDialog', {
              slug: slug || pres.slug,
              mdFile: mdFile || pres.md,
              returnKey
            });
          }
        }
      ];
    },

    getBuilderExtensions({ host }) {
      host.registerKeyboardShortcut({
        key: 'h',
        ctrl: true,
        onTrigger() {
          host.triggerContentCreator('hymnary');
        }
      });
      return [];
    }
  };
})();
