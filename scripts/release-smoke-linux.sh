#!/usr/bin/env bash
# D11: the release smoke on a fresh Ubuntu 24.04 (the VPS, or a clean VM). It installs what the AppImage and Electron
# need, copies the build into a temp folder, and runs scripts/release-smoke.mjs on it under a virtual display.
# Usage (from a checkout on the Linux machine, with Node 24 on PATH):
#   bash scripts/release-smoke-linux.sh <path to Chausar-*.AppImage or chausar-desktop_*.deb>
# The packages need sudo. Nothing here reads a key or a login; the smoke uses its own temp user data folder.
set -euo pipefail

if [ "$#" -ne 1 ] || [ ! -f "$1" ]; then
  echo "Usage: bash scripts/release-smoke-linux.sh <AppImage or .deb>" >&2
  exit 2
fi
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source_build="$1"

echo "step: packages"
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq xvfb xauth libfuse2t64 libnss3 libgtk-3-0t64 libasound2t64 libgbm1 >/dev/null
echo "ok   packages"

work="$(mktemp -d -t chausar-smoke-linux-XXXXXX)"
trap 'rm -rf "$work"' EXIT
build="$work/$(basename "$source_build")"
cp "$source_build" "$build"
echo "ok   copy: $build"

node --version
if node "$here/release-smoke.mjs" --installer "$build"; then
  echo "The Linux release smoke passed for $(basename "$source_build")."
else
  status=$?
  echo "The Linux release smoke failed for $(basename "$source_build") (exit $status)." >&2
  exit "$status"
fi
