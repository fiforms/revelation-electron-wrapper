# Bible Text Plugin

## Table of Contents
* [Overview](#bibletext-overview)
* [What It Adds](#bibletext-what-it-adds)
* [How It Works](#bibletext-how-it-works)
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

---

<a id="bibletext-how-it-works"></a>
## How It Works

The plugin can read local bible data (`*.local` translations) and can also query online APIs. After fetching verses, it formats markdown and appends it to the selected presentation file.

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
