# Info Panel Plugin

Embeds a web page in the lower or right part of the Confidence Monitor and Notes views, for example a service
schedule, a clock, or a chat page. It supports HTTP Basic authentication.

## Configuration

- `url` (default empty): page to show. Nothing is displayed until it is set.
- `username` and `password` (default empty): answer an HTTP Basic login for that host. Leave blank if the site needs
  none. Both are marked secret, so they are kept out of `plugins.json` and the browser-facing plugin list, and are
  answered from the main process. The password is stored in plain text in `config.json`.
- `panelPosition` (default `bottom`): `bottom` or `right` on the Confidence Monitor.
- `panelSize` (default `25`): percentage of the screen height (bottom) or width (right).

---

## Notes

- The page is loaded by the viewer's iframe, so the site must allow framing. If the credentials are rejected the
  plugin does not retry in a loop.
- Login is answered for every app window, including the presentation window, the notes pop-out and extra screens.
