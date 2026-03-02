# Test Plugin

## Table of Contents
* [Overview](#test-overview)
* [What It Adds](#test-what-it-adds)
* [How It Works](#test-how-it-works)

<a id="test-overview"></a>
## Overview

The Test plugin is a simple example/debug plugin used to validate plugin hooks.

<a id="test-what-it-adds"></a>
## What It Adds

- An "Example Test Plugin" menu item under Plugins
- A sample `example-echo` API trigger
- Builder extension API examples when opened in Presentation Builder:
  - Toolbar action (`registerToolbarAction`)
  - Builder panel (`registerPanel`)
  - Preview overlay (`registerPreviewOverlay`)
  - Toggle mode button (`registerMode`)
  - Transaction demos via `host.transact(...)`
  - Event subscriptions (`selection:changed`, `preview:slidechanged`, `save:after`)

<a id="test-how-it-works"></a>
## How It Works

It registers during startup, adds a menu entry, and logs actions when the menu item or API trigger is used.
On the builder page it exposes `getBuilderExtensions(...)` by lazy-loading `builder.js` with dynamic `import()`.
This keeps builder-only code out of normal presenter/session parsing.
