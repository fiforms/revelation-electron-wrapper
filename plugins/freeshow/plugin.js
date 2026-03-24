'use strict';

const { dialog } = require('electron');
const { exportFreeshow } = require('./lib/freeshowExporter');

let _AppContext = null;

module.exports = {
    version: '0.1.0',
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
