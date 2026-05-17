const videostreamPlugin = {
  priority: 94,
  version: '0.1.0',
  exposeToBrowser: true,
  clientHookJS: 'client.js',
  config: {},
  configTemplate: [
    // ===== Display Settings =====
    {
      name: 'displayMode',
      type: 'select',
      description: 'How incoming video streams are displayed.',
      options: [
        { value: 'overlay', label: 'Overlay (corner of slides)' },
        { value: 'background', label: 'Background (behind slides)' },
        { value: 'floating', label: 'Floating window' }
      ],
      default: 'overlay'
    },
    {
      name: 'overlayPosition',
      type: 'select',
      description: 'Where to place video overlay on slide.',
      options: [
        { value: 'top-left', label: 'Top Left' },
        { value: 'top-right', label: 'Top Right' },
        { value: 'bottom-left', label: 'Bottom Left' },
        { value: 'bottom-right', label: 'Bottom Right' }
      ],
      default: 'top-right'
    },
    {
      name: 'overlayOpacity',
      type: 'number',
      description: 'Opacity of video overlay (0-100).',
      default: 85,
      min: 0,
      max: 100
    },

    // ===== Video Capture Settings =====
    {
      name: 'videoWidth',
      type: 'number',
      description: 'Preferred video width in pixels (will adapt to device capability).',
      default: 640,
      min: 320,
      max: 1920
    },
    {
      name: 'videoHeight',
      type: 'number',
      description: 'Preferred video height in pixels (will adapt to device capability).',
      default: 480,
      min: 240,
      max: 1080
    },
    {
      name: 'videoFramerate',
      type: 'number',
      description: 'Target frames per second (fps). Lower values reduce bandwidth.',
      default: 24,
      min: 5,
      max: 60
    },

    // ===== Bitrate & Quality Settings =====
    {
      name: 'maxVideoBitrate',
      type: 'number',
      description: 'Max video bitrate in kbps (for LAN: 1500-5000). Controls quality/smoothness tradeoff.',
      default: 2500,
      min: 300,
      max: 10000
    },
    {
      name: 'maxAudioBitrate',
      type: 'number',
      description: 'Max audio bitrate in kbps. Typical: 32-128 kbps.',
      default: 64,
      min: 16,
      max: 256
    },
    {
      name: 'degradationPreference',
      type: 'select',
      description: 'What to sacrifice when bandwidth is limited.',
      options: [
        { value: 'maintain-framerate', label: 'Maintain Framerate (lower resolution)' },
        { value: 'maintain-resolution', label: 'Maintain Resolution (lower framerate)' },
        { value: 'balanced', label: 'Balanced (reduce both)' }
      ],
      default: 'maintain-framerate'
    }
  ],
  register(AppContext) {
    AppContext.log('[videostream-plugin] Registered');
  },
  api: {}
};

module.exports = videostreamPlugin;
