#!/usr/bin/env bash
set -euo pipefail

if [[ "${CI_COMMIT_TAG:-}" == "" ]]; then
  echo "verify-macos-notarization: non-tag pipeline, skipping notarization validation"
  exit 0
fi

if ! command -v xcrun >/dev/null 2>&1; then
  echo "verify-macos-notarization: xcrun not available" >&2
  exit 1
fi

if ! command -v spctl >/dev/null 2>&1; then
  echo "verify-macos-notarization: spctl not available" >&2
  exit 1
fi

if ! command -v codesign >/dev/null 2>&1; then
  echo "verify-macos-notarization: codesign not available" >&2
  exit 1
fi

shopt -s nullglob
apps=(release/mac/*.app release/mac-arm64/*.app)
dmgs=(release/*.dmg)
shopt -u nullglob

if [[ ${#apps[@]} -eq 0 ]]; then
  echo "verify-macos-notarization: no .app bundles found under release/mac*"
  exit 1
fi

if [[ ${#dmgs[@]} -eq 0 ]]; then
  echo "verify-macos-notarization: no .dmg files found under release/"
  exit 1
fi

for app in "${apps[@]}"; do
  echo "Verifying codesign for ${app}"
  codesign --verify --deep --strict --verbose=2 "${app}"
  echo "Assessing Gatekeeper status for ${app}"
  spctl --assess --type exec --verbose=4 "${app}"
done

for dmg in "${dmgs[@]}"; do
  echo "Validating stapled ticket for ${dmg}"
  xcrun stapler validate "${dmg}"
done

echo "verify-macos-notarization: notarization validation completed"
