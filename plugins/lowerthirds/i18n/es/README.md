# Plugin Lower Thirds

Superpone gráficos SVG animados de tercio inferior sobre las diapositivas usando una sintaxis simple de bloque markdown.

## Uso

Añade un bloque `:lt:` en cualquier parte del markdown de una diapositiva:

```yaml
:lt:
  name: Person's Name
  title: Person's Title
  style: colorful
```

---

`style` es opcional: si se omite, usa el ajuste `defaultStyle` del plugin (predeterminado: `colorful`).

> **Importante:** Establece **Slide View Distance** en la configuración de tu presentación con un valor mayor que el número total de diapositivas de la presentación. Los tercios inferiores se renderizan cuando Reveal.js precarga una diapositiva; si la diapositiva aún no se ha cargado, la superposición no aparecerá.

### Campos

| Campo     | Requerido | Descripción                                      |
|-----------|----------|--------------------------------------------------|
| `name`    | sí       | El nombre de la persona, mostrado en el texto grande |
| `title`   | sí       | El título o cargo de la persona, mostrado debajo del nombre |
| `style`   | no       | Nombre del tema (nombre de archivo sin extensión) que se usará |

> El cliente también lee los atributos `data-lt-caption` / `data-lt-manager`, pero el preprocesador de `:lt:` actualmente solo emite `style`, `name` y `title`, por lo que una clave `caption:` en el bloque se ignora.

El bloque `:lt:` se elimina automáticamente de la salida impresa o de folletos.

---

## Temas

Un tema es un par de archivos en el directorio `themes/`:

```
themes/
  mytheme.svg   ← requerido: el gráfico de tercio inferior
  mytheme.css   ← opcional: hoja de estilos complementaria (fuentes, etc.)
  mytheme.lt.svg / mytheme.co.svg  ← variantes opcionales usadas cuando la URL de la página tiene
                                     ?variant=lowerthirds / ?variant=confidencemonitor
```

---

### Variables de plantilla SVG

Marca los elementos de texto con un atributo `data-lt-block`; el plugin rellena su contenido al momento de renderizar:

```xml
<text x="170" y="915" font-size="48" data-lt-block="name"></text>
<text x="172" y="960" font-size="28" data-lt-block="title"></text>
```

Valores admitidos para `data-lt-block`: `name`, `title`.

El SVG se dimensiona para llenar el lienzo de la diapositiva. Diseña tu SVG a 1920×1080 (o usa un `viewBox` equivalente) para obtener mejores resultados.

---

### Hoja de estilos complementaria CSS: cargar fuentes personalizadas

Si el SVG de tu tema usa una fuente web, crea un archivo `.css` con el mismo nombre base. Se inyecta en la página automáticamente la primera vez que se usa el tema:

```css
/* themes/mytheme.css */
@import url('/css/fonts/my_font/my_font.css');
```

Referencia la fuente en tu SVG con un atributo `font-family`:

```xml
<g font-family="'My Font', sans-serif">
  <text … data-lt-block="name"></text>
</g>
```

El tema `colorful` se incluye como ejemplo; consulta [themes/colorful.svg](../../themes/colorful.svg) y [themes/colorful.css](../../themes/colorful.css).

---

## Configuración del plugin

En la configuración del plugin, `defaultStyle` establece el nombre del tema de respaldo que se usa cuando un bloque `:lt:` omite `style`:

| Ajuste         | Predeterminado | Descripción                          |
|----------------|------------|--------------------------------------|
| `defaultStyle` | `colorful` | Nombre del tema usado cuando no se especifica ninguno |

---

## Añadir un tema nuevo

1. Crea `themes/<name>.svg` con `data-lt-block="name"` y `data-lt-block="title"` en los elementos `<text>` correspondientes.
2. Opcionalmente, crea `themes/<name>.css` para cargar fuentes u otros estilos.
3. Referencia el tema por nombre en cualquier bloque `:lt:`, o establécelo como `defaultStyle`.
