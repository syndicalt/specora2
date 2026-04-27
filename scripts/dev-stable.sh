#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
api_port="${PORT:-4000}"
web_port="${WEB_PORT:-3000}"
api_url="${NEXT_PUBLIC_API_URL:-http://localhost:${api_port}/graphql}"

api_pid=""
web_pid=""

cleanup() {
  if [[ -n "$web_pid" ]] && kill -0 "$web_pid" >/dev/null 2>&1; then
    kill "$web_pid" >/dev/null 2>&1 || true
  fi
  if [[ -n "$api_pid" ]] && kill -0 "$api_pid" >/dev/null 2>&1; then
    kill "$api_pid" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

cd "$project_dir"

echo "Starting API on :${api_port}"
PORT="$api_port" pnpm --filter @specora/api dev &
api_pid="$!"

echo "Starting web on :${web_port}"
(
  cd "$project_dir/apps/web"
  NEXT_PUBLIC_API_URL="$api_url" node ../../node_modules/next/dist/bin/next dev -p "$web_port"
) &
web_pid="$!"

echo "Stable dev stack started"
echo "API: http://localhost:${api_port}"
echo "Web: http://localhost:${web_port}"
echo "GraphQL: ${api_url}"

wait -n "$api_pid" "$web_pid"
