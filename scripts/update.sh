#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "Рабочее дерево содержит tracked-изменения. Сначала закоммитьте или уберите их." >&2
  exit 1
fi

git pull --ff-only
exec "$SCRIPT_DIR/recreate-all.sh" "$@"
