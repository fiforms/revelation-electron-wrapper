# Plugin Immich Slideshow

Muestra una presentación de un álbum compartido de [Immich](https://immich.app/) en la pantalla de presentación y mantiene a los pares emparejados
sincronizados con ella.

## Uso

1. En la aplicación, haz clic en el botón flotante **Immich** y pega una URL para compartir de Immich (`http` o `https`).
2. Inicia la presentación de fotos. La página compartida se abre a pantalla completa en la pantalla de presentación local, y un comando de par
   `open-presentation` hace que cada seguidor emparejado abra la misma URL.
3. Mientras se ejecuta, las teclas de flecha, Espacio, Re Pág/Av Pág, Enter, Escape y `F` presionadas en la ventana de presentación se
   retransmiten a los pares como comandos `immich-navigate`. Los seguidores inyectan la tecla en su propia ventana de presentación.
4. Haz clic en el botón de nuevo para detenerla. Cerrar la ventana de presentación también termina la sincronización.

---

El botón muestra un punto mientras hay una sincronización activa.

## Notas

- Los pares deben estar emparejados previamente (consulta [PEERING.md](../../../../doc/i18n/es/dev/PEERING.md)). Si no se puede alcanzar a ningún par, la presentación de fotos
  se ejecuta de todos modos de forma local.
- Solo se aceptan URL `http` y `https`. Los seguidores aceptan únicamente un conjunto fijo de teclas de navegación.

## Configuración

Ninguna.
