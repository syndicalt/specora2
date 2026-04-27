#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

mode="${RELEASE_CHECK_MODE:-fast}"
started_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
step=0

if [[ "$mode" != "fast" && "$mode" != "full" ]]; then
  printf 'Invalid RELEASE_CHECK_MODE=%s. Use fast or full.\n' "$mode" >&2
  exit 1
fi

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

clean_artifacts() {
  rm -rf apps/web/test-results apps/web/e2e/.auth
  rm -rf apps/web/tsconfig.tsbuildinfo apps/api/coverage apps/web/coverage packages/db/coverage
  if [[ "${CLEAN_NEXT:-0}" == "1" || "$mode" == "full" ]]; then
    rm -rf apps/web/.next
  fi
}

assert_clean_tree() {
  if [[ "${ALLOW_DIRTY:-1}" == "1" ]]; then
    printf 'Dirty worktree allowed. Set ALLOW_DIRTY=0 to enforce a release-clean tree.\n'
    return
  fi
  if [[ -n "$(git status --short)" ]]; then
    git status --short
    printf 'Release check requires a clean worktree when ALLOW_DIRTY=0.\n' >&2
    exit 1
  fi
}

printf 'Running Specora release-readiness checks.\n'
printf 'Mode: %s\n' "$mode"
printf 'Started: %s\n' "$started_at"

run_step "Artifact cleanup" clean_artifacts
run_step "Git worktree policy" assert_clean_tree
run_step "Migration status" pnpm migrate:status
run_step "Migration dry-run" pnpm migrate:dry-run
run_step "API typecheck" pnpm --filter @specora/api exec tsc --noEmit
run_step "Web typecheck" pnpm --filter @specora/web exec tsc --noEmit

if [[ "${SKIP_DB_TESTS:-0}" == "1" ]]; then
  skip_step "Database tests" "SKIP_DB_TESTS=1"
else
  run_step "Database tests" pnpm --filter @specora/db test
fi

run_step "API tests" pnpm --filter @specora/api test

if [[ "$mode" == "full" || "${RUN_WEB_TESTS:-0}" == "1" ]]; then
  run_step "Web unit tests" pnpm --filter @specora/web test
else
  skip_step "Web unit tests" "fast mode; set RUN_WEB_TESTS=1 or RELEASE_CHECK_MODE=full"
fi

if [[ "$mode" == "full" || "${RUN_BUILDS:-0}" == "1" ]]; then
  run_step "API build" pnpm --filter @specora/api build
  run_step "Web build" pnpm --filter @specora/web build
else
  skip_step "Production builds" "fast mode; set RUN_BUILDS=1 or RELEASE_CHECK_MODE=full"
fi

if [[ "$mode" == "full" || "${RUN_SEED_VALIDATION:-0}" == "1" ]]; then
  run_step "Seed validation" bash scripts/validate-seed.sh
else
  skip_step "Seed validation" "fast mode; set RUN_SEED_VALIDATION=1 or RELEASE_CHECK_MODE=full"
fi

if [[ "$mode" == "full" || "${RUN_E2E:-0}" == "1" ]]; then
  if [[ "${E2E_START_SERVERS:-0}" == "1" ]]; then
    run_step "Browser E2E with managed servers" pnpm --filter @specora/web e2e:with-servers
  else
    run_step "Browser E2E" pnpm --filter @specora/web e2e
  fi
else
  skip_step "Browser E2E" "fast mode; set RUN_E2E=1 or RELEASE_CHECK_MODE=full"
fi

printf '\nRelease-readiness checks passed.\n'
