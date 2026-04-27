# Backup and Restore Guide

**Status:** Operational guide for current data layout
**Last updated:** 2026-04-26

Specora stores critical state in both PostgreSQL and Neo4j. A usable backup must capture both stores from a consistent point in time, plus any file-backed discovery uploads if `UPLOAD_DIR` is used.

## Backup Scope

Back up these data sets:

| Data set | System | Why it matters |
| --- | --- | --- |
| CMDB graph | Neo4j | Configuration Items and graph relationships |
| Operational records | PostgreSQL | Users, RBAC, apps, audit, ITSM/ITAM/DCIM/discovery state |
| Discovery uploads | Filesystem/object storage | Source files for ingestion and reprocessing |
| Runtime configuration | Secret manager/deployment config | Connection strings, JWT secret, AI routing, Redis, worker settings |

Do not treat demo seed scripts as backup. They recreate a demo narrative, not a production tenant state.

## Consistency Model

Specora currently does not have a cross-database transaction manager between PostgreSQL and Neo4j. Restore consistency depends on taking backups close together and treating the pair as one recovery point.

Recommended production posture:

1. Put the platform in maintenance mode or pause write traffic.
2. Stop or pause background workers and scheduled Discovery jobs.
3. Back up PostgreSQL.
4. Back up Neo4j.
5. Back up `UPLOAD_DIR` or object storage.
6. Resume workers and traffic.

For low-RPO production deployments, use managed backup tooling with point-in-time recovery for PostgreSQL and Neo4j-native backup tooling. Then document the timestamp pair used for recovery.

## PostgreSQL Backup

Local Docker example:

```bash
mkdir -p backups
docker compose exec -T postgres pg_dump -U specora -d specora --format=custom > backups/specora-postgres.dump
```

Plain SQL example:

```bash
docker compose exec -T postgres pg_dump -U specora -d specora > backups/specora-postgres.sql
```

Production notes:

- Prefer custom format for selective restore and compression.
- Enable managed point-in-time recovery where available.
- Back up before applying migrations.
- Keep backup encryption and retention outside the repo.

## PostgreSQL Restore

Restore custom-format dump into an empty database:

```bash
docker compose exec -T postgres dropdb -U specora specora
docker compose exec -T postgres createdb -U specora specora
docker compose exec -T postgres pg_restore -U specora -d specora --clean --if-exists < backups/specora-postgres.dump
```

Restore plain SQL:

```bash
docker compose exec -T postgres psql -U specora -d specora < backups/specora-postgres.sql
```

After restore, verify:

```bash
docker compose exec postgres psql -U specora -d specora -c "SELECT count(*) FROM users;"
docker compose exec postgres psql -U specora -d specora -c "SELECT count(*) FROM app_permissions;"
docker compose exec postgres psql -U specora -d specora -c "SELECT count(*) FROM app_installations;"
pnpm migrate:status
```

If the restored database predates the migration runner and has no `schema_migrations` table, inspect the schema and use `pnpm migrate:baseline` once before normal deployments. Do not replay historical SQL files over a restored production database unless the migration status explicitly shows them as pending and they are known to be safe.

## Neo4j Backup

For the local Community Edition container, the most portable development backup is a dump taken while Neo4j is stopped or quiesced.

Stop write traffic first. Then:

```bash
docker compose stop api worker web
docker compose exec neo4j neo4j-admin database dump neo4j --to-path=/data/backups
docker compose cp neo4j:/data/backups/neo4j.dump backups/neo4j.dump
docker compose start api worker web
```

If the target Neo4j version requires the database to be offline for dump, stop Neo4j after stopping app traffic and run the dump with the appropriate container command for that image/version.

Production notes:

- Neo4j Community local dumps are not a substitute for enterprise/managed online backup.
- Evaluate Neo4j Enterprise or managed Neo4j backup tooling for production.
- Keep graph backups paired with PostgreSQL backups by timestamp.

## Neo4j Restore

For a local restore into an empty Neo4j volume:

```bash
docker compose stop api worker web neo4j
docker compose up -d neo4j
docker compose cp backups/neo4j.dump neo4j:/tmp/neo4j.dump
docker compose exec neo4j neo4j-admin database load neo4j --from-path=/tmp --overwrite-destination=true
docker compose restart neo4j
docker compose start api worker web
```

Verify graph counts:

```bash
docker compose exec neo4j cypher-shell -u neo4j -p specora123 "MATCH (n:ConfigurationItem) RETURN count(n) AS ciCount"
docker compose exec neo4j cypher-shell -u neo4j -p specora123 "MATCH ()-[r]->() RETURN count(r) AS relCount"
```

If restore fails because Neo4j changed command syntax, use the exact `neo4j-admin database dump/load` syntax for the deployed Neo4j version.

## Discovery Uploads

The API writes discovery uploads to `UPLOAD_DIR`, default `./uploads`. If this directory is local filesystem storage, back it up with the same recovery point:

```bash
tar -czf backups/specora-uploads.tgz uploads
```

Restore:

```bash
tar -xzf backups/specora-uploads.tgz
```

Production recommendation: store uploads in durable object storage and back up object metadata with the operational database.

## Configuration Restore

Configuration is not fully captured in the databases. Restore these from deployment/secret management:

- `JWT_SECRET`
- database credentials
- Neo4j credentials
- Provara/OpenAI keys and model routing variables
- Redis URL
- worker gRPC settings
- upload storage path or object storage settings

Changing `JWT_SECRET` invalidates existing sessions. That can be acceptable during disaster recovery, but it should be intentional.

## Restore Order

Recommended full restore order:

1. Restore PostgreSQL.
2. Restore Neo4j.
3. Restore discovery uploads.
4. Restore deployment configuration/secrets.
5. Start Neo4j and PostgreSQL.
6. Start worker.
7. Start API.
8. Start web.
9. Run smoke checks.

Smoke checks:

```bash
curl -I http://localhost:4000/health
curl -I http://localhost:3000
pnpm migrate:status
pnpm validate:seed
```

For production data, `pnpm validate:seed` may be too demo-specific. Use it for demo stacks; use production-specific checks for real deployments.

## Restore Rehearsal Command

Specora includes a local restore rehearsal command that defaults to non-destructive planning mode:

```bash
pnpm restore:rehearsal
```

Execute mode performs a bounded local rehearsal:

```bash
pnpm restore:rehearsal -- --execute
```

The execute path creates a PostgreSQL custom dump, restores it into a temporary database named `specora_restore_rehearsal`, runs migration status, verifies Neo4j graph counts, checks upload directory presence, writes artifacts under `tmp/restore-rehearsal/`, and drops the temporary restore database. It does not overwrite the active `specora` PostgreSQL database or load over the active Neo4j database.

Useful environment overrides:

| Variable | Default |
| --- | --- |
| `RESTORE_REHEARSAL_DIR` | `tmp/restore-rehearsal` |
| `RESTORE_REHEARSAL_DB` | `specora_restore_rehearsal` |
| `POSTGRES_SERVICE` | `postgres` |
| `POSTGRES_USER` | `specora` |
| `POSTGRES_DB` | `specora` |
| `NEO4J_SERVICE` | `neo4j` |
| `NEO4J_USER` | `neo4j` |
| `NEO4J_PASSWORD` | `specora123` |
| `UPLOAD_DIR` | `uploads` |

## Post-Restore Validation

Validate PostgreSQL:

```bash
docker compose exec postgres psql -U specora -d specora -c "SELECT count(*) FROM users;"
docker compose exec postgres psql -U specora -d specora -c "SELECT count(*) FROM app_provisioning_jobs;"
docker compose exec postgres psql -U specora -d specora -c "SELECT count(*) FROM incidents;"
```

Validate Neo4j:

```bash
docker compose exec neo4j cypher-shell -u neo4j -p specora123 "MATCH (n:ConfigurationItem) RETURN count(n)"
docker compose exec neo4j cypher-shell -u neo4j -p specora123 "MATCH (:ConfigurationItem)-[r]->(:ConfigurationItem) RETURN count(r)"
```

Validate application behavior:

```bash
pnpm --filter @specora/web e2e:with-servers
```

For a production restore drill, run only tests pointed at disposable restored data. Do not run demo E2E against a live production tenant.

## Backup Frequency

Suggested starting point:

| Environment | PostgreSQL | Neo4j | Uploads |
| --- | --- | --- | --- |
| Local demo | Manual before destructive testing | Manual before destructive testing | Manual if uploads matter |
| Shared demo | Daily plus before demos | Daily plus before demos | Daily |
| Production | PITR plus scheduled snapshots | Native/managed backup plus snapshots | Object-store retention/versioning |

The correct RPO/RTO depends on tenant expectations and operational maturity.

## Roadmap Improvements

Backup/restore should become more automated:

- Add a platform maintenance mode.
- Add worker pause/resume controls.
- Add backup metadata recording in PostgreSQL.
- Add a restore validation command separate from demo seed validation.
- Add production runbooks for managed Postgres and managed Neo4j.
