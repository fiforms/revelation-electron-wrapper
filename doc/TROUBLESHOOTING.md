---

# Wrapper Troubleshooting

---

## Table of Contents
* [Linux Wayland and X11](#troubleshooting-wayland-x11)

---

<a id="troubleshooting-wayland-x11"></a>

## Linux Wayland and X11

On some Ubuntu/Wayland setups, Electron rendering works more reliably when forced to X11:

```bash
revelation-electron --ozone-platform=x11
```

If you launch from the desktop, you can use a `.desktop` entry like this:

```ini
[Desktop Entry]
Name=REVELation Snapshot Presenter
Exec=revelation-electron --ozone-platform=x11
Terminal=false
Type=Application
Categories=Utility;
```
