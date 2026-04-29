#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

web_url="${SPECORA_WEB_URL:-https://specora-dev.specora.org}"
api_url="${SPECORA_API_URL:-${NEXT_PUBLIC_API_URL:-$web_url}}"
api_url="${api_url%/graphql}"
api_url="${api_url%/}"
web_url="${web_url%/}"

step=0

run_step() {
  step=$((step + 1))
  printf '\n[%s] %s\n' "$step" "$1"
  shift
  "$@"
}

skip_step() {
  step=$((step + 1))
  printf '\n[%s] %s\n' "$step" "$1"
  printf 'Skipped: %s\n' "$2"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  }
}

check_url() {
  local label="$1"
  local url="$2"
  local code
  code="$(curl -fsSIL -o /dev/null -w "%{http_code}" "$url")"
  case "$code" in
    200|204|301|302|307|308)
      printf '%s OK (%s): %s\n' "$label" "$code" "$url"
      ;;
    *)
      printf '%s failed with HTTP %s: %s\n' "$label" "$code" "$url" >&2
      exit 1
      ;;
  esac
}

check_json_endpoint() {
  local label="$1"
  local url="$2"
  local response
  response="$(curl -fsS "$url")"
  printf '%s OK: %s\n' "$label" "$url"
  printf '%s\n' "$response" | node -e "JSON.parse(require('fs').readFileSync(0, 'utf8'))" >/dev/null
}

check_graphql() {
  local response
  response="$(curl -fsS \
    -H 'Content-Type: application/json' \
    --data '{"query":"query ReleaseCheck { __typename }"}' \
    "$api_url/graphql")"
  printf '%s\n' "$response" | node -e "const body = JSON.parse(require('fs').readFileSync(0, 'utf8')); if (!body.data && !body.errors) process.exit(1);" >/dev/null
  printf 'GraphQL OK: %s/graphql\n' "$api_url"
}

check_admin_login_and_apps() {
  if [[ -z "${SPECORA_ADMIN_EMAIL:-}" || -z "${SPECORA_ADMIN_PASSWORD:-}" ]]; then
    skip_step "Admin login and app registry" "set SPECORA_ADMIN_EMAIL and SPECORA_ADMIN_PASSWORD"
    return
  fi

  local login_response token apps_response
  login_response="$(curl -fsS \
    -H 'Content-Type: application/json' \
    --data "{\"email\":\"${SPECORA_ADMIN_EMAIL}\",\"password\":\"${SPECORA_ADMIN_PASSWORD}\"}" \
    "$api_url/api/login")"
  token="$(printf '%s\n' "$login_response" | node -e "const body = JSON.parse(require('fs').readFileSync(0, 'utf8')); if (!body.token) process.exit(1); process.stdout.write(body.token);")"
  printf 'Admin login OK for %s\n' "$SPECORA_ADMIN_EMAIL"

  apps_response="$(curl -fsS -H "Authorization: Bearer $token" "$api_url/api/apps/registry")"
  printf '%s\n' "$apps_response" | node -e "
    const body = JSON.parse(require('fs').readFileSync(0, 'utf8'));
    const ids = new Set((body.apps || []).map((app) => app.id));
    for (const id of ['admin-console', 'customer-portal', 'settings', 'arc']) {
      if (!ids.has(id)) {
        console.error('Missing expected app: ' + id);
        process.exit(1);
      }
    }
  " >/dev/null
  printf 'Authenticated app registry OK\n'
}

check_migration_status() {
  if [[ -z "${DATABASE_URL:-}" ]]; then
    skip_step "Migration status" "DATABASE_URL is not set"
    return
  fi
  run_step "Migration status" pnpm migrate:status
}

check_screenshots() {
  local count
  count="$(find docs/screenshots -maxdepth 1 -type f -name '*.png' | wc -l | tr -d ' ')"
  if [[ "$count" -lt 5 ]]; then
    printf 'Expected at least 5 documentation screenshots, found %s.\n' "$count" >&2
    exit 1
  fi
  printf 'Screenshot catalog OK (%s PNG files)\n' "$count"
}

printf 'Running Specora Railway release checklist.\n'
printf 'Web URL: %s\n' "$web_url"
printf 'API URL: %s\n' "$api_url"

require_command curl
require_command node

run_step "Web login page" check_url "Web login" "$web_url/login"
run_step "Web app shell" check_url "Web root" "$web_url/"
run_step "API health" check_json_endpoint "API health" "$api_url/healthz"
run_step "API readiness" check_json_endpoint "API readiness" "$api_url/ready"
run_step "GraphQL endpoint" check_graphql
check_admin_login_and_apps
check_migration_status
run_step "Screenshot catalog" check_screenshots

printf '\nRailway release checklist passed.\n'
