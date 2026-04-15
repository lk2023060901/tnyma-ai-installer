#!/usr/bin/env bash

set -euo pipefail

DRY_RUN=0
ASSUME_YES=0
FAILURES=()
USER_GUI_DOMAIN="gui/$(id -u)"

APP_BUNDLES=(
  "/Applications/TnymaAI.app"
  "$HOME/Applications/TnymaAI.app"
  "/Applications/OpenClaw.app"
  "$HOME/Applications/OpenClaw.app"
)

REMOVE_PATHS=(
  "$HOME/.openclaw"
  "$HOME/.tnyma-ai"
  "$HOME/.local/bin/openclaw"
  "$HOME/Library/Application Support/tnyma-ai"
  "$HOME/Library/Application Support/TnymaAI"
  "$HOME/Library/Application Support/OpenClaw"
  "$HOME/Library/Application Support/openclaw-office-installer"
  "$HOME/Library/Caches/tnyma-ai"
  "$HOME/Library/Caches/TnymaAI"
  "$HOME/Library/Caches/OpenClaw"
  "$HOME/Library/Caches/app.tnyma-ai.desktop"
  "$HOME/Library/Caches/ai.openclaw.mac"
  "$HOME/Library/Logs/tnyma-ai"
  "$HOME/Library/Logs/TnymaAI"
  "$HOME/Library/Logs/OpenClaw"
  "$HOME/Library/Logs/ai.openclaw.mac"
  "$HOME/Library/Preferences/app.tnyma-ai.desktop.plist"
  "$HOME/Library/Preferences/com.electron.tnyma-ai.plist"
  "$HOME/Library/Preferences/ai.openclaw.mac.plist"
  "$HOME/Library/Preferences/ai.openclaw.shared.plist"
  "$HOME/Library/Saved Application State/app.tnyma-ai.desktop.savedState"
  "$HOME/Library/Saved Application State/ai.openclaw.mac.savedState"
  "$HOME/Library/WebKit/app.tnyma-ai.desktop"
  "$HOME/Library/WebKit/ai.openclaw.mac"
  "$HOME/Library/HTTPStorages/app.tnyma-ai.desktop"
  "$HOME/Library/HTTPStorages/ai.openclaw.mac"
  "$HOME/Library/LaunchAgents/ai.openclaw.codexdoc.plist"
)

usage() {
  cat <<'EOF'
Usage: bash scripts/cleanup-installed-mac.sh [--yes] [--dry-run]

Removes installed TnymaAI/OpenClaw app bundles, user data, login items,
LaunchAgents, and CLI leftovers from the current macOS user account.

Options:
  --yes      Skip the confirmation prompt.
  --dry-run  Print the actions without changing anything.
  --help     Show this help message.

Notes:
  - If Homebrew installed openclaw-cli or openclaw, this script will uninstall it.
    Homebrew may also auto-remove orphaned dependencies.
  - If npm installed openclaw globally, this script will uninstall it.
EOF
}

note() {
  printf '==> %s\n' "$*"
}

warn() {
  printf 'WARN: %s\n' "$*" >&2
}

record_failure() {
  FAILURES+=("$1")
  warn "$1"
}

print_cmd() {
  printf '[dry-run]'
  while (($# > 0)); do
    printf ' %q' "$1"
    shift
  done
  printf '\n'
}

run_optional() {
  if ((DRY_RUN)); then
    print_cmd "$@"
    return 0
  fi

  "$@" >/dev/null 2>&1 || true
}

remove_path() {
  local path="$1"

  if [[ ! -e "$path" && ! -L "$path" ]]; then
    return 0
  fi

  if ((DRY_RUN)); then
    print_cmd rm -rf "$path"
    return 0
  fi

  if ! rm -rf "$path"; then
    record_failure "Failed to remove $path"
  fi
}

remove_matching_paths() {
  local root="$1"
  local pattern="$2"
  local matches=""

  if [[ ! -d "$root" ]]; then
    return 0
  fi

  matches="$(find "$root" -maxdepth 1 -name "$pattern" -print 2>/dev/null || true)"
  if [[ -z "$matches" ]]; then
    return 0
  fi

  while IFS= read -r match; do
    [[ -n "$match" ]] || continue
    remove_path "$match"
  done <<< "$matches"
}

confirm() {
  if ((ASSUME_YES)); then
    return 0
  fi

  printf '%s\n' "This will remove installed TnymaAI/OpenClaw app bundles, user data, login items,"
  printf '%s\n' "LaunchAgents, CLI shims, and uninstall matching Homebrew/npm packages if present."
  printf '%s\n' "Homebrew may also auto-remove orphaned dependencies when uninstalling openclaw-cli."
  read -r -p "Continue? [y/N] " reply

  case "$reply" in
    y|Y|yes|YES)
      ;;
    *)
      printf 'Aborted.\n'
      exit 1
      ;;
  esac
}

collect_target_pids() {
  ps -axo pid=,command= | awk '
    /\/TnymaAI\.app\/Contents\/MacOS\/TnymaAI([[:space:]]|$)/ ||
    /\/TnymaAI\.app\/Contents\/Frameworks\/TnymaAI Helper/ ||
    /\/OpenClaw\.app\/Contents\/MacOS\/OpenClaw([[:space:]]|$)/ ||
    /\/OpenClaw\.app\/Contents\/Frameworks\/OpenClaw Helper/ ||
    /\/Resources\/bin\/openclaw-gateway([[:space:]]|$)/ ||
    /\/Resources\/cli\/openclaw([[:space:]]|$)/ ||
    /\/\.local\/bin\/openclaw([[:space:]]|$)/ ||
    /\/(opt\/homebrew|usr\/local)\/bin\/openclaw-cli([[:space:]]|$)/ {
      print $1
    }
  '
}

stop_target_processes() {
  local pids=""
  local remaining=""

  pids="$(collect_target_pids)"
  if [[ -z "$pids" ]]; then
    return 0
  fi

  note "Stopping local TnymaAI/OpenClaw processes"
  if ((DRY_RUN)); then
    print_cmd kill $pids
    print_cmd kill -9 $pids
    return 0
  fi

  kill $pids >/dev/null 2>&1 || true
  sleep 1
  remaining="$(collect_target_pids)"
  if [[ -n "$remaining" ]]; then
    kill -9 $remaining >/dev/null 2>&1 || true
  fi
}

remove_login_items() {
  if ! command -v osascript >/dev/null 2>&1; then
    return 0
  fi

  note "Removing login items"
  run_optional osascript -e 'tell application "System Events" to delete login item "TnymaAI"'
  run_optional osascript -e 'tell application "System Events" to delete login item "OpenClaw"'
}

bootout_launch_agent() {
  local plist_path="$1"

  if [[ ! -e "$plist_path" ]]; then
    return 0
  fi

  if ((DRY_RUN)); then
    print_cmd launchctl bootout "$USER_GUI_DOMAIN" "$plist_path"
    return 0
  fi

  launchctl bootout "$USER_GUI_DOMAIN" "$plist_path" >/dev/null 2>&1 || true
}

uninstall_global_npm_openclaw() {
  if ! command -v npm >/dev/null 2>&1; then
    return 0
  fi

  if ! npm list -g --depth=0 openclaw >/dev/null 2>&1; then
    return 0
  fi

  note "Uninstalling global npm package: openclaw"
  if ((DRY_RUN)); then
    print_cmd npm uninstall -g openclaw
    return 0
  fi

  if ! npm uninstall -g openclaw; then
    record_failure "Failed to uninstall global npm package openclaw"
  fi
}

uninstall_homebrew_formulae() {
  local formula=""

  if ! command -v brew >/dev/null 2>&1; then
    return 0
  fi

  for formula in openclaw-cli openclaw; do
    if ! brew list --formula "$formula" >/dev/null 2>&1; then
      continue
    fi

    note "Uninstalling Homebrew formula: $formula"
    if ((DRY_RUN)); then
      print_cmd brew uninstall "$formula"
      continue
    fi

    if ! brew uninstall "$formula"; then
      record_failure "Failed to uninstall Homebrew formula $formula"
    fi
  done
}

main() {
  local path=""

  if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "This cleanup script only supports macOS." >&2
    exit 1
  fi

  while (($# > 0)); do
    case "$1" in
      --yes)
        ASSUME_YES=1
        ;;
      --dry-run)
        DRY_RUN=1
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        echo "Unknown argument: $1" >&2
        usage >&2
        exit 1
        ;;
    esac
    shift
  done

  confirm

  stop_target_processes
  remove_login_items
  bootout_launch_agent "$HOME/Library/LaunchAgents/ai.openclaw.codexdoc.plist"

  note "Removing app bundles"
  for path in "${APP_BUNDLES[@]}"; do
    remove_path "$path"
  done

  note "Removing TnymaAI/OpenClaw files"
  for path in "${REMOVE_PATHS[@]}"; do
    remove_path "$path"
  done

  remove_matching_paths "$HOME/Library/Caches/Homebrew" 'openclaw*'

  uninstall_global_npm_openclaw
  uninstall_homebrew_formulae

  if ((DRY_RUN)); then
    note "Dry run complete"
    exit 0
  fi

  if ((${#FAILURES[@]} > 0)); then
    warn "Cleanup finished with issues:"
    for path in "${FAILURES[@]}"; do
      warn "  - $path"
    done
    exit 1
  fi

  note "Cleanup complete"
}

main "$@"
