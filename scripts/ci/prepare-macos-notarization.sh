#!/usr/bin/env bash
set -euo pipefail

if [[ "${CI_COMMIT_TAG:-}" == "" ]]; then
  echo "prepare-macos-notarization: non-tag pipeline, notarization setup is optional"
  return 0 2>/dev/null || exit 0
fi

if [[ -n "${APPLE_API_KEY:-}" && -n "${APPLE_API_KEY_ID:-}" && -n "${APPLE_API_ISSUER:-}" ]]; then
  echo "prepare-macos-notarization: using existing APPLE_API_KEY path"
  return 0 2>/dev/null || exit 0
fi

if [[ -n "${APPLE_ID:-}" && -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" && -n "${APPLE_TEAM_ID:-}" ]]; then
  echo "prepare-macos-notarization: using Apple ID + app-specific password credentials"
  return 0 2>/dev/null || exit 0
fi

KEY_B64="${APPLE_API_KEY_BASE64:-${APPLE_API_KEY_P8_BASE64:-}}"
if [[ -n "${KEY_B64}" && -n "${APPLE_API_KEY_ID:-}" && -n "${APPLE_API_ISSUER:-}" ]]; then
  KEY_DIR="${CI_PROJECT_DIR:-$(pwd)}/build/secrets"
  KEY_PATH="${KEY_DIR}/AuthKey_${APPLE_API_KEY_ID}.p8"
  mkdir -p "${KEY_DIR}"
  printf '%s' "${KEY_B64}" | base64 --decode > "${KEY_PATH}"
  chmod 600 "${KEY_PATH}"
  export APPLE_API_KEY="${KEY_PATH}"
  echo "prepare-macos-notarization: wrote API key to ${KEY_PATH}"
  return 0 2>/dev/null || exit 0
fi

echo "prepare-macos-notarization: missing notarization credentials for tag release." >&2
echo "Provide either APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER, APPLE_API_KEY_BASE64 + APPLE_API_KEY_ID + APPLE_API_ISSUER, or APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID." >&2
return 1 2>/dev/null || exit 1
