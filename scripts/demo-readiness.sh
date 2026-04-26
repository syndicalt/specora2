#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

printf 'Running Specora demo-readiness checks...\n'

printf '\n[1/6] Docker services\n'
docker compose ps

printf '\n[2/6] Seed validation\n'
bash scripts/validate-seed.sh

printf '\n[3/6] Database tests\n'
pnpm --filter @specora/db test

printf '\n[4/6] API tests\n'
pnpm --filter @specora/api test

printf '\n[5/6] Web typecheck\n'
pnpm --filter @specora/web exec tsc --noEmit

printf '\n[6/6] Browser smoke tests\n'
if [[ "${SKIP_E2E:-0}" == "1" ]]; then
  printf 'Skipping E2E because SKIP_E2E=1.\n'
elif [[ "${E2E_START_SERVERS:-0}" == "1" ]]; then
  pnpm --filter @specora/web e2e:with-servers
else
  pnpm --filter @specora/web e2e
fi

printf '\nDemo-readiness checks passed.\n'
