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

<a id="test-how-it-works"></a>
## How It Works

It registers during startup, adds a menu entry, and logs actions when the menu item or API trigger is used.
