// plugins/mathjax/mathjax-loader.js  (browser ES module, also copied for offline export)
// Loads the bundled MathJax 4 (mathjax/tex-svg.js, TeX in, SVG out; produced by
// scripts/copy-plugins.js) into the page, once. Used by client.js (presentations) and builder.js
// (the dialog preview). No CDN: the script, the TeX extensions it autoloads and the glyph chunks
// it loads on demand (mathjax/fonts/…) are all served from the plugin's own baseURL.
// Delimiters: \( \) inline, \[ \] and $$ $$ display. Single `$` is deliberately not a delimiter
// (it collides with prices in ordinary text). The MathJax menu and accessibility explorer/speech are off (see the options below).
// typesetFormulas() renders the `.mathjax-formula[data-tex]` elements that mathjax-block.js writes
// (it sets their delimited text from data-tex, then runs MathJax), plus any `$$…$$` / `\[…\]` /
// `\(…\)` text already in the page.
// Gotcha: window.MathJax must be configured before the script runs, so this refuses to reconfigure
// a MathJax that something else already loaded.

let loading = null;

// Resolve the global MathJax object once it has started.
export function loadMathJax(baseURL) {
  if (window.MathJax?.typesetPromise) return Promise.resolve(window.MathJax);
  if (loading) return loading;
  const root = new URL(`${String(baseURL || '.').replace(/\/$/, '')}/mathjax`, document.baseURI).href;
  window.MathJax = {
    tex: {
      inlineMath: [['\\(', '\\)']],
      displayMath: [['$$', '$$'], ['\\[', '\\]']],
      processEscapes: true
    },
    svg: { fontCache: 'global' },
    // Menu, explorer, speech and braille are all off: they start a speech worker (blocked by the
    // page's CSP) and fetch extra files from mathjax/ that are not bundled. The menu component
    // copies its own settings over the enable* options, so both must be switched off.
    options: {
      enableMenu: false,
      enableExplorer: false,
      enableSpeech: false,
      enableBraille: false,
      enableEnrichment: false,
      enableComplexity: false,
      menuOptions: {
        settings: { enrich: false, speech: false, braille: false, collapsible: false, assistiveMml: false, inTabOrder: false }
      }
    },
    loader: { paths: { fonts: `${root}/fonts` } },
    startup: { typeset: false }
  };
  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${root}/tex-svg.js`;
    script.async = true;
    script.onload = () => window.MathJax.startup.promise.then(() => resolve(window.MathJax), reject);
    script.onerror = () => reject(new Error(`MathJax failed to load from ${script.src}`));
    document.head.appendChild(script);
  }).catch((err) => {
    loading = null;
    throw err;
  });
  return loading;
}

// Typeset everything under `root` (default: the whole page). Safe to call repeatedly.
export async function typesetFormulas(mathjax, root = document.body) {
  const pending = [root, ...root.querySelectorAll('.mathjax-formula[data-tex]')]
    .filter((el) => el.matches('.mathjax-formula[data-tex]:not([data-typeset])'));
  pending.forEach((el) => {
    const tex = el.getAttribute('data-tex');
    el.textContent = el.classList.contains('mathjax-inline') ? `\\(${tex}\\)` : `\\[${tex}\\]`;
    el.setAttribute('data-typeset', '');
  });
  await mathjax.typesetPromise([root]);
}
