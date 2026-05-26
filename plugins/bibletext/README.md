# Bible Text Plugin

## Table of Contents
* [Overview](#bibletext-overview)
* [What It Adds](#bibletext-what-it-adds)
* [How It Works](#bibletext-how-it-works)
* [Live Bible Verse Slide](#bibletext-live-verse)
* [Loading Local XML Bibles](#bibletext-local-xml)
* [ESV API Key Setup](#bibletext-esv-api-key)
* [Configuration](#bibletext-configuration)

---

<a id="bibletext-overview"></a>
## Overview

The Bible Text plugin searches and inserts scripture passages as formatted markdown slides.

---

<a id="bibletext-what-it-adds"></a>
## What It Adds

- Passage search dialog in the builder
- Translation selection (local and online)
- Passage formatting with verse text and references
- Attribution lines for inserted scripture
- A live **dynamic Bible slide** that instantly shows any verse you pick — no rebuild or reload
- A **Bible reader** sidebar with per-verse "present" buttons and keyboard shortcuts for live use

---

<a id="bibletext-how-it-works"></a>
## How It Works

The plugin can read local bible data (`*.local` translations) and can also query online APIs. After fetching verses, it formats markdown and appends it to the selected presentation file.

---

<a id="bibletext-live-verse"></a>
## Live Bible Verse Slide

The live verse feature lets you put a verse on screen the instant it is called for during
a service — without opening the builder, saving, or reloading the presentation.

### Setting up the dynamic slide

1. In the builder, open the **Add Content** menu and choose **📖 Add Live Bible Slide**.
2. This inserts a blank dynamic slide containing a single `:bibleverse:` marker. Add a
   background to it if you like; until a verse is sent it shows only the background.

### Presenting verses

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

### How delivery works

The main process is the single source of truth and broadcasts the rendered, HTML-escaped
verse over Socket.IO to a room scoped to this install's access key
(`bibletext:live-<accessKey>`). Every slide deck — local projector and remote browsers —
joins that room and renders what it receives. Embedding the access key in the room name
keeps other devices on the LAN (or other installs sharing a public relay) from joining or
injecting content.

> **Note:** Because delivery is Socket.IO-only, it depends on the
> `presenterPluginsPublicServer` setting being reachable. For offline / local-only use,
> point it at your local server (network mode). There is no separate offline fallback.

---

<a id="bibletext-local-xml"></a>
## Loading Local XML Bibles

To add local bible XML files:

1. In the app, open the **Plugins** menu.
2. Click **Open Plugins Folder...**
3. Open the `bibletext` plugin folder.
4. Copy your local bible `.xml` files into that plugin's bible storage folder.
5. Restart the app so the new local translations are detected.

Once loaded, local translations appear in the translation list with a `.local` id.

---

<a id="bibletext-esv-api-key"></a>
## ESV API Key Setup

To enable direct ESV online access:

1. Go to [esv.org](https://www.esv.org/) and create/sign in to your account.
2. Visit the ESV API area and generate an API key.
3. Open REVELation app **Settings**.
4. Go to the Bible Text plugin settings.
5. Paste the key into `esvApiKey`.
6. Save settings.

After this, ESV becomes available as an online translation option in the Bible Text dialog.

---

<a id="bibletext-configuration"></a>
## Configuration

Key settings:

- `defaultTranslation`: default translation id
- `bibleAPI`: online API base URL (`none` disables online calls)
- `esvApiKey`: optional key for ESV API access
