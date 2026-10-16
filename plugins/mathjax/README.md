# MathJax Plugin

Shows mathematical equations on slides, typeset by [MathJax 4](https://www.mathjax.org/).
Formulas are written in TeX/LaTeX notation in a `:mathjax:` block, and the Rich Builder has a
**Math Formula…** editor with examples, a code cheat sheet and a live preview.

MathJax is bundled with the app, so equations work without an internet connection, both when
presenting and in offline exports. There are no settings.

> This plugin replaces the old `math` plugin (MathJax 2/3 or KaTeX loaded from a CDN). If `math`
> was enabled, it is enabled as `mathjax` automatically the next time the app starts.

## The `:mathjax:` block

```yaml
:mathjax:
  version: 4
  formula: x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}
```

| Key | Meaning |
|---|---|
| `formula` | The TeX code. Write it as is: no extra backslashes or delimiters. A multi-line value (`formula: |`) is joined into one line. |
| `display` | `block` (default): centered on its own line. `inline`: flows within the surrounding text. |
| `version` | Informational. Only MathJax 4 is included, so the formula is always rendered with MathJax 4. |

If you write a block by hand, quote the formula when it starts with `{` or `[` or contains `: ` or ` #`
(for example `formula: 'a: b'`); YAML would otherwise misread it. The Math Formula editor quotes for you.

An `inline` block sits on its own line in the markdown, but is typeset inside the paragraph, so put it on
the line directly before or after the text it belongs to:

```markdown
Einstein showed that
:mathjax:
  formula: E = mc^2
  display: inline
for every object at rest.
```

## Math Formula editor (Rich Builder)

In the Rich Builder, open the Animation menu (shooting-star button) and choose
**Math Formula…** under *Plugin Blocks*. Clicking an existing `:mathjax:` card opens the same editor.

1. Choose **Display** (own centered line, added at the end of the slide) or **Inline**
   (added at the end of the line your cursor is on).
2. Type your TeX code. The preview updates as you type, and mistakes are explained under it.
3. Click an **example** to start from a ready-made formula (quadratic formula, integral, matrix,
   piecewise function, chemical equation, …).
4. Open the **code cheat sheet** and click a code (`\frac{a}{b}`, `\sqrt{x}`, `\sum_{i=1}^{n}`,
   Greek letters, …) to add it at the cursor.
5. Click **Insert** (or **Apply** when editing).

Saving from the editor re-writes the block's YAML, so key order may change and YAML comments are
not kept. Other keys in the block are preserved.

## Quick reference

| Code | Result |
|---|---|
| `x^2`, `x^{10}` | Superscript |
| `x_i`, `x_{ij}` | Subscript |
| `\frac{a}{b}` | Fraction |
| `\sqrt{x}`, `\sqrt[3]{x}` | Roots |
| `\sum_{i=1}^{n}`, `\int_a^b`, `\lim_{x \to 0}` | Sum, integral, limit |
| `\alpha \beta \pi \theta` | Greek letters |
| `\le \ge \ne \approx \pm \times \cdot` | Symbols |
| `\left( … \right)` | Brackets that grow to fit |
| `\text{words}` | Plain text inside a formula |
| `\begin{pmatrix} a & b \\ c & d \end{pmatrix}` | Matrix (`&` separates cells, `\\` starts a new row) |
| `\cancel{x}` | Cross out |
| `\ce{2H2 + O2 -> 2H2O}` | Chemical equation |

MathJax supports most of LaTeX math, including the AMS packages, `\cancel`, `\ce` (chemistry),
`\mathtools`, `\physics` and more; the optional packages load automatically when used. See the
[MathJax TeX documentation](https://docs.mathjax.org/en/latest/input/tex/macros/index.html)
for the full list.

## Older presentations

Formulas written directly in a slide still work: `$$ … $$` and `\[ … \]` for display, `\( … \)`
for inline (a single `$` is not a delimiter, so prices like $5 are safe). In markdown, though, the
parser removes a backslash that comes before punctuation (`\\` becomes `\`, `\,` becomes `,`),
so these need doubled backslashes (`\\\\` for a matrix row break). The `:mathjax:` block avoids
that problem, which is why it is the recommended form.

## For developers

- `mathjax-block.js` parses, builds and renders the block; `mathjax-loader.js` loads MathJax;
  `client.js` is the plugin entry; `builder.js` is the editor dialog.
- The `mathjax/` folder (gitignored) is produced by `scripts/copy-plugins.js` from the `mathjax`
  dependency in `revelation/package.json`: `tex-svg.js` (TeX in, SVG out, one file),
  `input/tex/extensions/` (packages MathJax autoloads) and `fonts/` (glyph chunks loaded on demand).
  Run `npm run build` (or `node scripts/copy-plugins.js`) after `npm install` in `revelation/`.
- MathJax's right-click menu, accessibility explorer and speech output are turned off: they start a speech worker (blocked by the presentation page's CSP) and fetch files that are not bundled.
