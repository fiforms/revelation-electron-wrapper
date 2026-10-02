# Overlay Widgets Plugin

Places live widgets (calendar, clock, weather, …) on top of a slide using a `:widget:` markdown block. The widgets come from [fiforms/overlaywidgets](https://github.com/fiforms/overlaywidgets), included as a git submodule at `overlaywidgets/`.

## Usage

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

| Field | Meaning |
|---|---|
| `name` | Widget id: a folder in `overlaywidgets/` (`calendar`, `clock`, `weather`, `hello`). |
| `position.x`, `position.y` | Top-left corner, as a ratio of the slide's width and height (0–1). Default `0`. |
| `size.w`, `size.h` | Size as a ratio of the slide's width and height. Defaults to the widget's `defaultSize`. |
| `parameters` | Widget-specific values; see each widget's `manifest.json`. Validated, with defaults filled in. |

The widget is shown while its slide is the current slide. `:widget:` blocks are stripped from handouts.

## How it works

- `client.js` turns each block into a placeholder, then mounts the widget (scaled from the 1920×1080 widget coordinate space) when its slide becomes current and runs the widget's cleanup when it leaves.
- `validate.js` validates parameters per the widget's manifest. It runs in the browser **and** again in the main process.
- `endpoint-server.js` (main process) is the widget "host": it makes the HTTPS requests a widget's manifest declares (the browser can't, because of CORS), parses iCalendar feeds with [ical.js](https://github.com/kewisch/ical.js), caches responses, and enforces the safety rules from the overlaywidgets README (manifest-only URLs, `allow` lists, https only, public addresses only, size/time limits).

## Limits

- Widgets needing outside data (calendar, weather) work in the Electron presentation window and the builder preview. Offline exports and plain browsers have no host, so those widgets show their "unavailable" state. Clock and hello are self-contained.
- `{secret:…}` settings are not supported yet; `api.location` is always `null`.

## Updating the widgets

```bash
git submodule update --remote plugins/widgets/overlaywidgets
```
