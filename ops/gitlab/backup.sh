#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ROOT_DIR}/gitlab.env"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}. Copy gitlab.env.example to gitlab.env first." >&2
  exit 1
fi

set -a
source "${ENV_FILE}"
set +a

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="${GITLAB_HOME}/backups/manual-${TIMESTAMP}"
mkdir -p "${BACKUP_DIR}"

echo "Creating GitLab backup into ${BACKUP_DIR}"
docker exec local-gitlab gitlab-backup create
docker cp local-gitlab:/etc/gitlab "${BACKUP_DIR}/config"
docker cp local-gitlab:/var/opt/gitlab/backups "${BACKUP_DIR}/gitlab-backups"

echo "Backup complete: ${BACKUP_DIR}"
