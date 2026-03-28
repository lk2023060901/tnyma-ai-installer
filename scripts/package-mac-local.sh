#!/bin/sh

set -eu

SCRIPT_PATH="$0"
case "${SCRIPT_PATH}" in
  /*) ;;
  *) SCRIPT_PATH="$(pwd)/${SCRIPT_PATH}" ;;
esac

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${SCRIPT_PATH}")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This script only supports macOS." >&2
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is not installed or not on PATH." >&2
  echo "Run: corepack enable && corepack prepare pnpm@10.31.0 --activate" >&2
  exit 1
fi

HOST_ARCH="$(uname -m)"
case "${HOST_ARCH}" in
  arm64|aarch64)
    TARGET_ARCH="arm64"
    ;;
  x86_64|amd64)
    TARGET_ARCH="x64"
    ;;
  *)
    echo "Unsupported macOS architecture: ${HOST_ARCH}" >&2
    exit 1
    ;;
esac

if [ "${1:-}" != "" ]; then
  case "${1}" in
    arm64|x64)
      TARGET_ARCH="${1}"
      ;;
    *)
      echo "Unsupported target arch: ${1}. Use arm64 or x64." >&2
      exit 1
      ;;
  esac
fi

cd "${REPO_ROOT}"

VERSION="$(node -p "require('./package.json').version")"
DMG_PATH="release/TnymaAI-${VERSION}-mac-${TARGET_ARCH}.dmg"
ZIP_PATH="release/TnymaAI-${VERSION}-mac-${TARGET_ARCH}.zip"

run_clean_env() {
  env \
    -u HTTP_PROXY \
    -u HTTPS_PROXY \
    -u ALL_PROXY \
    -u http_proxy \
    -u https_proxy \
    -u all_proxy \
    "$@"
}

echo "==> Repo root: ${REPO_ROOT}"
echo "==> Target arch: ${TARGET_ARCH}"
echo "==> Version: ${VERSION}"

echo "==> Stopping stale packaging processes"
pkill -f 'electron-builder|app-builder|pnpm.*package' >/dev/null 2>&1 || true
sleep 1

echo "==> Cleaning previous ${TARGET_ARCH} packaging artifacts"
rm -rf "release/mac-${TARGET_ARCH}"
rm -f \
  "${DMG_PATH}" \
  "${DMG_PATH}.blockmap" \
  "${ZIP_PATH}" \
  "${ZIP_PATH}.blockmap"

echo "==> Rebuilding app bundles"
run_clean_env SKIP_PREINSTALLED_SKILLS=1 pnpm run package

echo "==> Building macOS DMG (${TARGET_ARCH})"
run_clean_env pnpm exec electron-builder --mac dmg "--${TARGET_ARCH}" --publish never

echo "==> Building macOS ZIP (${TARGET_ARCH})"
run_clean_env pnpm exec electron-builder --mac zip "--${TARGET_ARCH}" --publish never

echo "==> Verifying artifacts"
if [ ! -f "${DMG_PATH}" ]; then
  echo "DMG artifact not found: ${DMG_PATH}" >&2
  exit 1
fi

if [ ! -f "${ZIP_PATH}" ]; then
  echo "ZIP artifact not found: ${ZIP_PATH}" >&2
  exit 1
fi

echo "==> Done"
ls -lah "${DMG_PATH}" "${ZIP_PATH}"
