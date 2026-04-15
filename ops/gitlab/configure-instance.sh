#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/gitlab.env"
CONTAINER_NAME="${GITLAB_CONTAINER_NAME:-local-gitlab}"

if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
fi

DEFAULT_LANGUAGE="${GITLAB_DEFAULT_LANGUAGE:-zh_CN}"

docker exec "${CONTAINER_NAME}" gitlab-rails runner "
  settings = ApplicationSetting.current
  settings.update!(default_preferred_language: '${DEFAULT_LANGUAGE}')

  root = User.find_by_username('root')
  root.update!(preferred_language: '${DEFAULT_LANGUAGE}') if root

  puts({ default_preferred_language: settings.default_preferred_language, root_preferred_language: root&.preferred_language }.inspect)
"
