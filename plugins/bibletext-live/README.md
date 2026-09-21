# Live Bible Text Plugin

## Table of Contents
* [Overview](#bibletext-live-overview)
* [Requires the Bible Text Plugin](#bibletext-live-requires)
* [Setting Up the Dynamic Slide](#bibletext-live-setup)
* [Presenting Verses](#bibletext-live-presenting)
* [How Delivery Works](#bibletext-live-delivery)

---

<a id="bibletext-live-overview"></a>
## Overview

Live Bible Text lets you put a verse on screen the instant it is called for during a
service — without opening the builder, saving, or reloading the presentation.

This is a **viewer-collaboration** plugin: anyone holding the presentation link can change
the verse displayed on every live-verse slide. It is split out from the
[Bible Text](../bibletext/README.md) plugin so that collaboration is opt-in — the ordinary
passage search/insert features work without it.

---

<a id="bibletext-live-requires"></a>
## Requires the Bible Text Plugin

This plugin only supplies the live-slide delivery mechanism. It reuses the Bible Text
plugin's local/online verse lookup, so **Bible Text must also be enabled** for live verses
to work. If it isn't, pushing a verse returns an error asking you to enable it.

---

<a id="bibletext-live-setup"></a>
## Setting Up the Dynamic Slide

1. In the builder, open the **Add Content** menu and choose **📖 Add Live Bible Slide**.
2. This inserts a blank dynamic slide containing a single `:bibleverse:` marker. Add a
   background to it if you like; until a verse is sent it shows only the background.

---

<a id="bibletext-live-presenting"></a>
## Presenting Verses

1. Open the **Bible Text** sidebar (the "Bible Text" plugin button).
2. Browse to a chapter, or type a reference such as `John 3:16` and press **Enter**.
3. Send a verse to every dynamic slide using any of these:
   - Click the **▶ present** button next to a verse.
   - Press **Alt+Enter** to present the currently highlighted verse.
   - Press **↑ / ↓** to step to the previous/next verse and present it (crossing chapter
     boundaries), so you can follow a reader through a passage.
   - Press **Esc** to clear the screen (same as the **Clear Screen** button).

After each keystroke the reference box stays focused with its text selected, ready for the
next reference. The verse appears on **all** dynamic slides — across every open presentation —
and on the local projector as well as any LAN/browser viewers.

---

<a id="bibletext-live-delivery"></a>
## How Delivery Works

The main process is the single source of truth and broadcasts the rendered, HTML-escaped
verse over Socket.IO to a room scoped to a per-session id minted at server start
(`bibletext-live:<presenterLiveRoomId>`). Every slide deck — local projector and remote
browsers — joins that room and renders what it receives.

> **Note:** Because delivery is Socket.IO-only, it depends on the
> `presenterPluginsPublicServer` setting being reachable. For offline / local-only use,
> point it at your local server (network mode). There is no separate offline fallback.

See `revelation/doc/SECURITY.md` for the open-collaboration model this room follows.
