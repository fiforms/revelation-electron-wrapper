# Plugin Slide Sorter

## Resumen

Añade un modo de ordenador de diapositivas exclusivo del constructor, con mosaicos de diapositivas arrastrables.

## Qué Añade

- Botón de modo `Slide Sorter` en el encabezado de vista previa del Constructor
- Superposición de mosaicos del ordenador para edición estructural rápida
- Renderizado mejorado de mosaicos del navegador de diapositivas del riel izquierdo del constructor (cuando el plugin está habilitado)
- Reordenamiento de diapositivas con arrastrar y soltar
- Doble clic en un mosaico para ir a esa diapositiva y salir del modo ordenador
- Menú del clic derecho en una diapositiva:
  - Insert Slide After
  - Duplicate Slide
  - Delete Slide
- Menú del clic derecho en el chip de columna (franja superior):
  - Insert Column After
  - Delete Column
- Clic derecho en los mosaicos del navegador de la barra lateral izquierda (cuando el plugin está habilitado):
  - Insert Slide After
  - Duplicate Slide
  - Delete Slide
- Portapapeles de diapositivas: Cortar/Copiar/Pegar diapositivas (también Ctrl/Cmd+X/C/V en la lista de diapositivas del riel izquierdo), incluso entre presentaciones; los archivos de medios referenciados y las entradas de alias `media:` se copian junto con ellas
- Selección múltiple de diapositivas, ocultar/mostrar diapositivas, dividir/combinar/mover columnas
- `Esc` en el constructor abre el ordenador

---

## Comportamiento

- Presentaciones de una sola columna:
  - Las diapositivas se renderizan en orden de cuadrícula de izquierda a derecha con salto de línea
- Presentaciones de varias columnas:
  - Las diapositivas se renderizan según la estructura horizontal/vertical de Reveal
  - La matriz admite desplazamiento en 2D para presentaciones grandes
- El renderizado de los mosaicos es intencionalmente simplificado:
  - Texto de encabezado grande
  - Texto del cuerpo compacto
  - Las referencias a imágenes se muestran como chips
  - Vista previa del diseño markdown de dos columnas `||` cuando se detecta
- Las diapositivas con top matter (`slide.top`) muestran una barra indicadora roja

## Notas

- Este plugin es exclusivo del constructor y carga `builder.js` de forma diferida desde `client.js`.
- El reordenamiento se confirma mediante `host.transact(... tx.replaceStacks(...))`.
