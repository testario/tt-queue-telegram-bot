#!/bin/sh
set -eu

mongodb_host="${MONGODB_HOST:-mongodb}"
mongodb_port="${MONGODB_PORT:-27017}"
mongodb_db="${MONGODB_DB:-${MONGO_INITDB_DATABASE:-tt-queue-bot}}"
mongodb_auth_source="${MONGODB_AUTH_SOURCE:-admin}"
mongodb_username="${MONGODB_USERNAME:-${MONGO_INITDB_ROOT_USERNAME:-}}"
mongodb_password="${MONGODB_PASSWORD:-${MONGO_INITDB_ROOT_PASSWORD:-}}"

if [ -z "${METRICS_MONGODB_URI:-}" ] && [ -n "$mongodb_username" ] && [ -n "$mongodb_password" ]; then
  export METRICS_MONGODB_URI="mongodb://${mongodb_username}:${mongodb_password}@${mongodb_host}:${mongodb_port}/${mongodb_db}?authSource=${mongodb_auth_source}"
fi

if [ -z "${METRICS_MONGODB_DB:-}" ]; then
  export METRICS_MONGODB_DB="$mongodb_db"
fi

exec "$@"
