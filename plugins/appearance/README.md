# Appearance Plugin

## Table of Contents
* [Overview](#appearance-overview)
* [What It Adds](#appearance-what-it-adds)
* [Shortcode Syntax](#appearance-shortcode-syntax)
* [Animation Presets](#appearance-presets)
* [Modifiers](#appearance-modifiers)
* [Examples](#appearance-examples)

---

<a id="appearance-overview"></a>
## Overview

The Appearance plugin adds entrance animations to slide elements using [reveal.js-appearance](https://github.com/martinomagnifico/reveal.js-appearance) by Martijn De Vis (martinomagnifico), which in turn uses [Animate.css](https://animate.style/) animation classes.

Elements can animate either on slide entry (automatically) or on demand as click-triggered fragments.

---

<a id="appearance-what-it-adds"></a>
## What It Adds

- Animate.css-based entrance animations for any slide element
- Two trigger modes: auto-animate on slide entry, or fragment (click to reveal)
- Optional letter-by-letter or word-by-word text splitting
- Optional speed control (slow / fast)
- Optional entry delay in milliseconds
- Markdown shortcode syntax so no raw HTML is required

---

<a id="appearance-shortcode-syntax"></a>
## Shortcode Syntax

Place a shortcode at the **end of the line** for the element you want to animate:

```
CONTENT ==:PRESET[:SPLIT][:SPEED][:DELAY]
CONTENT ++:PRESET[:SPLIT][:SPEED][:DELAY]
```

| Prefix | Trigger |
|--------|---------|
| `==` | Auto-animates when the slide appears (no click required) |
| `++` | Fragment — element is hidden until the user clicks/advances |

All parts after the preset are optional and can appear in any order.

The shortcode is stripped from the rendered output and converted into the appropriate Reveal.js `<!-- .element: ... -->` comment.

---

<a id="appearance-presets"></a>
## Animation Presets

### Fade
| Shortcode | Effect |
|-----------|--------|
| `drop` | Fade in from above |
| `dropBig` | Fade in from above (large travel) |
| `dropLeft` | Fade in from top-left corner |
| `dropRight` | Fade in from top-right corner |
| `rise` | Fade in from below |
| `riseBig` | Fade in from below (large travel) |
| `riseLeft` | Fade in from bottom-left corner |
| `riseRight` | Fade in from bottom-right corner |
| `fly` | Fade in from the left |
| `flyBig` | Fade in from the left (large travel) |
| `flyRight` | Fade in from the right |
| `flyRightBig` | Fade in from the right (large travel) |
| `fade` | Simple fade in |

### Bounce
| Shortcode | Effect |
|-----------|--------|
| `bounce` | Bounce in |
| `bounceDown` | Bounce in from above |
| `bounceUp` | Bounce in from below |
| `bounceLeft` | Bounce in from the left |
| `bounceRight` | Bounce in from the right |

### Slide
| Shortcode | Effect |
|-----------|--------|
| `slide` | Slide in from the left |
| `slideRight` | Slide in from the right |
| `slideDown` | Slide in from above |
| `slideUp` | Slide in from below |

### Zoom
| Shortcode | Effect |
|-----------|--------|
| `zoom` | Zoom in |
| `zoomDown` | Zoom in from above |
| `zoomUp` | Zoom in from below |
| `zoomLeft` | Zoom in from the left |
| `zoomRight` | Zoom in from the right |

### Back
| Shortcode | Effect |
|-----------|--------|
| `backDown` | Back in from above |
| `backUp` | Back in from below |
| `backLeft` | Back in from the left |
| `backRight` | Back in from the right |

### Rotate
| Shortcode | Effect |
|-----------|--------|
| `rotate` | Rotate in |
| `rotateDownLeft` | Rotate in, pivoting down-left |
| `rotateDownRight` | Rotate in, pivoting down-right |
| `rotateUpLeft` | Rotate in, pivoting up-left |
| `rotateUpRight` | Rotate in, pivoting up-right |

### Flip / Roll
| Shortcode | Effect |
|-----------|--------|
| `flipX` | Flip in on the horizontal axis |
| `flipY` | Flip in on the vertical axis |
| `flipFull` | Full 3D page flip |
| `roll` | Roll in |
| `jack` | Jack in the box |

### Light Speed
| Shortcode | Effect |
|-----------|--------|
| `lightLeft` | Light-speed entrance from the left |
| `lightRight` | Light-speed entrance from the right |

### Specials
| Shortcode | Effect |
|-----------|--------|
| `hinge` | Hinge and fall away |

### Attention Seekers
| Shortcode | Effect |
|-----------|--------|
| `hop` | Bounce in place |
| `headShake` | Shake side to side |
| `heartbeat` | Heartbeat pulse |
| `pulse` | Gentle pulse |
| `tada` | Tada |
| `wobble` | Wobble |
| `jello` | Jello wobble |
| `rubber` | Rubber band |
| `shakeX` | Shake horizontally |
| `shakeY` | Shake vertically |
| `flash` | Flash |
| `swing` | Swing |

### Appearance Custom
These effects are provided by reveal.js-appearance itself rather than the base Animate.css library.

| Shortcode | Effect |
|-----------|--------|
| `shrink` | Shrink in |
| `shrinkBig` | Shrink in (large travel) |
| `shrinkBlur` | Shrink in with a blur |
| `skidLeft` | Skid in from the left |
| `skidLeftBig` | Skid in from the left (far) |
| `skidRight` | Skid in from the right |
| `skidRightBig` | Skid in from the right (far) |

---

<a id="appearance-modifiers"></a>
## Modifiers

Append any of these after the preset name, separated by `:`.

### Split
Breaks text into individually animated pieces.

| Keyword | Effect |
|---------|--------|
| `let` | Animate letter by letter |
| `word` | Animate word by word |

### Speed
| Keyword | Effect |
|---------|--------|
| `slow` | Slower animation (Animate.css `animate__slower`) |
| `fast` | Faster animation (Animate.css `animate__faster`) |

### Delay
Any integer (milliseconds) delays the start of the animation after the slide appears or the fragment is triggered.

---

<a id="appearance-examples"></a>
## Examples

```markdown
# Welcome ==:drop

This heading fades in from above when the slide loads.
```

```markdown
- Point one
- Point two ==:fade
- Point three ==:fade:500
- Point four ==:fade:1000

Each bullet fades in on entry; the later ones are delayed.
```

```markdown
Big reveal! ++:bounce

This line is hidden and bounces in when the presenter clicks.
```

```markdown
LETTERS ++:drop:let:80

Each letter drops in one at a time, with an 80 ms delay between them.
```

```markdown
Slow entrance ==:zoom:slow

Zooms in slowly on slide entry.
```
