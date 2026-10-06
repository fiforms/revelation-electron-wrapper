# Plugin FreeShow Export

Exporta una presentación como un archivo de proyecto de [FreeShow](https://freeshow.app/).

## Uso

Abre **Export** de una presentación y elige **FreeShow (.project)**. Un cuadro de diálogo nativo de Guardar pregunta dónde escribir el
archivo. No se envía nada por la red.

## Opciones

- **Include speaker notes / description as slide notes** (activado de forma predeterminada): copia el campo `description`
  del front matter de la presentación a las notas de la primera diapositiva.

---

## Qué se convierte

- Las diapositivas se dividen en las líneas `---`. Cada diapositiva se convierte en un elemento de texto de FreeShow.
- El markdown en línea (negrita, cursiva, etc.) se convierte en fragmentos de texto con estilo.
- Los bloques de macros `:shortcode:` y las expresiones de plantilla `{{...}}` se descartan.
- Cada diapositiva recibe un grupo de FreeShow según su primera línea: encabezado `#` = Intro, cita `>` = Quote, macro `:` = Info,
  cualquier otra cosa = Verse.
- Las líneas solo en cursiva se tratan como etiquetas: alineadas a la izquierda antes del texto principal, alineadas a la derecha después de él.

No se exportan imágenes, video, fondos ni transiciones.

## Configuración

Ninguna.
