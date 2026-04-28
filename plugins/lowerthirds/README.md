# Lower Thirds Plugin

Overlays animated SVG lower-third graphics on slides using a simple markdown block syntax.

## Usage

Add a `:lt:` block anywhere in a slide's markdown:

```yaml
:lt:
  name: Person's Name
  title: Person's Title
  theme: colorful
```

`theme` is optional — it falls back to the plugin's `defaultStyle` setting (default: `colorful`).

> **Important:** Set **Slide View Distance** in your presentation settings to a value greater than the total number of slides in the show. Lower thirds are rendered when Reveal.js pre-loads a slide; if the slide hasn't been loaded yet, the overlay won't appear.

### Fields

| Field   | Required | Description                                      |
|---------|----------|--------------------------------------------------|
| `name`  | yes      | The person's name, rendered in the large text    |
| `title` | yes      | The person's title or role, rendered below name  |
| `theme` | no       | Theme name (filename without extension) to use   |

The `:lt:` block is stripped from printed/handout output automatically.

---

## Themes

A theme is a pair of files in the `themes/` directory:

```
themes/
  mytheme.svg   ← required: the lower-third graphic
  mytheme.css   ← optional: sidecar stylesheet (fonts, etc.)
```

### SVG template variables

Inside the SVG, use `{{name}}` and `{{title}}` as text placeholders — the plugin substitutes them at render time:

```xml
<text x="170" y="915" font-size="48">{{name}}</text>
<text x="172" y="960" font-size="28">{{title}}</text>
```

The SVG is sized to fill the slide canvas. Design your SVG at 1920×1080 (or use a matching `viewBox`) for best results.

### CSS sidecar — loading custom fonts

If your theme SVG uses a web font, create a matching `.css` file with the same base name. It is injected into the page automatically when the theme is first used:

```css
/* themes/mytheme.css */
@import url('/css/fonts/my_font/my_font.css');
```

Reference the font in your SVG with a `font-family` attribute:

```xml
<g font-family="'My Font', sans-serif">
  <text …>{{name}}</text>
</g>
```

The `colorful` theme ships as an example — see [themes/colorful.svg](themes/colorful.svg) and [themes/colorful.css](themes/colorful.css).

---

## Plugin configuration

In the plugin settings, `defaultStyle` sets the fallback theme name used when a `:lt:` block omits `theme`:

| Setting        | Default    | Description                          |
|----------------|------------|--------------------------------------|
| `defaultStyle` | `colorful` | Theme name used when none is specified |

---

## Adding a new theme

1. Create `themes/<name>.svg` with `{{name}}` and `{{title}}` placeholders.
2. Optionally create `themes/<name>.css` to load fonts or other styles.
3. Reference the theme by name in any `:lt:` block, or set it as `defaultStyle`.
