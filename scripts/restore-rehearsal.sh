#!/usr/bin/env bash
set -euo pipefail

MODE="plan"
ARTIFACT_DIR="${RESTORE_REHEARSAL_DIR:-tmp/restore-rehearsal}"
POSTGRES_SERVICE="${POSTGRES_SERVICE:-postgres}"
NEO4J_SERVICE="${NEO4J_SERVICE:-neo4j}"
POSTGRES_USER="${POSTGRES_USER:-specora}"
POSTGRES_DB="${POSTGRES_DB:-specora}"
RESTORE_DB="${RESTORE_REHEARSAL_DB:-specora_restore_rehearsal}"
NEO4J_USER="${NEO4J_USER:-neo4j}"
NEO4J_PASSWORD="${NEO4J_PASSWORD:-specora123}"
UPLOAD_DIR="${UPLOAD_DIR:-uploads}"

for arg in "$@"; do
  case "$arg" in
    --)
      ;;
    --execute)
      MODE="execute"
      ;;
    --plan)
      MODE="plan"
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Usage: pnpm restore:rehearsal [--plan|--execute]" >&2
      exit 2
      ;;
  esac
done

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
run_dir="${ARTIFACT_DIR}/${timestamp}"
report="${run_dir}/report.json"
mkdir -p "$run_dir"

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

write_report() {
  local status="$1"
  local detail="$2"
  cat > "$report" <<JSON
{
  "status": "$(json_escape "$status")",
  "mode": "$(json_escape "$MODE")",
  "generatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "artifactDir": "$(json_escape "$run_dir")",
  "postgres": {
    "service": "$(json_escape "$POSTGRES_SERVICE")",
    "sourceDatabase": "$(json_escape "$POSTGRES_DB")",
    "restoreDatabase": "$(json_escape "$RESTORE_DB")"
  },
  "neo4j": {
    "service": "$(json_escape "$NEO4J_SERVICE")",
    "database": "neo4j"
  },
  "uploads": {
    "path": "$(json_escape "$UPLOAD_DIR")"
  },
  "detail": "$(json_escape "$detail")"
}
JSON
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    write_report "failed" "Missing required command: $1"
    exit 1
  fi
}

run() {
  echo "+ $*"
  "$@"
}

require_command docker
require_command pnpm

if [[ "$MODE" == "plan" ]]; then
  cat <<EOF
Restore rehearsal plan

Artifacts: $run_dir

Execute mode will:
- create a PostgreSQL custom dump from $POSTGRES_SERVICE/$POSTGRES_DB
- restore it into temporary database $RESTORE_DB
- run migration status against the current application database
- verify Neo4j connectivity and graph counts
- record upload directory presence and file count
- write a JSON report

It will not overwrite $POSTGRES_DB or load over the active Neo4j database.

Run:
  pnpm restore:rehearsal -- --execute
EOF
  write_report "planned" "Plan generated; no restore commands executed"
  exit 0
fi

dump_file="${run_dir}/postgres.dump"
uploads_count="0"

run docker compose ps "$POSTGRES_SERVICE"
run docker compose ps "$NEO4J_SERVICE"

run docker compose exec -T "$POSTGRES_SERVICE" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --file="/tmp/${timestamp}-postgres.dump"
run docker compose cp "${POSTGRES_SERVICE}:/tmp/${timestamp}-postgres.dump" "$dump_file"
run docker compose exec -T "$POSTGRES_SERVICE" dropdb -U "$POSTGRES_USER" --if-exists "$RESTORE_DB"
run docker compose exec -T "$POSTGRES_SERVICE" createdb -U "$POSTGRES_USER" "$RESTORE_DB"
run docker compose cp "$dump_file" "${POSTGRES_SERVICE}:/tmp/${timestamp}-restore.dump"
run docker compose exec -T "$POSTGRES_SERVICE" pg_restore -U "$POSTGRES_USER" -d "$RESTORE_DB" "/tmp/${timestamp}-restore.dump"
run docker compose exec -T "$POSTGRES_SERVICE" psql -U "$POSTGRES_USER" -d "$RESTORE_DB" -At -c "SELECT 'users', count(*) FROM users UNION ALL SELECT 'app_permissions', count(*) FROM app_permissions;" > "${run_dir}/postgres-restore-counts.tsv"
run docker compose exec -T "$POSTGRES_SERVICE" dropdb -U "$POSTGRES_USER" --if-exists "$RESTORE_DB"

run pnpm migrate:status > "${run_dir}/migrate-status.txt"

run docker compose exec -T "$NEO4J_SERVICE" cypher-shell -u "$NEO4J_USER" -p "$NEO4J_PASSWORD" "MATCH (n:ConfigurationItem) RETURN count(n) AS ciCount" > "${run_dir}/neo4j-ci-count.txt"
run docker compose exec -T "$NEO4J_SERVICE" cypher-shell -u "$NEO4J_USER" -p "$NEO4J_PASSWORD" "MATCH (:ConfigurationItem)-[r]->(:ConfigurationItem) RETURN count(r) AS relCount" > "${run_dir}/neo4j-relationship-count.txt"

if [[ -d "$UPLOAD_DIR" ]]; then
  uploads_count="$(find "$UPLOAD_DIR" -type f | wc -l | tr -d ' ')"
fi
printf 'upload_files\t%s\n' "$uploads_count" > "${run_dir}/uploads-count.tsv"

write_report "passed" "PostgreSQL temporary restore, migration status, Neo4j counts, and upload checks completed"
echo "Restore rehearsal report: $report"
