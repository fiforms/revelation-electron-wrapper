(function () {
  window.RevelationPlugins['adventisthymns'] = {
    name: 'adventisthymns',
    priority: 82,
    init(ctx) { this.context = ctx; },

    getListMenuItems(pres) {
        return [
        {
            label: "🎵 Insert Hymn from Adventist Hymns…",
            action: async () => {
            const number = await AppCtx.prompt?.("Enter hymn number (e.g. 101):") 
                        ?? prompt("Enter hymn number (e.g. 101):");
            if (!number) return;

            try {
                AppCtx.log(`[adventisthymns] Fetching hymn ${number}…`);
                const md = await fetchHymnSlides(number);

                if (window.electronAPI?.appendToCurrentPresentation) {
                await window.electronAPI.appendToCurrentPresentation(md);
                AppCtx.showToast?.(`✅ Hymn ${number} added to current presentation`);
                } else {
                await navigator.clipboard.writeText(md);
                alert(`✅ Hymn ${number} copied to clipboard.`);
                }
            } catch (err) {
                console.error("[adventisthymns] Error:", err);
                alert("❌ Failed to fetch hymn. Check your internet connection or hymn number.");
            }
            },
        },
        ];
    },
  };
})();