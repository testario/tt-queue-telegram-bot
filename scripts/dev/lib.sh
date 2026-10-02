#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

export COMPOSE_FILE="$PROJECT_ROOT/docker-compose.vps-dev.yml"

run_dev_script() {
  local script_name="$1"
  shift
  exec "$PROJECT_ROOT/scripts/$script_name.sh" "$@"
}
