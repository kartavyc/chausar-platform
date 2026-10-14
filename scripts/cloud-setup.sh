#!/usr/bin/env bash
# Prepare a Linux cloud or CI shell for this repository: Node 24.13.1 (checksum-verified)
# first on PATH, then the pinned dependencies without lifecycle scripts or browser downloads.
set -euo pipefail
NODE_VERSION=24.13.1
PREFIX="${CHAUSAR_NODE_PREFIX:-/opt/node24}"
BIN_DIR="${HOME}/.local/bin"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! "${PREFIX}/bin/node" --version 2>/dev/null | grep -qx "v${NODE_VERSION}"; then
  work="$(mktemp -d)"
  archive="node-v${NODE_VERSION}-linux-x64.tar.xz"
  curl -fsSL -o "${work}/${archive}" "https://nodejs.org/dist/v${NODE_VERSION}/${archive}"
  (cd "${work}" && curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" | grep " ${archive}\$" | sha256sum -c -)
  mkdir -p "${PREFIX}"
  tar -xJf "${work}/${archive}" -C "${PREFIX}" --strip-components=1
  rm -rf "${work}"
fi
mkdir -p "${BIN_DIR}"
for tool in node npm npx; do ln -sf "${PREFIX}/bin/${tool}" "${BIN_DIR}/${tool}"; done
export PATH="${BIN_DIR}:${PATH}"
node --version

cd "${root}"
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install --ignore-scripts --no-audit --no-fund
echo "Ready. Ensure ${BIN_DIR} is first on PATH in new shells."
