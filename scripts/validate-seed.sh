#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

fail() {
  printf 'Seed validation failed: %s\n' "$1" >&2
  exit 1
}

pg_scalar() {
  docker compose exec -T postgres psql -U "${POSTGRES_USER:-specora}" -d "${POSTGRES_DB:-specora}" -t -A -c "$1" | tr -d '[:space:]'
}

neo4j_scalar() {
  docker compose exec -T neo4j cypher-shell -u "${NEO4J_USER:-neo4j}" -p "${NEO4J_PASSWORD:-specora123}" "$1" \
    | awk '/^[0-9]+$/ { print $1; exit }'
}

printf 'Validating Specora seed data...\n'

docker compose ps postgres >/dev/null || fail "Postgres service is not available"
docker compose ps neo4j >/dev/null || fail "Neo4j service is not available"

ci_count="$(neo4j_scalar 'MATCH (n:ConfigurationItem) RETURN count(n);')"
relationship_count="$(neo4j_scalar 'MATCH (:ConfigurationItem)-[r]->(:ConfigurationItem) RETURN count(r);')"
user_count="$(pg_scalar 'SELECT COUNT(*) FROM users;')"
marketplace_count="$(pg_scalar 'SELECT COUNT(*) FROM marketplace_apps;')"
dcim_floorplan_count="$(pg_scalar 'SELECT COUNT(*) FROM dcim_floorplans;')"
dcim_connection_count="$(pg_scalar 'SELECT COUNT(*) FROM dcim_floorplan_connections;')"
incident_count="$(pg_scalar 'SELECT COUNT(*) FROM incidents;')"
knowledge_count="$(pg_scalar 'SELECT COUNT(*) FROM knowledge_items;')"
asset_count="$(pg_scalar 'SELECT COUNT(*) FROM asset_records;')"

[[ "${ci_count:-0}" -ge 5000 ]] || fail "expected at least 5000 ConfigurationItem nodes, found ${ci_count:-0}"
[[ "${relationship_count:-0}" -ge 13000 ]] || fail "expected at least 13000 CI relationships, found ${relationship_count:-0}"
[[ "${user_count:-0}" -ge 1 ]] || fail "expected seeded users, found ${user_count:-0}"
[[ "${marketplace_count:-0}" -ge 1 ]] || fail "expected app registry rows, found ${marketplace_count:-0}"
[[ "${dcim_floorplan_count:-0}" -ge 1 ]] || fail "expected DCIM floorplans, found ${dcim_floorplan_count:-0}"
[[ "${dcim_connection_count:-0}" -ge 3 ]] || fail "expected seeded DCIM floorplan connections, found ${dcim_connection_count:-0}"
[[ "${incident_count:-0}" -ge 1 ]] || fail "expected seeded incidents, found ${incident_count:-0}"
[[ "${knowledge_count:-0}" -ge 1 ]] || fail "expected seeded knowledge items, found ${knowledge_count:-0}"
[[ "${asset_count:-0}" -ge 1 ]] || fail "expected seeded assets, found ${asset_count:-0}"

cat <<REPORT
Seed validation passed.
Neo4j:
  ConfigurationItems: ${ci_count}
  CI relationships: ${relationship_count}
Postgres:
  Users: ${user_count}
  Marketplace apps: ${marketplace_count}
  DCIM floorplans: ${dcim_floorplan_count}
  DCIM floorplan connections: ${dcim_connection_count}
  Incidents: ${incident_count}
  Knowledge items: ${knowledge_count}
  Asset records: ${asset_count}
REPORT
