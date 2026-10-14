// plugins/appearance/client.js  (browser)
// Hooks: init, preprocessMarkdown (turns `==:preset[:split][:speed][:delay]` and
//   `++:...` line suffixes into `<!-- .element: ... -->` attributes),
//   getRevealPlugins (loads appearance/plugin.bundle.mjs, falling back to .js),
//   getSlideTools / getAnimationTools ("Appearance Animation..." dialog from builder.js).
// The PRESETS table below maps friendly names to animate.css classes; keep it in
// sync with builder-dialog-template.js and README.md.

(function () {
  const variant = new URLSearchParams(window.location.search).get('variant');
  const isConfidenceMonitor = variant === 'confidencemonitor';

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

  // Presets that make sense on text that is already on screen (the Attention
  // Seekers and Specials categories). `++:preset:keep` turns these into
  // click-triggered emphasis: the element stays visible and the animation
  // plays when the fragment is reached, instead of the element appearing.
  const KEEPABLE = ['hop', 'headShake', 'heartbeat', 'pulse', 'tada', 'wobble', 'jello', 'rubber', 'shakeX', 'shakeY', 'flash', 'swing', 'hinge'];

  // CSS for `fragment custom emphasis emphasis-<keyframe>` elements. `custom`
  // keeps reveal.js from hiding them; the hide rule below skips `.emphasis`.
  // Keyframes come from appearance.css (animate.css).
  function buildEmphasisCss() {
    const rules = KEEPABLE.map((key) => {
      const keyframe = PRESETS[key].replace('animate__', '');
      return `.reveal .fragment.emphasis-${keyframe}.visible{animation-name:${keyframe}}`;
    });
    return [
      '.reveal .fragment.emphasis{opacity:1!important;visibility:visible!important}',
      '.reveal .fragment.emphasis.visible{animation-duration:var(--animate-duration,1s);animation-fill-mode:both}',
      '.reveal .fragment.emphasis.emphasis-slow.visible{animation-duration:calc(var(--animate-duration,1s)*3)}',
      '.reveal .fragment.emphasis.emphasis-fast.visible{animation-duration:calc(var(--animate-duration,1s)*.5)}',
      ...rules
    ].join('');
  }

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

    // Slide Markdown Tools menu entry (and Rich Builder right-click menu),
    // lazy-bound so presentation pages do not load builder UI code.
    getSlideTools() {
      return this.getAnimationTools();
    },

    // Rich Builder Animation menu entry (getAnimationTools hook, menus.js).
    getAnimationTools() {
      if (isConfidenceMonitor) return [];
      return [
        {
          label: '✨ Appearance Animation…',
          onSelect: async (ctx) => {
            const mod = await import('./builder.js');
            return mod.openAppearanceBuilderDialog(ctx);
          }
        }
      ];
    },

    // Animate.css classes for a preset/speed, so the builder dialog's preview
    // reuses PRESETS/SPEEDS instead of keeping its own table.
    getPreviewClasses({ preset, speed } = {}) {
      return { presetClass: PRESETS[preset] || '', speedClass: SPEEDS[speed] || '' };
    },

    // Rich Builder: clicking a fragment (++ / ==) opens the animation dialog
    // for it. Works for a plain `++` too (animation "None").
    async onRichFragmentEdit(payload) {
      if (isConfidenceMonitor) return false;
      const mod = await import('./builder.js');
      await mod.openAppearanceBuilderDialog(null, payload);
      return true;
    },

    init(context) {
      if (isConfidenceMonitor) return;
      this.context = context;
      // reveal.js only hides `.fragment:not(.custom)`. The appearance plugin adds
      // `custom` to animated fragments, which removes them from that rule. The
      // appearance.css rule that re-hides them loads asynchronously, leaving a
      // window where the fragment is visible. Inject it synchronously here so it
      // is present before the appearance plugin's async CSS load completes.
      const style = document.createElement('style');
      style.textContent = '.reveal .fragment.custom:not(.visible):not(.emphasis){opacity:0!important;visibility:hidden!important}' + buildEmphasisCss();
      document.head.appendChild(style);

      // Load appearance.css (animate.css keyframes) ourselves. reveal.js-appearance
      // >=1.4.1 only autoloads its CSS when the script file is named
      // appearance.{js,mjs}; our renamed plugin.bundle.mjs makes it assume a
      // bundler build and skip the CSS, leaving classes with no animations.
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.id = 'appearance-css';
      link.href = `${context.baseURL}/appearance/appearance.css`;
      document.head.appendChild(link);
    },

    // Syntax:
    //   ++:preset[:let|word][:slow|fast][:delay_ms]  — animated fragment (reveal on click)
    //   ==:preset[:let|word][:slow|fast][:delay_ms]  — auto-animate on slide entry (no click)
    //   ++:preset:keep[:slow|fast]  — emphasis: text stays visible, animates on click
    //                                  (attention-seeker/special presets only)
    // Examples:
    //   This slides in on click. ++:drop
    //   This auto-animates on entry. ==:drop
    //   This bounces letter by letter on click. ++:bounce:let
    //   This drops in slowly after 800ms. ==:drop:slow:800
    //   This pulses on click, already visible. ++:heartbeat:keep
    preprocessMarkdown(md) {
      if (isConfidenceMonitor) return md;
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
        // `++:preset:keep` — emphasis on already-visible text (see KEEPABLE).
        const isKeep = isFragment && rest.includes('keep') && KEEPABLE.includes(parts[0]);
        const keyframe = preset.replace('animate__', '');

        const classes = isKeep
          ? ['fragment custom emphasis', `emphasis-${keyframe}`, rest.includes('slow') ? 'emphasis-slow' : null, rest.includes('fast') ? 'emphasis-fast' : null].filter(Boolean).join(' ')
          : [isFragment ? 'fragment animate__animated' : null, preset, speed].filter(Boolean).join(' ');

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
        // Emphasis plays in place, so splitting and delay don't apply.
        if (split && !isKeep) attrs += ` data-split="${split}"`;
        if (delay && !isKeep) attrs += ` data-delay="${delay}"`;

        return ` <!-- .element: ${attrs} -->`;
      });
    },

    async getRevealPlugins(isRemote) {
      if (isConfidenceMonitor) return [];
      const module = await loadAppearanceModule(this.context.baseURL);
      return [module.default()];
    }
  };
})();
