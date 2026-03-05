#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PLUGIN_ROOT="$ROOT/WordPress/revelation-presentations"
BUILD_DIR="$ROOT/WordPress/build"
ZIP_PATH="$BUILD_DIR/revelation-presentations.zip"

mkdir -p "$BUILD_DIR"
rm -f "$ZIP_PATH"

(
  cd "$ROOT/WordPress"
  zip -r "$ZIP_PATH" revelation-presentations \
    -x "*/.DS_Store" \
    -x "*/scripts/*"
)

echo "Built: $ZIP_PATH"
