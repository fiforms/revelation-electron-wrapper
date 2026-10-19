# Bible Text Plugin

## Table of Contents
* [Overview](#bibletext-overview)
* [What It Adds](#bibletext-what-it-adds)
* [How It Works](#bibletext-how-it-works)
* [Live Bible Verse Slide](#bibletext-live-verse)
* [Downloading More Bibles](#bibletext-downloads)
* [Loading Local XML Bibles](#bibletext-local-xml)
* [ESV API Key Setup](#bibletext-esv-api-key)
* [Configuration](#bibletext-configuration)

---

<a id="bibletext-overview"></a>
## Overview

The Bible Text plugin searches and inserts scripture passages as formatted markdown slides.
It does not require or enable any viewer-collaboration features on its own.

---

<a id="bibletext-what-it-adds"></a>
## What It Adds

- Passage search dialog in the builder
- Translation selection (local and online)
- Passage formatting with verse text and references
- Attribution lines for inserted scripture
- A **Bible reader** sidebar for browsing/searching local translations by chapter
- A **Copyright** button in the reader that shows the open translation's own copyright and source information

---

<a id="bibletext-how-it-works"></a>
## How It Works

The plugin can read local bible data (`*.local` translations) and can also query online APIs. After fetching verses, it formats markdown and appends it to the selected presentation file.

---

<a id="bibletext-live-verse"></a>
## Live Bible Verse Slide

Pushing a verse live to the screen during a service — the dynamic `:bibleverse:` slide, the
"present" buttons in the reader sidebar, and the Socket.IO delivery — is a **separate, opt-in
plugin: [Live Bible Text](../bibletext-live/README.md)**. It is split out from this plugin
because it is a viewer-collaboration feature: anyone holding the presentation link can change
what every live-verse slide shows. Enable it in Settings if you want that feature; the
search/insert features on this page work without it.

The Bible reader sidebar here still shows per-verse "present" buttons, but they are disabled
(with a note) until the Live Bible Text plugin is enabled.

---

<a id="bibletext-downloads"></a>
## Downloading More Bibles

A release build bundles only the King James Version. Other translations are downloaded when you ask for them:

- **First-run setup:** the *Bible Translations* step lists the collection's language groups as checkboxes with a **Download Selected Bibles** button, plus a **Download NET Bible** button.
- **Any time:** the **Bible Downloads** button at the top right of the Bible Text reader opens the same two downloads.
- **Developers:** `npm run fetch-blobs` fetches the whole collection into this plugin's `bibles/` folder.

**Bible Collection** downloads the translations in the pastordaniel.net Bible manifest, by language group: *English*, *Spanish*, *Ancient Languages* (Hebrew and Greek) and *Other Languages*. Each group shows how many Bibles and how many MB it holds, and the groups matching your interface language are ticked first (English, plus Spanish for a Spanish interface). Groups you have already downloaded are marked, so you can come back later for another one. Each file is checked against its SHA-256 before it is kept, so a corrupt or tampered download is refused.

The groups come from the manifest, not from the app: `bibles/make-manifest.js` tags every file with its group (from the file's `<language>`, or an optional `groups.json` override), so a new group such as `portuguese` shows up for users without an app release.

**NET Bible** is downloaded directly from eBible.org (USFM) and converted to our XML format on your computer (`NET.xml`; verses only, without the translators' notes). The NET is © Biblical Studies Press, L.L.C. It is free for personal study and non-commercial ministry, quotations should end with "(NET)", and it must not be bundled with anything sold; see [netbible.com/copyright](https://netbible.com/copyright/). REVELation never redistributes the NET text: it goes from the publisher's site to your disk.

Downloads are saved in the `bibles` folder of the app's user-data folder (next to your settings), not in the plugin folder, so they survive app updates and need no write access to the installation. The plugin reads both folders and picks up a new download straight away; no restart is needed.

**Install XML Bible Module** (on the same page) adds a Bible file you already have. It opens a file browser for a Zefania XML module (`.xml` or `.xml.gz`), checks that it really is a Bible with text in it, copies it into the same user-data `bibles` folder and rebuilds the list. A file whose translation identifier is already installed is refused (the loader would otherwise ignore one of the two), and installing a file with the same name again replaces it.

The list is rebuilt after every download, including the first-run setup and a download that only partly succeeded, so a new Bible appears without restarting the app.

The **ESV** is not a download: it is looked up online with your own API key (see below).

---

<a id="bibletext-local-xml"></a>
## Loading Local XML Bibles

To add local bible XML files:

1. In the app, open the **Plugins** menu.
2. Click **Open Plugins Folder...**
3. Open the `bibletext` plugin folder.
4. Copy your local bible `.xml` files (`.xml.gz` and `.json` are also read) into that plugin's bible storage folder.
5. Restart the app so the new local translations are detected.

Files in the `bibles` folder of the user-data folder (where downloads go, see above) are read too.

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

- `defaultTranslation` (default `KJV.local`): default translation id
- `bibleAPI` (default `https://bible-api.com`): online API base URL (`none` disables online calls)
- `esvApiKey` (default empty): optional key for ESV API access. It is stored as a secret and is not exposed to the browser.

The plugin also adds a **Bible Text** button (`read.html`, the Bible reader) to the plugin buttons.

### HTTP API

When the local API server is enabled (Settings > Networking), the plugin registers read-only routes under
`/api/bibletext/`: `passage`, `translations`, `books`, `chapter` and `search`. See
[API_REFERENCE.md](../../doc/API_REFERENCE.md) for parameters.
