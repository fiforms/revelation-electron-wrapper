# Plugin Info Panel

Incrusta una página web en la parte inferior o derecha de las vistas de Monitor de Confianza y Notas, por ejemplo un
programa del servicio, un reloj o una página de chat. Admite autenticación HTTP Basic.

## Configuración

- `url` (predeterminado vacío): página que se mostrará. No se muestra nada hasta que se define.
- `username` y `password` (predeterminado vacío): responden un inicio de sesión HTTP Basic para ese host. Déjalos en blanco si el sitio no necesita
  ninguno. Ambos están marcados como secretos, por lo que se mantienen fuera de `plugins.json` y de la lista de plugins accesible desde el navegador, y se
  responden desde el proceso principal. La contraseña se almacena en texto plano en `config.json`.
- `panelPosition` (predeterminado `bottom`): `bottom` o `right` en el Monitor de Confianza.
- `panelSize` (predeterminado `25`): porcentaje de la altura de la pantalla (bottom) o del ancho (right).

---

## Notas

- La página la carga el iframe del espectador, por lo que el sitio debe permitir ser incrustado. Si se rechazan las credenciales, el
  plugin no reintenta en bucle.
- El inicio de sesión se responde para todas las ventanas de la aplicación, incluidas la ventana de presentación, la ventana emergente de notas y las pantallas adicionales.
