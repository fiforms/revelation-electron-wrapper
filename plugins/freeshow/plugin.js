// plugins/freeshow/plugin.js  (main process)
// Purpose: export a presentation as a FreeShow `.project` file.
// Hooks: priority 100, defaultEnabled:true (informational), exportFormats (one entry,
//   option includeSpeakerNotes), register(), api{}.
// IPC: pluginTrigger('freeshow', 'export_freeshow', { slug, options }) shows a native
//   Save dialog, then lib/freeshowExporter.js reads <presentationsDir>/<slug>/<md> and
//   writes the chosen file. No network. No clientHookJS (menu comes from exportFormats).
'use strict';

const { dialog } = require('electron');
const { exportFreeshow } = require('./lib/freeshowExporter');

let _AppContext = null;

module.exports = {
    priority: 100,
    defaultEnabled: true,

    exportFormats: [
        {
            id: 'freeshow',
            label: 'FreeShow (.project)',
            description: 'Export as a FreeShow project file',
            options: [
                {
                    type: 'checkbox',
                    key: 'includeSpeakerNotes',
                    label: 'Include speaker notes / description as slide notes',
                    default: true
                }
            ]
        }
    ],

    register(AppContext) {
        _AppContext = AppContext;
    },

    api: {
        export_freeshow: async (_event, { slug, options = {} }) => {
            if (!_AppContext) return { success: false, error: 'Plugin not initialized' };

            const { canceled, filePath } = await dialog.showSaveDialog({
                title: 'Export to FreeShow',
                defaultPath: `${slug}.project`,
                filters: [{ name: 'FreeShow Project', extensions: ['project'] }]
            });

            if (canceled || !filePath) return { success: false, canceled: true };

            try {
                await exportFreeshow(_AppContext, slug, options, filePath);
                return { success: true, filePath };
            } catch (err) {
                _AppContext.error(`❌ FreeShow export failed: ${err.message}`);
                return { success: false, error: err.message };
            }
        }
    }
};
