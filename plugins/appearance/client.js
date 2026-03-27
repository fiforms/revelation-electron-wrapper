// plugins/appearance/client.js
// Loads the reveal.js-appearance plugin for animate.css-based slide element animations

(function () {
  // Baked-in animation presets  (extend here to add more)
  const PRESETS = {
    // Fade
    drop:       'animate__fadeInDown',
    rise:       'animate__fadeInUp',
    fly:        'animate__fadeInLeft',
    flyRight:   'animate__fadeInRight',
    fade:       'animate__fadeIn',
    // Bounce
    bounce:     'animate__bounceIn',
    bounceDown: 'animate__bounceInDown',
    bounceUp:   'animate__bounceInUp',
    // Slide
    slide:      'animate__slideInLeft',
    slideUp:    'animate__slideInUp',
    // Zoom
    zoom:       'animate__zoomIn',
    zoomDown:   'animate__zoomInDown',
    zoomUp:     'animate__zoomInUp',
    zoomLeft:   'animate__zoomInLeft',
    zoomRight:  'animate__zoomInRight',
    // Back
    backDown:   'animate__backInDown',
    backUp:     'animate__backInUp',
    backLeft:   'animate__backInLeft',
    backRight:  'animate__backInRight',
    // Rotate / flip / roll
    rotate:     'animate__rotateIn',
    flipX:      'animate__flipInX',
    flipY:      'animate__flipInY',
    roll:       'animate__rollIn',
    jack:       'animate__jackInTheBox',
    // Attention seekers
    heartbeat:  'animate__heartBeat',
    pulse:      'animate__pulse',
    tada:       'animate__tada',
    wobble:     'animate__wobble',
    jello:      'animate__jello',
    rubber:     'animate__rubberBand',
    shakeX:     'animate__shakeX',
    shakeY:     'animate__shakeY',
    flash:      'animate__flash',
    swing:      'animate__swing',
  };

  // ++:split keywords → data-split values
  const SPLITS = { let: 'letters', word: 'words' };

  // ++:speed keywords → animate.css speed classes
  const SPEEDS = { slow: 'animate__slower', fast: 'animate__faster' };

  async function loadAppearanceModule(baseURL) {
    try {
      return await import(`${baseURL}/appearance/plugin.bundle.mjs`);
    } catch (err) {
      const message = String(err?.message || '');
      const likelyMimeIssue =
        message.includes('Failed to fetch dynamically imported module') ||
        message.includes('Expected a JavaScript-or-Wasm module script');

      if (!likelyMimeIssue) {
        throw err;
      }

      return import(`${baseURL}/appearance/plugin.bundle.js`);
    }
  }

  window.RevelationPlugins['appearance'] = {
    name: 'appearance',
    context: null,

    init(context) {
      this.context = context;
    },

    // Syntax:
    //   ++:preset[:let|word][:slow|fast][:delay_ms]  — animated fragment (reveal on click)
    //   ==:preset[:let|word][:slow|fast][:delay_ms]  — auto-animate on slide entry (no click)
    // Examples:
    //   This slides in on click. ++:drop
    //   This auto-animates on entry. ==:drop
    //   This bounces letter by letter on click. ++:bounce:let
    //   This drops in slowly after 800ms. ==:drop:slow:800
    preprocessMarkdown(md) {
      return md.replace(/\s*(\+\+|==):([a-z][a-z0-9]*(?::[a-z0-9]+)*)\s*$/gm, (match, prefix, token) => {
        const parts  = token.split(':');
        const preset = PRESETS[parts[0]];
        if (!preset) return match; // unknown preset — leave untouched

        const rest      = parts.slice(1);
        const split     = rest.map(p => SPLITS[p]).find(Boolean);
        const speed     = rest.map(p => SPEEDS[p]).find(Boolean);
        const delay     = rest.find(p => /^\d+$/.test(p));
        const isFragment = prefix === '++';

        const classes = [isFragment ? 'fragment' : null, preset, speed].filter(Boolean).join(' ');
        let attrs = `class="${classes}"`;
        if (split) attrs += ` data-split="${split}"`;
        if (delay) attrs += ` data-delay="${delay}"`;

        return ` <!-- .element: ${attrs} -->`;
      });
    },

    async getRevealPlugins(isRemote) {
      const module = await loadAppearanceModule(this.context.baseURL);
      return [module.default()];
    }
  };
})();
