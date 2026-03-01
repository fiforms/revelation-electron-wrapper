# Slide Control Plugin

Adds a bottom navigation overlay to presentation view.

In shared/peer sessions, follower peers can request navigation changes over the presenter plugin socket. The master session executes those commands locally, and RevealRemote then syncs slide state to connected clients.

## Controls

- `<<` Column left
- `^` Previous slide
- `v` Next slide
- `>>` Column right
- `OV` Toggle overview
- `BL` Blank screen

## Realtime

- Socket path: `/presenter-plugins-socket`
- Plugin scope: `slidecontrol`
- Event: `slideshow-control-command`

Only non-follower sessions execute incoming remote commands.
