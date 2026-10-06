# Immich Slideshow Plugin

Shows an [Immich](https://immich.app/) shared-album slideshow on the presentation screen and keeps paired peers in
step with it.

## Usage

1. In the app, click the floating **Immich** button and paste an Immich share URL (`http` or `https`).
2. Start the slideshow. The share page opens fullscreen on the local presentation screen, and an `open-presentation`
   peer command makes every paired follower open the same URL.
3. While it runs, the arrow keys, Space, Page Up/Down, Enter, Escape and `F` pressed on the presentation window are
   relayed to the peers as `immich-navigate` commands. Followers inject the key into their own presentation window.
4. Click the button again to stop. Closing the presentation window also ends the sync.

The button shows a dot while a sync is active.

## Notes

- Peers must already be paired (see [PEERING.md](../../doc/dev/PEERING.md)). If no peer can be reached, the slideshow
  still runs locally.
- Only `http` and `https` URLs are accepted. Followers accept only a fixed set of navigation keys.

## Configuration

None.
