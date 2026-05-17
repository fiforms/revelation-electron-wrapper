/**
 * Video Stream plugin offline export handler.
 *
 * For offline presentations, the video stream UI controls are hidden since
 * there's no network connectivity. The video display element is included
 * but remains non-functional (no streams to receive).
 */

module.exports = {
  async export(ctx) {
    return {
      pluginListEntry: {
        baseURL: './_resources/plugins/videostream',
        clientHookJS: 'client.js',
        priority: 94,
        config: {
          displayMode: 'overlay',
          overlayPosition: 'top-right',
          overlayOpacity: 85,
          maxStreamBitrate: 3000
        }
      },
      copy: [
        { from: 'client.js', to: 'plugins/videostream/client.js' }
      ]
    };
  }
};
