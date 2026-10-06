// plugins/slidecontrol/plugin.js
//
// Slide Control: on-screen navigation overlay for presentation view, plus
// remote slide control from other participants. Main-process half is metadata.
//
// Hooks / manifest fields:
//   - clientHookJS 'client.js', exposeToBrowser true, priority 96
//   - configTemplate / config keys: allowControlFromAnyClient (boolean,
//     default true). When false the overlay is local-only and read-only
//     follower sessions are disabled entirely.
//   - Realtime: client.js joins the shared presenter-plugins Socket.IO room
//     ('presenter-plugin:join' / 'presenter-plugin:event', plugin 'slidecontrol',
//     event type 'slideshow-control-command'); only the master session executes
//     incoming commands.
//   - manifest has collaboration:true, so Settings shows the collaboration banner.
//   - no IPC channels

const slidecontrolPlugin = {
  priority: 96,
  exposeToBrowser: true,
  clientHookJS: 'client.js',
  config: {},
  configTemplate: [
    {
      name: 'allowControlFromAnyClient',
      type: 'boolean',
      description: 'Allow control requests from remote peer clients through the shared socket.',
      default: true
    }
  ],
  register(AppContext) {
    AppContext.log('[slidecontrol-plugin] Registered');
  },
  api: {}
};

module.exports = slidecontrolPlugin;
