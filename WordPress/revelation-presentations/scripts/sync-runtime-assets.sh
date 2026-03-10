#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PLUGIN_DIR="$ROOT/WordPress/revelation-presentations"
RUNTIME_DIR="$PLUGIN_DIR/assets/runtime"
PLUGINS_DIR="$PLUGIN_DIR/assets/plugins"

mkdir -p "$RUNTIME_DIR/js" "$RUNTIME_DIR/css"

cp "$ROOT/revelation/dist/js/offline-bundle.js" "$RUNTIME_DIR/js/offline-bundle.js"
cp "$ROOT/revelation/js/translate.js" "$RUNTIME_DIR/js/translate.js"
cp "$ROOT/revelation/js/translations.json" "$RUNTIME_DIR/js/translations.json"

rm -rf "$RUNTIME_DIR/css"
mkdir -p "$RUNTIME_DIR/css"
cp -R "$ROOT/revelation/dist/css/." "$RUNTIME_DIR/css/"
cp "$ROOT/revelation/node_modules/reveal.js/dist/reveal.css" "$RUNTIME_DIR/css/reveal.css"

rm -rf "$PLUGINS_DIR"
mkdir -p "$PLUGINS_DIR"

mkdir -p "$PLUGINS_DIR/highlight"
cp "$ROOT/plugins/highlight/client.js" "$PLUGINS_DIR/highlight/client.js"
cp -R "$ROOT/plugins/highlight/highlight" "$PLUGINS_DIR/highlight/highlight"
cp "$ROOT/plugins/highlight/highlight/plugin.bundle.mjs" "$PLUGINS_DIR/highlight/highlight/plugin.bundle.js"

mkdir -p "$PLUGINS_DIR/markerboard"
cp "$ROOT/plugins/markerboard/client.js" "$PLUGINS_DIR/markerboard/client.js"
cp -R "$ROOT/plugins/markerboard/client" "$PLUGINS_DIR/markerboard/client"

mkdir -p "$PLUGINS_DIR/slidecontrol"
cp "$ROOT/plugins/slidecontrol/client.js" "$PLUGINS_DIR/slidecontrol/client.js"

mkdir -p "$PLUGINS_DIR/revealchart"
cp "$ROOT/plugins/revealchart/client.js" "$PLUGINS_DIR/revealchart/client.js"
cp "$ROOT/plugins/revealchart/markdown-preprocessor.js" "$PLUGINS_DIR/revealchart/markdown-preprocessor.js"
cp "$ROOT/plugins/revealchart/csv-utils.js" "$PLUGINS_DIR/revealchart/csv-utils.js"
cp "$ROOT/plugins/revealchart/table-processor.js" "$PLUGINS_DIR/revealchart/table-processor.js"
cp "$ROOT/plugins/revealchart/builder.js" "$PLUGINS_DIR/revealchart/builder.js"
cp "$ROOT/plugins/revealchart/builder-dialog-template.js" "$PLUGINS_DIR/revealchart/builder-dialog-template.js"
cp -R "$ROOT/plugins/revealchart/revealchart" "$PLUGINS_DIR/revealchart/revealchart"

echo "Synced runtime assets into $RUNTIME_DIR"
echo "Synced hosted plugin assets into $PLUGINS_DIR"
