// plugins/divideslides/client.js
// Registers the "Divide Slides" Content menu entry: splits long slides
// (song verses, pasted paragraphs) into multiple slides by line/word count.

(function () {
  function isBuilderPage(context) {
    return String(context?.page || '').trim().toLowerCase() === 'builder';
  }

  window.RevelationPlugins.divideslides = {
    name: 'divideslides',
    context: null,

    init(context) {
      this.context = context;
    },

    getBuilderTemplates() {
      if (!isBuilderPage(this.context)) return [];
      return [
        {
          label: '✂️ Divide Slides',
          onSelect: async () => {
            try {
              // Lazy-load builder-only code so presentation sessions skip parsing it.
              const mod = await import('./builder.js');
              return await mod.openDivideDialog();
            } catch (err) {
              console.error('[divideslides plugin] Failed to load divide dialog:', err);
              return { canceled: true };
            }
          }
        }
      ];
    }
  };
})();
