#!/bin/sh

set -eu

REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "${REPO_ROOT}"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "package-mac.sh only supports macOS." >&2
  exit 1
fi

ensure_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    return 0
  fi

  if command -v corepack >/dev/null 2>&1; then
    echo "==> Activating pnpm via corepack"
    corepack enable >/dev/null 2>&1 || true
    corepack prepare pnpm@10.31.0 --activate
  fi

  if ! command -v pnpm >/dev/null 2>&1; then
    echo "pnpm is not installed or not on PATH." >&2
    exit 1
  fi
}

has_local_proxy() {
  case "${HTTP_PROXY:-} ${HTTPS_PROXY:-} ${ALL_PROXY:-} ${http_proxy:-} ${https_proxy:-} ${all_proxy:-}" in
    *127.0.0.1*|*localhost*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

run_step() {
  step_name="$1"
  shift

  echo "==> ${step_name}"
  if "$@"; then
    return 0
  else
    status=$?
  fi

  if has_local_proxy; then
    echo "==> ${step_name} failed. Retrying once without proxy variables"
    env \
      -u HTTP_PROXY \
      -u HTTPS_PROXY \
      -u ALL_PROXY \
      -u http_proxy \
      -u https_proxy \
      -u all_proxy \
      "$@"
    return $?
  fi

  return $status
}

ensure_pnpm

if [ ! -f package.json ] || [ ! -f pnpm-lock.yaml ]; then
  echo "Run this script from the repository root." >&2
  exit 1
fi

if [ ! -f node_modules/.modules.yaml ] || [ package.json -nt node_modules/.modules.yaml ] || [ pnpm-lock.yaml -nt node_modules/.modules.yaml ]; then
  run_step "Installing dependencies" pnpm install --frozen-lockfile
else
  echo "==> Dependencies already installed"
fi

if [ ! -x resources/bin/darwin-x64/uv ] || [ ! -x resources/bin/darwin-arm64/uv ]; then
  run_step "Downloading macOS uv binaries" pnpm run uv:download:mac
else
  echo "==> macOS uv binaries already present"
fi

VERSION="$(node -p "require('./package.json').version")"

echo "==> Stopping stale packaging processes"
pkill -f 'electron-builder|app-builder|pnpm.*package' >/dev/null 2>&1 || true
sleep 1

echo "==> Cleaning previous macOS packaging outputs"
rm -rf release/mac release/mac-arm64
rm -f \
  "release/TnymaAI-${VERSION}-mac-x64.dmg" \
  "release/TnymaAI-${VERSION}-mac-x64.dmg.blockmap" \
  "release/TnymaAI-${VERSION}-mac-x64.zip" \
  "release/TnymaAI-${VERSION}-mac-x64.zip.blockmap" \
  "release/TnymaAI-${VERSION}-mac-arm64.dmg" \
  "release/TnymaAI-${VERSION}-mac-arm64.dmg.blockmap" \
  "release/TnymaAI-${VERSION}-mac-arm64.zip" \
  "release/TnymaAI-${VERSION}-mac-arm64.zip.blockmap" \
  "release/latest-mac.yml"
rm -rf release/github

run_step "Rebuilding app bundles" pnpm run package

run_step "Building macOS DMG (x64)" pnpm exec electron-builder --mac dmg --x64 --publish never
run_step "Building macOS ZIP (x64)" pnpm exec electron-builder --mac zip --x64 --publish never
run_step "Building macOS DMG (arm64)" pnpm exec electron-builder --mac dmg --arm64 --publish never
run_step "Building macOS ZIP (arm64)" pnpm exec electron-builder --mac zip --arm64 --publish never

for artifact in \
  "release/TnymaAI-${VERSION}-mac-x64.dmg" \
  "release/TnymaAI-${VERSION}-mac-x64.zip" \
  "release/TnymaAI-${VERSION}-mac-arm64.dmg" \
  "release/TnymaAI-${VERSION}-mac-arm64.zip"
do
  if [ ! -f "${artifact}" ]; then
    echo "Missing artifact: ${artifact}" >&2
    exit 1
  fi
done

echo "==> Done"
find release -maxdepth 1 -type f | sort
