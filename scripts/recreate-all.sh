#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/compose.sh"

# QueueState меняют и bot, и backend: останавливаем оба writer-процесса,
# чтобы они запускались только на одной версии кода.
compose stop bot backend
compose up -d --build --force-recreate --no-deps "$@" bot backend frontend
compose ps bot backend frontend
