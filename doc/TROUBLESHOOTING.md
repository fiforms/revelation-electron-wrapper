# Wrapper Troubleshooting

---

## Table of Contents

* [Linux Wayland and X11](#troubleshooting-wayland-x11)
* [Enable DevTools at Runtime](#troubleshooting-runtime-devtools)
* [Peering and mDNS Issues](#troubleshooting-peering-mdns)
* [Pairing Must Be Renewed After Update](#troubleshooting-peering-repair-after-update)
* [Peering Quick Checks](#troubleshooting-peering-quick-checks)
* [Manual Pairing by IP](#troubleshooting-peering-manual-pairing)
* [Paired but Z Does Nothing](#troubleshooting-peering-send-fail)
* [Firewall and Network Notes](#troubleshooting-peering-firewall)
* [Reset Settings and Plugins](#troubleshooting-reset)
* [Open the Debug Log](#troubleshooting-debug-log)
* [Uninstall and Remove Local Data](#troubleshooting-uninstall)

---

<a id="troubleshooting-wayland-x11"></a>

## Linux Wayland and X11

On some Ubuntu/Wayland setups, Electron rendering works more reliably when forced to X11:

```bash
revelation-electron --ozone-platform=x11
```

### GPU errors on X11 (missing background video, GPU process crash)

If you see GPU errors like `gbm_bo_import` returning nullptr or `GPU process exited unexpectedly` in the console, the GPU driver is failing to share buffers with Chromium under XWayland. This also causes background videos in presentations to disappear.

Pass one of the following additional flags, from least to most aggressive:

```bash
# Option 1: Disable GPU sandbox only (least invasive)
revelation-electron --ozone-platform=x11 --disable-gpu-sandbox

# Option 2: Software GL renderer — bypasses GBM entirely (recommended)
revelation-electron --ozone-platform=x11 --use-gl=swiftshader

# Option 3: Disable GPU compositing
revelation-electron --ozone-platform=x11 --disable-gpu-compositing

# Option 4: Disable GPU entirely (most stable, no hardware acceleration)
revelation-electron --ozone-platform=x11 --disable-gpu
```

`--use-gl=swiftshader` (option 2) is the recommended starting point — it uses CPU-based software rendering to avoid the GBM crash while keeping compositing functional, which allows background videos to display correctly.

---

If you launch from the desktop, you can use a `.desktop` entry like this:

```ini
[Desktop Entry]
Name=REVELation Snapshot Presenter
Exec=revelation-electron --ozone-platform=x11 --use-gl=swiftshader
Terminal=false
Type=Application
Categories=Utility;
```

---

<a id="troubleshooting-runtime-devtools"></a>

## Enable DevTools at Runtime

If you need to debug UI behavior in any app window, start the app with:

```bash
revelation-electron --enable-devtools
```

or in development environment:

```bash
npm start -- --enable-devtools
```

With this flag enabled, pressing `F12` in any `BrowserWindow` opens DevTools in a separate (detached) window.

---

<a id="troubleshooting-peering-mdns"></a>

## Peering and mDNS Issues

If peer control is not working, these are the most common causes:

- mDNS discovery blocked by firewall/network policy.
- Master is not actually publishing (`Networking` is not `network` mode).
- Follower is not allowed to browse peers (`mDNS Browse` disabled).
- Wrong host/port or pairing PIN when pairing manually.
- Peer command link not established yet (pressing `Z` appears to do nothing).
- Pairing was made before a security update and now needs renewing (see below).

---

<a id="troubleshooting-peering-repair-after-update"></a>

### "Pairing must be renewed" after updating

A security fix gave peer pairing its own signing key, separate from the one used
for WordPress publishing. Masters now prove their identity with a key that
followers paired before the update have never seen, so **pairings made before
the update stop working and must be renewed once.**

You will see one of these:

- On the follower: `Pairing with master … was made with an older version and
  must be renewed — unpair and pair again.`
- While pairing: `Master … is running an older, incompatible peering protocol.
  Update the app on the master and try again.`

To fix:

1. **Update both machines.** A follower on the new version cannot pair with a
   master still on the old one — the master is still signing with the shared
   key, which is exactly what the fix removes, so the follower refuses on
   purpose rather than falling back.
2. On the follower, open `Peer Presenter Pairing...`, select the master, and
   choose `Unpair`.
3. Pair again with the master's current PIN.

Nothing else needs changing — the PIN, ports, and mDNS settings are unaffected,
and existing WordPress pairings keep working untouched.

---

<a id="troubleshooting-peering-quick-checks"></a>

### Quick checks first

On the machine that should act as the master:

1. Open `Settings...`.
2. Set `Networking` to `network`.
3. Enable `Enable Master Mode (mDNS Publish and Peering Endpoints)`.
4. Verify `Vite Server Port` (default is commonly `8000`).
5. Confirm the `Pairing PIN`.

On the machine that should act as the follower:

1. Open `Settings...`.
2. Enable `Enable Peering as Follower (mDNS Browse)`.
3. Confirm it can reach the master machine on the same LAN/subnet.

Then open `Peer Presenter Pairing...` and verify the master appears in `Discovered Peers`.

---

<a id="troubleshooting-peering-manual-pairing"></a>

### When mDNS discovery is broken

Some environments block multicast/broadcast discovery (guest Wi-Fi, VLANs, strict firewalls, managed corporate networks).  
If discovery does not work, use manual pairing by IP:

1. Open `Peer Presenter Pairing...` on the follower.
2. Click `Manual Pairing...`.
3. In `Pair by IP Address`, enter the master IP (example `192.168.1.50`).
4. Enter `Pairing Port` (usually the master's `Vite Server Port`, commonly `8000`).
5. Click `Pair` and enter the master's `Pairing PIN`.

If this succeeds, mDNS can remain unreliable; manual pairing still works as a fallback.

---

<a id="troubleshooting-peering-send-fail"></a>

### If pairing works but send-to-peer does not

If peers are paired but pressing `Z` does nothing:

1. Start a presentation on the master first.
2. Ensure Reveal Remote is available/initialized in that session.
3. Press `Z` again, or use presentation context menu `Send Presentation to Peers (z)`.
4. Check `Peer Presenter Pairing...` for currently paired masters and host/port hints.

Also verify both machines are still on the same reachable network and no host firewall rule changed mid-session.

---

<a id="troubleshooting-peering-firewall"></a>

### Firewall and network notes

- mDNS uses multicast DNS on local networks and is commonly blocked by firewall policies.
- Peer pairing/commands require TCP connectivity to the master's `Vite Server Port` (often `8000`).
- If you're using routed/VLAN networks, expect discovery to fail and prefer manual pairing by IP.

---

### Where to go next

- Full protocol and architecture details: [doc/dev/PEERING.md](dev/PEERING.md)
- Multi-language variant peer workflow: [revelation/doc/VARIANTS_REFERENCE.md](../revelation/doc/VARIANTS_REFERENCE.md)

---

<a id="troubleshooting-reset"></a>

## Reset Settings and Plugins

Use the built-in reset action:

1. Open the app.
2. Go to `Revelation` (or app menu on macOS).
3. Click `Reset All Settings and Plugins...`.
4. Confirm reset.

This resets local app settings and removes local overridden plugin/framework resources so the app can return to defaults.

---

<a id="troubleshooting-debug-log"></a>

## Open the Debug Log

From the app menu:

1. Open `Help`.
2. Open `Debug`.
3. Click `Open Log`.

---

The log file is stored in the app user-data folder as `debug.log`.

Common default user-data locations:

- Windows: `%APPDATA%/revelation-electron/`
- macOS: `~/Library/Application Support/revelation-electron/`
- Linux: `~/.config/revelation-electron/`

---

<a id="troubleshooting-uninstall"></a>

## Uninstall and Remove Local Data

If you want a full clean removal, do both:

1. Uninstall the app.
2. Remove local user data and caches.

---

### 1) Uninstall app

Typical install locations (vary by installer/package manager):

- Windows (NSIS): uninstall from Apps/Programs, usually installed under `C:\Program Files\REVELation Snapshot Presenter\`
- macOS: remove app from `/Applications`
- Linux (`.deb`/`.rpm`): remove package with your package manager

---

### 2) Remove local user data and caches

Remove the app user-data folder:

- Windows: `%APPDATA%/revelation-electron/`
- macOS: `~/Library/Application Support/revelation-electron/`
- Linux: `~/.config/revelation-electron/`

---

Optional: if you also want to remove your presentation library created by default, delete:

- `~/Documents/REVELation Presentations/`

Only delete that folder if you no longer need your local presentations and media.
