#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

export E2E_BASE_URL="${E2E_BASE_URL:-https://specora-dev.specora.org}"
export E2E_API_URL="${E2E_API_URL:-https://gateway-dev.specora.org}"
export E2E_USER_EMAIL="${E2E_USER_EMAIL:-admin@specora.org}"

if [[ -z "${E2E_USER_PASSWORD:-}" ]]; then
  printf 'E2E_USER_PASSWORD is required for public demo validation.\n' >&2
  exit 1
fi

printf 'Running public demo smoke.\n'
printf 'Web URL: %s\n' "$E2E_BASE_URL"
printf 'API URL: %s\n' "$E2E_API_URL"
printf 'User: %s\n' "$E2E_USER_EMAIL"

pnpm --filter @specora/web exec playwright test e2e/public-demo.spec.ts
