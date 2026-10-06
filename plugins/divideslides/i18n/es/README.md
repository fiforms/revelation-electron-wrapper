# Plugin Divide Slides

Divide diapositivas largas, como versos de canciones o párrafos pegados, en varias diapositivas más cortas. Está habilitado de forma predeterminada.

## Uso

En el constructor, abre el menú **Content** y elige **Divide Slides**. El cuadro de diálogo ofrece:

- **Apply to**: todas las diapositivas de la columna actual, o solo la diapositiva actual.
- **Maximum lines per slide** (predeterminado 4).
- **Maximum words per slide** (opcional, desactivado de forma predeterminada; 40 cuando se activa). El límite que se alcance primero inicia una nueva diapositiva.
- **Find natural breaks**: prefiere cortar después de un signo de puntuación en lugar de en un corte arbitrario.
- **Avoid orphaned lines**: activado de forma predeterminada; evita dejar una sola línea corta sola en una diapositiva.

---

## Qué se deja intacto

Las líneas de macro (`:hide:`, `:credits:`, `{{transition}}`, líneas de atribución y de divulgación de IA), las imágenes, las filas de tablas y el HTML
sin procesar nunca se dividen por palabras y se mantienen con su diapositiva. Los saltos de línea forzados (dos espacios al final o una barra invertida) se
conservan.

## Configuración

Ninguna. El plugin no tiene ajustes, IPC ni acceso a la red; su código se ejecuta solo en el constructor (`client.js` registra
la entrada de menú y carga `builder.js` bajo demanda).
