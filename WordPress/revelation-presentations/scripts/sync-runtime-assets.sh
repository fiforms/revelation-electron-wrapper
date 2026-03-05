#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PLUGIN_DIR="$ROOT/WordPress/revelation-presentations"
RUNTIME_DIR="$PLUGIN_DIR/assets/runtime"

mkdir -p "$RUNTIME_DIR/js" "$RUNTIME_DIR/css"

cp "$ROOT/revelation/dist/js/offline-bundle.js" "$RUNTIME_DIR/js/offline-bundle.js"
cp "$ROOT/revelation/js/translate.js" "$RUNTIME_DIR/js/translate.js"
cp "$ROOT/revelation/js/translations.json" "$RUNTIME_DIR/js/translations.json"

rm -rf "$RUNTIME_DIR/css"
mkdir -p "$RUNTIME_DIR/css"
cp -R "$ROOT/revelation/dist/css/." "$RUNTIME_DIR/css/"
cp "$ROOT/revelation/node_modules/reveal.js/dist/reveal.css" "$RUNTIME_DIR/css/reveal.css"

echo "Synced runtime assets into $RUNTIME_DIR"
