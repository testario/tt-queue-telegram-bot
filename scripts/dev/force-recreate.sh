#!/usr/bin/env bash

set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
source "$PROJECT_ROOT/scripts/lib/compose.sh"

if [[ "${1:-}" != "--yes" || "$#" -ne 1 ]]; then
  echo "Скрипт удалит все dev-контейнеры, сети и volumes. Запустите с --yes." >&2
  exit 1
fi

compose down --remove-orphans --volumes
compose up -d --build --force-recreate
compose ps
