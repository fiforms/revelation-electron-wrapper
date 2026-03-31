// plugins/appearance/client.js
// Loads the reveal.js-appearance plugin for animate.css-based slide element animations

(function () {
  // Baked-in animation presets  (extend here to add more)
  const PRESETS = {
    // Fade
    drop:            'animate__fadeInDown',
    dropBig:         'animate__fadeInDownBig',
    dropLeft:        'animate__fadeInTopLeft',
    dropRight:       'animate__fadeInTopRight',
    rise:            'animate__fadeInUp',
    riseBig:         'animate__fadeInUpBig',
    riseLeft:        'animate__fadeInBottomLeft',
    riseRight:       'animate__fadeInBottomRight',
    fly:             'animate__fadeInLeft',
    flyBig:          'animate__fadeInLeftBig',
    flyRight:        'animate__fadeInRight',
    flyRightBig:     'animate__fadeInRightBig',
    fade:            'animate__fadeIn',
    // Bounce
    bounce:          'animate__bounceIn',
    bounceDown:      'animate__bounceInDown',
    bounceUp:        'animate__bounceInUp',
    bounceLeft:      'animate__bounceInLeft',
    bounceRight:     'animate__bounceInRight',
    // Slide
    slide:           'animate__slideInLeft',
    slideRight:      'animate__slideInRight',
    slideDown:       'animate__slideInDown',
    slideUp:         'animate__slideInUp',
    // Zoom
    zoom:            'animate__zoomIn',
    zoomDown:        'animate__zoomInDown',
    zoomUp:          'animate__zoomInUp',
    zoomLeft:        'animate__zoomInLeft',
    zoomRight:       'animate__zoomInRight',
    // Back
    backDown:        'animate__backInDown',
    backUp:          'animate__backInUp',
    backLeft:        'animate__backInLeft',
    backRight:       'animate__backInRight',
    // Rotate
    rotate:          'animate__rotateIn',
    rotateDownLeft:  'animate__rotateInDownLeft',
    rotateDownRight: 'animate__rotateInDownRight',
    rotateUpLeft:    'animate__rotateInUpLeft',
    rotateUpRight:   'animate__rotateInUpRight',
    // Flip / roll
    flipX:           'animate__flipInX',
    flipY:           'animate__flipInY',
    flipFull:        'animate__flip',
    roll:            'animate__rollIn',
    jack:            'animate__jackInTheBox',
    // Light speed
    lightLeft:       'animate__lightSpeedInLeft',
    lightRight:      'animate__lightSpeedInRight',
    // Specials
    hinge:           'animate__hinge',
    // Attention seekers
    hop:             'animate__bounce',
    headShake:       'animate__headShake',
    heartbeat:       'animate__heartBeat',
    pulse:           'animate__pulse',
    tada:            'animate__tada',
    wobble:          'animate__wobble',
    jello:           'animate__jello',
    rubber:          'animate__rubberBand',
    shakeX:          'animate__shakeX',
    shakeY:          'animate__shakeY',
    flash:           'animate__flash',
    swing:           'animate__swing',
    // reveal.js-appearance custom
    shrink:          'animate__shrinkIn',
    shrinkBig:       'animate__shrinkInBig',
    shrinkBlur:      'animate__shrinkInBlur',
    skidLeft:        'animate__skidLeft',
    skidLeftBig:     'animate__skidLeftBig',
    skidRight:       'animate__skidRight',
    skidRightBig:    'animate__skidRightBig',
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

    // Builder menu entries are lazy-bound so presentation pages do not load
    // builder UI code unless the user explicitly opens an Add Content action.
    getBuilderTemplates() {
      return [
        {
          label: '✨ Insert Animated Line',
          template: '',
          onSelect: async (ctx) => {
            const mod = await import('./builder.js');
            return mod.openAppearanceBuilderDialog(ctx);
          }
        }
      ];
    },

    init(context) {
      this.context = context;
      // reveal.js only hides `.fragment:not(.custom)`. The appearance plugin adds
      // `custom` to animated fragments, which removes them from that rule. The
      // appearance.css rule that re-hides them loads asynchronously, leaving a
      // window where the fragment is visible. Inject it synchronously here so it
      // is present before the appearance plugin's async CSS load completes.
      const style = document.createElement('style');
      style.textContent = '.reveal .fragment.custom:not(.visible){opacity:0!important;visibility:hidden!important}';
      document.head.appendChild(style);
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
      // Syntax:
      //   ++:preset[:let|word][:slow|fast][:delay_ms]  — animated fragment (reveal on click)
      //   ==:preset[:let|word][:slow|fast][:delay_ms]  — auto-animate on slide entry (no click)
      //
      // For fragment (++) lines that are list items, use data-parentfragment
      // instead of class so that the bootstrap post-processor can lift the value
      // onto the parent <li> after Reveal applies <!-- .element: --> attrs.
      // That yields a real <li class="fragment ..."> so bullet + content animate
      // together. Non-list lines and == lines use the standard class= path.
      return md.replace(/[^\S\n]*(\+\+|==):([A-Za-z][A-Za-z0-9]*(?::[a-z0-9]+)*)[^\S\n]*$/gm, (match, prefix, token, offset, string) => {
        const parts  = token.split(':');
        const preset = PRESETS[parts[0]];
        if (!preset) return match; // unknown preset — leave untouched

        const rest      = parts.slice(1);
        const split     = rest.map(p => SPLITS[p]).find(Boolean);
        const speed     = rest.map(p => SPEEDS[p]).find(Boolean);
        const delay     = rest.find(p => /^\d+$/.test(p));
        const isFragment = prefix === '++';

        const classes = [isFragment ? 'fragment animate__animated' : null, preset, speed].filter(Boolean).join(' ');

        const lineStart = string.lastIndexOf('\n', offset - 1) + 1;
        const lineEnd   = string.indexOf('\n', offset);
        const lineContent = lineEnd === -1 ? string.slice(lineStart) : string.slice(lineStart, lineEnd);
        const isListItem = isFragment && /^[ \t]*(?:\d+[.)]\s+|[-*+]\s+)/.test(lineContent);

        // End-of-paragraph: next line is blank (or this is the last line).
        // In that case lift the fragment to the whole <p>, just as list items
        // lift to <li>, so the full paragraph animates as one unit.
        let isEndOfParagraph = false;
        if (isFragment && !isListItem) {
          const nextLineStart = lineEnd === -1 ? string.length : lineEnd + 1;
          if (nextLineStart >= string.length) {
            isEndOfParagraph = true;
          } else {
            const nextLineEnd = string.indexOf('\n', nextLineStart);
            const nextLine = nextLineEnd === -1 ? string.slice(nextLineStart) : string.slice(nextLineStart, nextLineEnd);
            isEndOfParagraph = nextLine.trim() === '';
          }
        }

        const attrName = (isListItem || isEndOfParagraph) ? 'data-parentfragment' : 'class';
        let attrs = `${attrName}="${classes}"`;
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
