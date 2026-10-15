# Plugin Credit CCLI

Añade ayudas de créditos para presentaciones:

- Reemplaza los tokens `:ccli:` con el número de licencia CCLI configurado.
- Convierte los bloques YAML `:credits:` en marcado `<cite class="attrib">...</cite>`.
- Añade macros :ATTRIB: para el número CCLI y la información de derechos de autor.

## Configuración

En Configuración -> Administrador de Plugins -> `credit_ccli`:

Asegúrate de establecer tu `CCLI License Number` con el número de licencia CCLI real de tu iglesia.
Este plugin se ofrece por conveniencia; ¡no te otorga automáticamente permiso
para usar canciones con derechos de autor!

---

## Importar desde SongSelect

REVELation no se integra automáticamente con SongSelect; sin embargo, amplía la función
"Smart Paste" del constructor de presentaciones para crear diapositivas a partir de letras copiadas.

En SongSelect, copia la letra de la canción con el enlace "copy" junto al título de la canción.

En el constructor, usa la opción "Smart Paste" del menú de herramientas para pegar la letra como
diapositivas.

---

## Bloque de Créditos

Usa YAML para añadir los metadatos de la canción en tu diapositiva de título. Estos metadatos se darán formato
como un bloque de créditos en tu presentación, e incluirán tu número de licencia CCLI
si corresponde:

```yaml
:credits:
  words: Ron Hamilton
  music: Ron Hamilton
  year: 1981
  copyright: Majesty Music
  cclisong: 72439
  license: ccli
```

---

En el Rich Builder, abre el menú Animation (botón de estrella fugaz) y elige
**CCLI Credits…** en *Plugin Blocks* para rellenar el bloque con un formulario. Al hacer
clic en una tarjeta `:credits:` existente se abre el mismo formulario. (Al guardar desde
el formulario se reescribe el YAML, por lo que el orden de las claves puede cambiar y los
comentarios YAML no se conservan.)

## Macros Automáticas

El bloque de créditos establecerá automáticamente macros para mostrar la atribución de tu número de licencia
CCLI y del titular de los derechos de autor de la canción. Ten esto en cuenta, ya que podría
restablecer macros definidas en diapositivas anteriores, y también crear macros que deben
restablecerse manualmente al final de la canción.
