(function () {
  const PLUGIN_NAME = 'lowerthirds';

  window.RevelationPlugins = window.RevelationPlugins || {};
  window.RevelationPlugins[PLUGIN_NAME] = {
    name: PLUGIN_NAME,
    baseURL: '',
    config: {},
    svgCache: {},
    cssInjected: new Set(),
    urlVariant: '',
    svgCounter: 0,

    // Synchronous markdown pre-processor: replace :lt: blocks with placeholder divs.
    preprocessMarkdown(md, context) {
      const parseYAML = context && typeof context.parseYAML === 'function'
        ? context.parseYAML
        : null;
      const forHandout = context && context.forHandout;

      // Match :lt: on its own line followed by indented YAML-like content.
      return md.replace(/^:lt:\r?\n((?:[ \t]+[^\r\n]*(?:\r?\n|$))+)/gm, (match, block) => {
        if (forHandout) return '';

        let params = {};
        if (parseYAML) {
          try {
            // Strip minimum leading indentation so yaml.load gets clean keys.
            const indentedLines = block.split('\n').filter(l => l.trim().length > 0);
            const minIndent = indentedLines.reduce((min, l) => {
              const m = l.match(/^([ \t]+)/);
              return m ? Math.min(min, m[1].length) : min;
            }, Infinity);
            const stripped = block
              .split('\n')
              .map(l => (isFinite(minIndent) && l.length >= minIndent) ? l.slice(minIndent) : l)
              .join('\n');
            params = parseYAML(stripped) || {};
          } catch {
            params = {};
          }
        }

        const theme = String(params.style || this.config.defaultStyle || 'colorful');
        const name  = String(params.name  || '');
        const title = String(params.title || '');

        const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
        return `<div class="lt-lower-third" data-lt-theme="${esc(theme)}" data-lt-name="${esc(name)}" data-lt-title="${esc(title)}"></div>\n\n`;
      });
    },

    init(context) {
      this.baseURL = String((context && context.baseURL) || '');
      this.config  = (context && context.config && typeof context.config === 'object') ? context.config : {};
      this.svgCache    = {};
      this.cssInjected = new Set();
      this.urlVariant  = new URLSearchParams(window.location.search).get('variant') || '';
      this.setupRevealHooks();
    },

    setupRevealHooks() {
      const trySetup = () => {
        if (window.deck && typeof window.deck.on === 'function') {
          window.deck.on('ready', () => this.processVisiblePlaceholders());
          window.deck.on('slidechanged', () => this.processVisiblePlaceholders());
        } else {
          setTimeout(trySetup, 100);
        }
      };
      trySetup();
    },

    processVisiblePlaceholders() {
      const config = window.deck?.getConfig?.() || {};
      const viewDistance = config.viewDistance || 3;
      const currentSlide = window.deck?.getIndices?.();

      if (!currentSlide) {
        this.processAllPlaceholders();
        return;
      }

      const { h: currentH } = currentSlide;

      let renderedCount = 0;
      let skippedCount = 0;

      // Get all top-level (horizontal) sections
      const allHorizontalSections = Array.from(document.querySelectorAll('section:not(section > section)'));

      // Process only placeholders within view distance of current slide
      document.querySelectorAll('.lt-lower-third').forEach(el => {
        const section = el.closest('section');
        if (!section) return;

        // Find the horizontal section (traverse up if this is a vertical section)
        let horizontalSection = section;
        while (horizontalSection.parentElement?.tagName === 'SECTION') {
          horizontalSection = horizontalSection.parentElement;
        }

        const sectionH = allHorizontalSections.indexOf(horizontalSection);
        const distance = Math.abs(sectionH - currentH);

        // Only render if within view distance
        if (distance <= viewDistance) {
          this.renderPlaceholder(el);
          renderedCount++;
        } else {
          skippedCount++;
        }
      });

    },

    processAllPlaceholders() {
      document.querySelectorAll('.lt-lower-third').forEach(el => {
        this.renderPlaceholder(el);
      });
    },

    renderPlaceholder(el) {
      const theme = el.dataset.ltTheme || 'default';
      const name  = el.dataset.ltName  || '';
      const title = el.dataset.ltTitle || '';
      const caption = el.dataset.ltCaption || '';
      const manager = el.dataset.ltManager || '';
      const managerData = el.dataset.ltManagerData || '';

      const safeName = theme.replace(/[^a-zA-Z0-9_-]/g, '');
      this.injectThemeCSS(safeName);
      this.fetchSVG(theme).then(svgText => {
        if (!svgText) {
          el.remove();
          return;
        }

        // Get slide dimensions from Reveal config (defaults match Reveal.js defaults).
        const cfg    = (window.deck && typeof window.deck.getConfig === 'function') ? window.deck.getConfig() : {};
        const slideW = Number(cfg.width)  || 960;
        const slideH = Number(cfg.height) || 700;

        // Determine SVG natural dimensions from viewBox (preferred) or width/height attrs.
        const { vw, vh } = this.getSVGDimensions(svgText);

        // Choose preserveAspectRatio alignment:
        // - SVG wider than slide → scale to fit width → align to bottom (YMax)
        // - SVG taller than slide → scale to fit height → center (YMid)
        const svgAspect   = vw / vh;
        const slideAspect = slideW / slideH;
        const alignY      = svgAspect >= slideAspect ? 'YMax' : 'YMid';
        const preserveAR  = `xMid${alignY} meet`;

        // Parse into a live SVG DOM node so animations run and we can set attrs cleanly.
        const parser = new DOMParser();
        const svgDoc = parser.parseFromString(svgText, 'image/svg+xml');
        const svgEl  = svgDoc.documentElement;

        if (svgEl.querySelector('parsererror')) {
          console.warn(`[lowerthirds] SVG parse error for theme "${theme}"`);
          el.remove();
          return;
        }

        // Make filter IDs unique to avoid conflicts with multiple SVGs on the page
        const svgId = `svg-${this.svgCounter++}`;
        const idMap = {};
        svgEl.querySelectorAll('[id]').forEach(elem => {
          const oldId = elem.id;
          const newId = `${oldId}-${svgId}`;
          idMap[oldId] = newId;
          elem.id = newId;
        });
        // Override CSS filter references with inline styles using new IDs
        if (idMap['text-glow']) {
          svgEl.querySelectorAll('.title, .presenter-name, .presenter-title').forEach(elem => {
            elem.setAttribute('style', `filter: url(#${idMap['text-glow']})`);
          });
        }

        // Fill data-lt-block elements with values from the placeholder dataset.
        const blocks = { name, title, caption };
        svgEl.querySelectorAll('[data-lt-block]').forEach(node => {
          const key = node.getAttribute('data-lt-block');
          if (Object.prototype.hasOwnProperty.call(blocks, key)) {
            node.textContent = blocks[key];
            if(manager) {
              node.setAttribute('data-lt-manager', manager);
              if(managerData) {
                node.setAttribute('data-lt-manager-data', managerData);
              }
            }
          }
        });

        // Apply cached data from ontime plugin if available
        if (manager === 'ontime' && window.RevelationPlugins?.ontime?.applyDataToElement) {
          svgEl.querySelectorAll('[data-lt-block]').forEach(node => {
            window.RevelationPlugins.ontime.applyDataToElement(node);
          });
        }

        svgEl.setAttribute('width',                slideW);
        svgEl.setAttribute('height',               slideH);
        svgEl.setAttribute('preserveAspectRatio',  preserveAR);

        // Ensure the parent slide section is a positioning context.
        const section = el.closest('section');
        if (!section) {
          return;
        }

        const sectionPosition = window.getComputedStyle(section).position;
        if (sectionPosition === 'static') {
          section.style.position = 'relative';
        }

        // Build a full-slide absolute wrapper and inject the inline SVG into it.
        const wrapper = document.createElement('div');
        wrapper.style.cssText = [
          'position:absolute',
          'top:0',
          'left:0',
          `width:${slideW}px`,
          `height:${slideH}px`,
          'pointer-events:none',
          'overflow:hidden',
          'z-index:10'
        ].join(';');

        wrapper.appendChild(document.importNode(svgEl, true));
        el.innerHTML = '';
        el.appendChild(wrapper);
      }).catch(err => {
        console.error(`[lowerthirds] Error rendering SVG for theme="${theme}":`, err);
      });
    },

    // Parse SVG viewBox or width/height to get natural canvas dimensions.
    getSVGDimensions(svgText) {
      const vbMatch = svgText.match(/viewBox\s*=\s*["']([^"']*)["']/i);
      if (vbMatch) {
        const parts = vbMatch[1].trim().split(/[\s,]+/);
        if (parts.length >= 4) {
          const vw = parseFloat(parts[2]);
          const vh = parseFloat(parts[3]);
          if (vw > 0 && vh > 0) return { vw, vh };
        }
      }
      const wMatch = svgText.match(/\bwidth\s*=\s*["']?([0-9.]+)/i);
      const hMatch = svgText.match(/\bheight\s*=\s*["']?([0-9.]+)/i);
      return {
        vw: wMatch ? parseFloat(wMatch[1]) : 1920,
        vh: hMatch ? parseFloat(hMatch[1]) : 1080
      };
    },

    // Fetch and inject the companion CSS sidecar for a theme (once per theme per page load).
    injectThemeCSS(safeName) {
      if (this.cssInjected.has(safeName)) {
        return Promise.resolve();
      }
      this.cssInjected.add(safeName);
      const url = `${this.baseURL}/themes/${safeName}.css`;
      return fetch(url).then(res => {
        if (!res.ok) return;
        return res.text();
      }).then(css => {
        if (!css) return;
        const isWordPress = Boolean(window.isWordPressContext);
        let styleCss = css;
        if (isWordPress) {
          const fontUrl = `${this.baseURL}/../fonts`;
          styleCss = css.replace(
            /@import\s+url\(['"]\/css\/fonts\/([^'"]+)['"]\)/g,
            (match, fontPath) => `@import url('${fontUrl}/${fontPath}')`
          );
        }
        const style = document.createElement('style');
        style.textContent = styleCss;
        document.head.appendChild(style);
      }).catch(() => {});
    },

    // Fetch SVG text from the plugin's themes/ directory, with per-theme caching.
    async fetchSVG(theme) {
      const cacheKey = `${theme}::${this.urlVariant}`;
      if (Object.prototype.hasOwnProperty.call(this.svgCache, cacheKey)) {
        return this.svgCache[cacheKey];
      }
      // Only allow safe theme names to prevent path traversal.
      const safeName = theme.replace(/[^a-zA-Z0-9_-]/g, '');
      if (!safeName) {
        this.svgCache[cacheKey] = null;
        return null;
      }
      try {
        const extension = this.urlVariant === 'lowerthirds' ? '.lt.svg' : '.svg';
        const url = `${this.baseURL}/themes/${safeName}${extension}`;
        const res = await fetch(url);
        if (!res.ok) {
          this.svgCache[cacheKey] = null;
          return null;
        }
        const text = await res.text();
        this.svgCache[cacheKey] = text;
        return text;
      } catch {
        this.svgCache[cacheKey] = null;
        return null;
      }
    },

    // Escape a string for safe insertion into SVG XML text content.
    escapeXml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
    }
  };
})();
