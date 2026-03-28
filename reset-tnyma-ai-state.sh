#!/bin/sh

set -eu

if [ "$(uname -s)" != "Darwin" ]; then
  echo "reset-tnyma-ai-state.sh only supports macOS." >&2
  exit 1
fi

HOME_DIR="${HOME}"
APP_SUPPORT_DIR="${HOME_DIR}/Library/Application Support"
PREFERENCES_DIR="${HOME_DIR}/Library/Preferences"
SAVED_STATE_DIR="${HOME_DIR}/Library/Saved Application State"
LOGS_DIR="${HOME_DIR}/Library/Logs"

echo "==> Stopping TnymaAI / OpenClaw related processes"
pkill -f 'TnymaAI|tnyma-ai|OpenClaw|openclaw' >/dev/null 2>&1 || true
sleep 1

echo "==> Removing persisted app state"
rm -rf \
  "${APP_SUPPORT_DIR}/tnyma-ai" \
  "${APP_SUPPORT_DIR}/OpenClaw" \
  "${HOME_DIR}/.openclaw" \
  "${HOME_DIR}/.tnyma-ai" \
  "${PREFERENCES_DIR}/app.tnyma-ai.desktop.plist" \
  "${PREFERENCES_DIR}/com.electron.tnyma-ai.plist" \
  "${SAVED_STATE_DIR}/app.tnyma-ai.desktop.savedState" \
  "${SAVED_STATE_DIR}/com.electron.tnyma-ai.savedState" \
  "${LOGS_DIR}/TnymaAI" \
  "${LOGS_DIR}/tnyma-ai"

echo "==> Cleanup complete"
echo "Removed:"
echo "  ${APP_SUPPORT_DIR}/tnyma-ai"
echo "  ${APP_SUPPORT_DIR}/OpenClaw"
echo "  ${HOME_DIR}/.openclaw"
echo "  ${HOME_DIR}/.tnyma-ai"
echo
echo "You can now reopen TnymaAI and it should start from the first setup step."
