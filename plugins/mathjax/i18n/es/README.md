# Complemento MathJax

Muestra ecuaciones matemáticas en las diapositivas, compuestas con [MathJax 4](https://www.mathjax.org/).
Las fórmulas se escriben en notación TeX/LaTeX dentro de un bloque `:mathjax:`, y el Rich Builder
incluye un editor **Fórmula matemática…** con ejemplos, una guía rápida de códigos y vista previa en vivo.

MathJax viene incluido en la aplicación, así que las ecuaciones funcionan sin conexión a internet,
tanto al presentar como en las exportaciones sin conexión. No hay ajustes.

> Este complemento reemplaza al antiguo complemento `math` (MathJax 2/3 o KaTeX cargados desde una
> CDN). Si `math` estaba activado, se activa como `mathjax` automáticamente la próxima vez que
> se inicie la aplicación.

## El bloque `:mathjax:`

```yaml
:mathjax:
  version: 4
  formula: x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}
```

| Clave | Significado |
|---|---|
| `formula` | El código TeX. Escríbalo tal cual: sin barras invertidas adicionales ni delimitadores. Un valor de varias líneas (`formula: |`) se une en una sola línea. |
| `display` | `block` (predeterminado): centrada en su propia línea. `inline`: fluye dentro del texto que la rodea. |
| `version` | Informativa. Solo se incluye MathJax 4, así que la fórmula siempre se muestra con MathJax 4. |

Si escribe un bloque a mano, ponga la fórmula entre comillas cuando empiece por `{` o `[` o contenga `: ` o ` #`
(por ejemplo `formula: 'a: b'`); de lo contrario YAML la interpretaría mal. El editor de fórmulas añade las comillas por usted.

Un bloque `inline` ocupa su propia línea en el markdown, pero se compone dentro del párrafo, así que
póngalo en la línea justo antes o después del texto al que pertenece:

```markdown
Einstein demostró que
:mathjax:
  formula: E = mc^2
  display: inline
para todo objeto en reposo.
```

## Editor de fórmulas (Rich Builder)

En el Rich Builder, abra el menú Animación (botón de estrella fugaz) y elija
**Fórmula matemática…** en *Plugin Blocks*. Al hacer clic en una tarjeta `:mathjax:` existente se
abre el mismo editor.

1. Elija **Bloque** (línea propia y centrada, al final de la diapositiva) o **En línea**
   (al final de la línea donde está el cursor).
2. Escriba el código TeX. La vista previa se actualiza mientras escribe y los errores se explican debajo.
3. Haga clic en un **ejemplo** para partir de una fórmula lista (fórmula cuadrática, integral, matriz,
   función por tramos, ecuación química, …).
4. Abra la **guía rápida de códigos** y haga clic en un código (`\frac{a}{b}`, `\sqrt{x}`,
   `\sum_{i=1}^{n}`, letras griegas, …) para añadirlo en el cursor.
5. Haga clic en **Insertar** (o **Aplicar** al editar).

Al guardar desde el editor se reescribe el YAML del bloque, por lo que el orden de las claves puede
cambiar y los comentarios YAML no se conservan. Las demás claves del bloque se mantienen.

## Presentaciones anteriores

Las fórmulas escritas directamente en una diapositiva siguen funcionando: `$$ … $$` y `\[ … \]` para
bloque, `\( … \)` para en línea (un solo `$` no es delimitador, así que precios como $5 son seguros).
En markdown, sin embargo, el analizador elimina la barra invertida que precede a un signo de
puntuación (`\\` pasa a ser `\`, `\,` pasa a ser `,`), por lo que hay que duplicar las barras
(`\\\\` para el salto de fila de una matriz). El bloque `:mathjax:` evita ese problema, por eso es la
forma recomendada.
