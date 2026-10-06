# Plugin Overlay Widgets

Coloca widgets en vivo (calendario, reloj, clima, …) encima de una diapositiva mediante un bloque markdown `:widget:`. Los widgets provienen de [fiforms/overlaywidgets](https://github.com/fiforms/overlaywidgets), incluido como submódulo de git en `overlaywidgets/`.

## Uso

```yaml
:widget:
  name: calendar
  position:
    x: 0.0286
    y: 0.0444
  size:
    w: 0.9437
    h: 0.9074
  parameters:
    ics: "https://calendar.google.com/calendar/ical/…/public/basic.ics"
    mode: month
    title: Conference Calendar
    max_events: 6
    color: "#ffffff"
    accent: "#fbbf24"
    background: "#0f172a"
    background_opacity: 0.75
```

| Campo | Significado |
|---|---|
| `name` | Id del widget: una carpeta en `overlaywidgets/` (`calendar`, `clock`, `weather`, `hello`). |
| `position.x`, `position.y` | Esquina superior izquierda, como proporción del ancho y alto de la diapositiva (0–1). Predeterminado `0`. |
| `size.w`, `size.h` | Tamaño como proporción del ancho y alto de la diapositiva. Por defecto usa el `defaultSize` del widget. |
| `location` | `name`, `latitude`, `longitude` opcionales. Se convierte en el `api.location` del widget, usado por el clima cuando su código postal está en blanco. |
| `parameters` | Valores específicos del widget; consulta el `manifest.json` de cada widget. Se validan y se completan con valores predeterminados. |

---

El widget se muestra mientras su diapositiva es la diapositiva actual. Los bloques `:widget:` se eliminan de los folletos impresos.

## Cómo funciona

- `client.js` convierte cada bloque en un marcador de posición y luego monta el widget (escalado desde el espacio de coordenadas de widget de 1920×1080) cuando su diapositiva pasa a ser la actual o es adyacente a ella, y ejecuta la limpieza del widget cuando la diapositiva ya no está cerca. Las diapositivas vecinas se prerrenderizan para que los widgets lentos ya estén pintados cuando aparezca su diapositiva. Un widget permanece transparente hasta que llama a `api.ready()` (o `mount` retorna, a menos que exporte `manualReady`), con un respaldo de 8 segundos.
- `validate.js` valida los parámetros según el manifiesto del widget. Se ejecuta en el navegador **y** de nuevo en el proceso principal.
- `endpoint-server.js` (proceso principal) es el "host" del widget: realiza las solicitudes HTTPS que declara el manifiesto de un widget (el navegador no puede, por CORS), analiza los feeds iCalendar con [ical.js](https://github.com/kewisch/ical.js), almacena las respuestas en caché y aplica las reglas de seguridad del README de overlaywidgets (solo URL del manifiesto, listas `allow`, solo https, solo direcciones públicas, límites de tamaño/tiempo).

---

## Límites

- Los widgets que necesitan datos externos (calendario, clima) funcionan en la ventana de presentación de Electron y en la vista previa del constructor. Las exportaciones sin conexión y los navegadores simples no tienen host, por lo que esos widgets muestran su estado de "no disponible". Clock y hello son autónomos.
- Los ajustes `{secret:…}` aún no son compatibles; `api.location` proviene únicamente del `location:` del bloque (de lo contrario es `null`).

## Actualizar los widgets

```bash
git submodule update --remote plugins/widgets/overlaywidgets
```
