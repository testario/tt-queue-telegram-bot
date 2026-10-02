#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"

if [[ "$COMPOSE_FILE" != /* ]]; then
  COMPOSE_FILE="$PROJECT_ROOT/$COMPOSE_FILE"
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "Compose-файл не найден: $COMPOSE_FILE" >&2
  exit 1
fi

compose() {
  (
    cd "$PROJECT_ROOT"
    docker compose -f "$COMPOSE_FILE" "$@"
  )
}
