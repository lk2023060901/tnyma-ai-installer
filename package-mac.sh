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

timestamp() {
  date '+%H:%M:%S'
}

format_command() {
  printf '%s' "$1"
  shift
  for arg in "$@"; do
    printf ' %s' "$arg"
  done
  printf '\n'
}

run_with_progress() {
  step_name="$1"
  shift

  step_started_at="$(date +%s)"
  echo "==> [$(timestamp)] ${step_name}"
  echo "    command: $(format_command "$@")"

  "$@" &
  step_pid=$!
  heartbeat_pid=""

  (
    elapsed=0
    while kill -0 "${step_pid}" >/dev/null 2>&1; do
      sleep 30
      elapsed=$((elapsed + 30))
      if kill -0 "${step_pid}" >/dev/null 2>&1; then
        echo "    [$(timestamp)] still running (${elapsed}s): ${step_name}"
      fi
    done
  ) &
  heartbeat_pid=$!

  wait "${step_pid}"
  status=$?

  if [ -n "${heartbeat_pid}" ]; then
    kill "${heartbeat_pid}" >/dev/null 2>&1 || true
    wait "${heartbeat_pid}" 2>/dev/null || true
  fi

  step_finished_at="$(date +%s)"
  step_duration=$((step_finished_at - step_started_at))

  if [ "${status}" -eq 0 ]; then
    echo "==> [$(timestamp)] Completed ${step_name} (${step_duration}s)"
  else
    echo "==> [$(timestamp)] Failed ${step_name} (${step_duration}s) with exit code ${status}" >&2
  fi

  return "${status}"
}

run_step() {
  step_name="$1"
  shift

  if run_with_progress "${step_name}" "$@"; then
    return 0
  else
    status=$?
  fi

  if has_local_proxy; then
    echo "==> [$(timestamp)] ${step_name} failed. Retrying once without proxy variables"
    if run_with_progress "${step_name} (retry without proxy)" env \
      -u HTTP_PROXY \
      -u HTTPS_PROXY \
      -u ALL_PROXY \
      -u http_proxy \
      -u https_proxy \
      -u all_proxy \
      "$@"; then
      return 0
    fi
    return $?
  fi

  return $status
}

load_signing_env_file() {
  env_file="$1"

  if [ -z "${env_file}" ] || [ ! -f "${env_file}" ]; then
    return 1
  fi

  echo "==> Loading signing environment from ${env_file}"
  set -a
  # shellcheck disable=SC1090
  . "${env_file}"
  set +a
  return 0
}

load_signing_env() {
  if [ -n "${CSC_NAME:-}" ] && [ -n "${APPLE_KEYCHAIN_PROFILE:-}" ]; then
    return 0
  fi

  if [ -n "${TNYMAAI_MAC_SIGNING_ENV:-}" ] && load_signing_env_file "${TNYMAAI_MAC_SIGNING_ENV}"; then
    return 0
  fi
}

require_env() {
  var_name="$1"
  eval "var_value=\${$var_name:-}"
  if [ -z "${var_value}" ]; then
    echo "Missing required environment variable: ${var_name}" >&2
    exit 1
  fi
}

require_signing_env() {
  require_env CSC_NAME
  require_env APPLE_KEYCHAIN_PROFILE

  if [ -z "${APPLE_KEYCHAIN:-}" ]; then
    APPLE_KEYCHAIN="${HOME}/Library/Keychains/login.keychain-db"
    export APPLE_KEYCHAIN
  fi
}

resolve_dmg_codesign_identity() {
  case "${CSC_NAME}" in
    Developer\ ID\ Application:*)
      printf '%s\n' "${CSC_NAME}"
      ;;
    *)
      printf 'Developer ID Application: %s\n' "${CSC_NAME}"
      ;;
  esac
}

resolve_electron_builder_csc_name() {
  case "${CSC_NAME}" in
    Developer\ ID\ Application:\ *)
      printf '%s\n' "${CSC_NAME#Developer ID Application: }"
      ;;
    *)
      printf '%s\n' "${CSC_NAME}"
      ;;
  esac
}

validate_app_bundle() {
  label="$1"
  app_path="$2"

  if [ ! -d "${app_path}" ]; then
    echo "Missing app bundle: ${app_path}" >&2
    exit 1
  fi

  run_step "Validating ${label} bundle signature" \
    codesign --verify --deep --strict --verbose=4 "${app_path}"
  run_step "Validating ${label} bundle Gatekeeper acceptance" \
    spctl -a -vvv -t exec "${app_path}"
  run_step "Validating ${label} bundle stapled ticket" \
    xcrun stapler validate "${app_path}"
}

validate_zip_artifact() {
  label="$1"
  zip_path="$2"
  temp_dir="$3"
  extract_dir="${temp_dir}/$(basename "${zip_path}" .zip)"
  app_path="${extract_dir}/TnymaAI.app"

  mkdir -p "${extract_dir}"
  run_step "Extracting ${label} zip for validation" \
    ditto -x -k "${zip_path}" "${extract_dir}"
  validate_app_bundle "${label} zip app" "${app_path}"
}

sign_and_notarize_dmg() {
  label="$1"
  dmg_path="$2"
  dmg_codesign_identity="$3"

  if [ ! -f "${dmg_path}" ]; then
    echo "Missing dmg artifact: ${dmg_path}" >&2
    exit 1
  fi

  run_step "Signing ${label} dmg container" \
    codesign --force --sign "${dmg_codesign_identity}" "${dmg_path}"
  run_step "Submitting ${label} dmg for notarization" \
    xcrun notarytool submit "${dmg_path}" \
      --keychain-profile "${APPLE_KEYCHAIN_PROFILE}" \
      --keychain "${APPLE_KEYCHAIN}" \
      --wait
  run_step "Stapling ${label} dmg ticket" \
    xcrun stapler staple "${dmg_path}"
  run_step "Validating ${label} dmg stapled ticket" \
    xcrun stapler validate "${dmg_path}"
  run_step "Validating ${label} dmg Gatekeeper acceptance" \
    spctl -a -vvv --type open --context context:primary-signature "${dmg_path}"
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

load_signing_env
require_signing_env

VERSION="$(node -p "require('./package.json').version")"
DMG_CODESIGN_IDENTITY="$(resolve_dmg_codesign_identity)"
ELECTRON_BUILDER_CSC_NAME="$(resolve_electron_builder_csc_name)"
TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/tnymaai-mac-package.XXXXXX")"

cleanup() {
  if [ -n "${TEMP_ROOT:-}" ] && [ -d "${TEMP_ROOT}" ]; then
    rm -rf "${TEMP_ROOT}"
  fi
}

trap cleanup EXIT INT TERM

echo "==> [$(timestamp)] Starting macOS packaging workflow"
echo "==> [$(timestamp)] Version: ${VERSION}"
echo "==> [$(timestamp)] Using dmg signing identity: ${DMG_CODESIGN_IDENTITY}"
echo "==> [$(timestamp)] Using electron-builder signing name: ${ELECTRON_BUILDER_CSC_NAME}"
echo "==> [$(timestamp)] Stopping stale packaging processes"
pkill -f 'electron-builder|app-builder|pnpm.*package' >/dev/null 2>&1 || true
sleep 1

echo "==> [$(timestamp)] Cleaning previous macOS packaging outputs"
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

echo "==> [$(timestamp)] Building x64 artifacts via electron-builder"
run_step "Building macOS DMG (x64)" env CSC_NAME="${ELECTRON_BUILDER_CSC_NAME}" pnpm exec electron-builder --mac dmg --x64 --publish never
run_step "Building macOS ZIP (x64)" env CSC_NAME="${ELECTRON_BUILDER_CSC_NAME}" pnpm exec electron-builder --mac zip --x64 --publish never
echo "==> [$(timestamp)] Building arm64 artifacts via electron-builder"
run_step "Building macOS DMG (arm64)" env CSC_NAME="${ELECTRON_BUILDER_CSC_NAME}" pnpm exec electron-builder --mac dmg --arm64 --publish never
run_step "Building macOS ZIP (arm64)" env CSC_NAME="${ELECTRON_BUILDER_CSC_NAME}" pnpm exec electron-builder --mac zip --arm64 --publish never

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

validate_app_bundle "macOS x64 app" "release/mac/TnymaAI.app"
validate_app_bundle "macOS arm64 app" "release/mac-arm64/TnymaAI.app"

validate_zip_artifact "macOS x64" "release/TnymaAI-${VERSION}-mac-x64.zip" "${TEMP_ROOT}"
validate_zip_artifact "macOS arm64" "release/TnymaAI-${VERSION}-mac-arm64.zip" "${TEMP_ROOT}"

echo "==> [$(timestamp)] Signing and notarizing dmg containers"
sign_and_notarize_dmg "macOS x64" "release/TnymaAI-${VERSION}-mac-x64.dmg" "${DMG_CODESIGN_IDENTITY}"
sign_and_notarize_dmg "macOS arm64" "release/TnymaAI-${VERSION}-mac-arm64.dmg" "${DMG_CODESIGN_IDENTITY}"

run_step "Removing update artifacts" node scripts/remove-update-artifacts.mjs

echo "==> [$(timestamp)] Done"
find release -maxdepth 1 -type f | sort
