# Plugin Appearance

## Tabla de Contenido
* [Resumen](#appearance-overview)
* [Qué Añade](#appearance-what-it-adds)
* [Sintaxis de Shortcodes](#appearance-shortcode-syntax)
* [Preajustes de Animación](#appearance-presets)
* [Modificadores](#appearance-modifiers)
* [Ejemplos](#appearance-examples)

---

<a id="appearance-overview"></a>
## Resumen

El plugin Appearance añade animaciones de entrada a los elementos de las diapositivas usando [reveal.js-appearance](https://github.com/martinomagnifico/reveal.js-appearance) de Martijn De Vis (martinomagnifico), que a su vez usa las clases de animación de [Animate.css](https://animate.style/).

Los elementos pueden animarse al entrar la diapositiva (automáticamente) o bajo demanda como fragmentos activados con un clic.

---

<a id="appearance-what-it-adds"></a>
## Qué Añade

- Animaciones de entrada basadas en Animate.css para cualquier elemento de la diapositiva
- Dos modos de activación: animación automática al entrar la diapositiva, o fragmento (clic para revelar)
- División opcional del texto letra por letra o palabra por palabra
- Control de velocidad opcional (lenta / rápida)
- Retardo de entrada opcional en milisegundos
- Sintaxis de shortcode en markdown, por lo que no se requiere HTML sin procesar

---

<a id="appearance-shortcode-syntax"></a>
## Sintaxis de Shortcodes

En el Constructor, coloca el cursor en una línea y elige **✨ Animation…** en el menú 🔧 de Herramientas de Markdown de Diapositiva (o haz clic derecho en el Rich Builder). El shortcode se añade al final de esa línea.

O escribe un shortcode al **final de la línea** del elemento que quieras animar:

```
CONTENT ==:PRESET[:SPLIT][:SPEED][:DELAY]
CONTENT ++:PRESET[:SPLIT][:SPEED][:DELAY]
```

| Prefijo | Activación |
|--------|---------|
| `==` | Se anima automáticamente cuando aparece la diapositiva (no requiere clic) |
| `++` | Fragmento: el elemento permanece oculto hasta que el usuario hace clic o avanza |

Todas las partes posteriores al preajuste son opcionales y pueden aparecer en cualquier orden.

El shortcode se elimina del resultado renderizado y se convierte en el comentario `<!-- .element: ... -->` de Reveal.js correspondiente.

---

<a id="appearance-presets"></a>
## Preajustes de Animación

### Fade
| Shortcode | Efecto |
|-----------|--------|
| `drop` | Aparece desde arriba |
| `dropBig` | Aparece desde arriba (recorrido largo) |
| `dropLeft` | Aparece desde la esquina superior izquierda |
| `dropRight` | Aparece desde la esquina superior derecha |
| `rise` | Aparece desde abajo |
| `riseBig` | Aparece desde abajo (recorrido largo) |
| `riseLeft` | Aparece desde la esquina inferior izquierda |
| `riseRight` | Aparece desde la esquina inferior derecha |
| `fly` | Aparece desde la izquierda |
| `flyBig` | Aparece desde la izquierda (recorrido largo) |
| `flyRight` | Aparece desde la derecha |
| `flyRightBig` | Aparece desde la derecha (recorrido largo) |
| `fade` | Aparición gradual simple |

---

### Bounce
| Shortcode | Efecto |
|-----------|--------|
| `bounce` | Entra con rebote |
| `bounceDown` | Entra con rebote desde arriba |
| `bounceUp` | Entra con rebote desde abajo |
| `bounceLeft` | Entra con rebote desde la izquierda |
| `bounceRight` | Entra con rebote desde la derecha |

### Slide
| Shortcode | Efecto |
|-----------|--------|
| `slide` | Se desliza desde la izquierda |
| `slideRight` | Se desliza desde la derecha |
| `slideDown` | Se desliza desde arriba |
| `slideUp` | Se desliza desde abajo |

---

### Zoom
| Shortcode | Efecto |
|-----------|--------|
| `zoom` | Entra con acercamiento |
| `zoomDown` | Entra con acercamiento desde arriba |
| `zoomUp` | Entra con acercamiento desde abajo |
| `zoomLeft` | Entra con acercamiento desde la izquierda |
| `zoomRight` | Entra con acercamiento desde la derecha |

### Back
| Shortcode | Efecto |
|-----------|--------|
| `backDown` | Entra con retroceso desde arriba |
| `backUp` | Entra con retroceso desde abajo |
| `backLeft` | Entra con retroceso desde la izquierda |
| `backRight` | Entra con retroceso desde la derecha |

---

### Rotate
| Shortcode | Efecto |
|-----------|--------|
| `rotate` | Entra rotando |
| `rotateDownLeft` | Entra rotando, con pivote abajo a la izquierda |
| `rotateDownRight` | Entra rotando, con pivote abajo a la derecha |
| `rotateUpLeft` | Entra rotando, con pivote arriba a la izquierda |
| `rotateUpRight` | Entra rotando, con pivote arriba a la derecha |

---

### Flip / Roll
| Shortcode | Efecto |
|-----------|--------|
| `flipX` | Entra con giro sobre el eje horizontal |
| `flipY` | Entra con giro sobre el eje vertical |
| `flipFull` | Giro completo de página en 3D |
| `roll` | Entra rodando |
| `jack` | Sorpresa de caja de resorte (jack in the box) |

### Light Speed
| Shortcode | Efecto |
|-----------|--------|
| `lightLeft` | Entrada a velocidad de la luz desde la izquierda |
| `lightRight` | Entrada a velocidad de la luz desde la derecha |

---

### Specials
| Shortcode | Efecto |
|-----------|--------|
| `hinge` | Se articula y cae |

### Attention Seekers
| Shortcode | Efecto |
|-----------|--------|
| `hop` | Rebota en el lugar |
| `headShake` | Se sacude de lado a lado |
| `heartbeat` | Pulso de latido |
| `pulse` | Pulso suave |
| `tada` | Tada |
| `wobble` | Bamboleo |
| `jello` | Bamboleo de gelatina |
| `rubber` | Banda elástica |
| `shakeX` | Sacudida horizontal |
| `shakeY` | Sacudida vertical |
| `flash` | Destello |
| `swing` | Balanceo |

---

### Appearance Custom
Estos efectos los proporciona el propio reveal.js-appearance y no la biblioteca base Animate.css.

| Shortcode | Efecto |
|-----------|--------|
| `shrink` | Entra encogiéndose |
| `shrinkBig` | Entra encogiéndose (recorrido largo) |
| `shrinkBlur` | Entra encogiéndose con desenfoque |
| `skidLeft` | Entra derrapando desde la izquierda |
| `skidLeftBig` | Entra derrapando desde la izquierda (lejos) |
| `skidRight` | Entra derrapando desde la derecha |
| `skidRightBig` | Entra derrapando desde la derecha (lejos) |

---

<a id="appearance-modifiers"></a>
## Modificadores

Añade cualquiera de estos después del nombre del preajuste, separados por `:`.

### Split
Divide el texto en piezas que se animan individualmente.

| Palabra clave | Efecto |
|---------|--------|
| `let` | Anima letra por letra |
| `word` | Anima palabra por palabra |

### Speed
| Palabra clave | Efecto |
|---------|--------|
| `slow` | Animación más lenta (Animate.css `animate__slower`) |
| `fast` | Animación más rápida (Animate.css `animate__faster`) |

### Delay
Cualquier número entero (milisegundos) retrasa el inicio de la animación después de que aparece la diapositiva o se activa el fragmento.

---

<a id="appearance-examples"></a>
## Ejemplos

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

---

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
