import { Pool } from "pg";

export type EnterpriseSeedProfile = "smoke" | "standard" | "enterprise";

export type EnterpriseSeedConfig = {
  profile: EnterpriseSeedProfile;
  users: number;
  apps: number;
  coreRecords: number;
  eventsPerRecord: number;
  discoveryRowsPerJob: number;
  dcimSites: number;
  dcimRoomsPerSite: number;
  dcimRacksPerRoom: number;
  catalogItems: number;
};

export const SEEDED_TABLES = [
  "app_installations",
  "app_permissions",
  "app_provisioning_jobs",
  "asset_contracts",
  "asset_evidence",
  "asset_exceptions",
  "asset_reconciliation_runs",
  "asset_records",
  "asset_scan_events",
  "audit_log",
  "catalog_items",
  "catalog_request_events",
  "catalog_requests",
  "change_request_approvers",
  "change_request_cis",
  "change_request_comments",
  "change_request_risk_history",
  "change_requests",
  "chat_messages",
  "chat_sessions",
  "ci_class_attributes",
  "ci_classes",
  "dcim_assets",
  "dcim_events",
  "dcim_floorplan_connections",
  "dcim_floorplan_objects",
  "dcim_floorplans",
  "dcim_power_paths",
  "dcim_racks",
  "dcim_rooms",
  "dcim_sites",
  "discovery_jobs",
  "discovery_pipeline_schedules",
  "discovery_pipelines",
  "discovery_sources",
  "discovery_staged_records",
  "discovery_staged_relationships",
  "events",
  "incident_actions",
  "incident_cis",
  "incident_events",
  "incident_postmortems",
  "incident_roles",
  "incidents",
  "jobs",
  "knowledge_events",
  "knowledge_feedback",
  "knowledge_gaps",
  "knowledge_items",
  "knowledge_links",
  "marketplace_apps",
  "number_sequences",
  "package_entitlements",
  "prevention_actions",
  "prevention_events",
  "prevention_evidence",
  "prevention_records",
  "reconciliation_logs",
  "reconciliation_rules",
  "record_numbers",
  "saved_views",
  "software_entitlements",
  "software_usage",
  "support_channels",
  "support_handoffs",
  "system_properties",
  "users",
] as const;

const profiles: Record<EnterpriseSeedProfile, EnterpriseSeedConfig> = {
  smoke: {
    profile: "smoke",
    users: 25,
    apps: 12,
    coreRecords: 100,
    eventsPerRecord: 2,
    discoveryRowsPerJob: 10,
    dcimSites: 2,
    dcimRoomsPerSite: 2,
    dcimRacksPerRoom: 8,
    catalogItems: 20,
  },
  standard: {
    profile: "standard",
    users: 500,
    apps: 75,
    coreRecords: 10_000,
    eventsPerRecord: 4,
    discoveryRowsPerJob: 25,
    dcimSites: 12,
    dcimRoomsPerSite: 4,
    dcimRacksPerRoom: 40,
    catalogItems: 250,
  },
  enterprise: {
    profile: "enterprise",
    users: 5_000,
    apps: 250,
    coreRecords: 250_000,
    eventsPerRecord: 6,
    discoveryRowsPerJob: 50,
    dcimSites: 40,
    dcimRoomsPerSite: 8,
    dcimRacksPerRoom: 80,
    catalogItems: 1_000,
  },
};

export function buildEnterpriseSeedConfig(env: NodeJS.ProcessEnv = process.env): EnterpriseSeedConfig {
  const profile = (env.ENTERPRISE_SEED_PROFILE || "standard") as EnterpriseSeedProfile;
  const base = profiles[profile] || profiles.standard;
  return {
    ...base,
    users: readInt(env.ENTERPRISE_SEED_USERS, base.users),
    apps: readInt(env.ENTERPRISE_SEED_APPS, base.apps),
    coreRecords: readInt(env.ENTERPRISE_SEED_CORE_RECORDS, base.coreRecords),
    eventsPerRecord: readInt(env.ENTERPRISE_SEED_EVENTS_PER_RECORD, base.eventsPerRecord),
    discoveryRowsPerJob: readInt(env.ENTERPRISE_SEED_DISCOVERY_ROWS_PER_JOB, base.discoveryRowsPerJob),
    dcimSites: readInt(env.ENTERPRISE_SEED_DCIM_SITES, base.dcimSites),
    dcimRoomsPerSite: readInt(env.ENTERPRISE_SEED_DCIM_ROOMS_PER_SITE, base.dcimRoomsPerSite),
    dcimRacksPerRoom: readInt(env.ENTERPRISE_SEED_DCIM_RACKS_PER_ROOM, base.dcimRacksPerRoom),
    catalogItems: readInt(env.ENTERPRISE_SEED_CATALOG_ITEMS, base.catalogItems),
  };
}

function readInt(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function run(client: Pool, name: string, sql: string, params: unknown[] = []) {
  const start = Date.now();
  await client.query(bindNumericParams(sql, params));
  console.log(`${name} seeded in ${Date.now() - start}ms`);
}

export function bindNumericParams(sql: string, params: unknown[]) {
  return sql.replace(/\$(\d+)(?=::)/g, (_match, index: string) => {
    const value = params[Number(index) - 1];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
      throw new Error(`Enterprise seed parameter $${index} must be a safe non-negative integer`);
    }
    return String(value);
  });
}

const setupSql = `
CREATE OR REPLACE FUNCTION specora_stress_uuid(namespace TEXT, value BIGINT)
RETURNS UUID
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT (
    substr(md5(namespace || ':' || value::text), 1, 8) || '-' ||
    substr(md5(namespace || ':' || value::text), 9, 4) || '-' ||
    substr(md5(namespace || ':' || value::text), 13, 4) || '-' ||
    substr(md5(namespace || ':' || value::text), 17, 4) || '-' ||
    substr(md5(namespace || ':' || value::text), 21, 12)
  )::uuid;
$$;
`;

export async function seedEnterprisePostgres(config = buildEnterpriseSeedConfig()) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || "postgresql://specora:specora123@localhost:5432/specora",
  });

  try {
    console.log(`Enterprise seed profile=${config.profile}`);
    await run(pool, "helpers", setupSql);
    await run(pool, "users", usersSql, [config.users]);
    await run(pool, "platform metadata", platformSql, [config.apps, config.users]);
    await run(pool, "ci class registry", ciClassSql, [Math.max(20, Math.floor(config.apps / 2))]);
    await run(pool, "discovery", discoverySql, [config.coreRecords, config.users, config.discoveryRowsPerJob]);
    await run(pool, "incidents", incidentSql, [config.coreRecords, config.users, config.eventsPerRecord]);
    await run(pool, "changes", changeSql, [config.coreRecords, config.users, config.eventsPerRecord]);
    await run(pool, "knowledge", knowledgeSql, [config.coreRecords, config.users, config.eventsPerRecord]);
    await run(pool, "prevention", preventionSql, [config.coreRecords, config.users, config.eventsPerRecord]);
    await run(pool, "assets", assetSql, [config.coreRecords, config.users]);
    await run(pool, "dcim", dcimSql, [config.dcimSites, config.dcimRoomsPerSite, config.dcimRacksPerRoom, config.coreRecords]);
    await run(pool, "catalog and support", catalogSql, [config.catalogItems, config.coreRecords, config.users, config.eventsPerRecord]);
    await run(pool, "chat, audit, jobs, events", activitySql, [config.coreRecords, config.users, config.eventsPerRecord]);
    await run(pool, "record numbers", recordNumbersSql, [config.coreRecords]);

    const coverage = await pool.query(
      `SELECT table_name
       FROM unnest($1::text[]) AS seeded(table_name)
       WHERE NOT EXISTS (
         SELECT 1
         FROM information_schema.tables t
         WHERE t.table_schema = 'public'
           AND t.table_type = 'BASE TABLE'
           AND t.table_name = seeded.table_name
       )
       ORDER BY table_name`,
      [[...SEEDED_TABLES]]
    );
    if (coverage.rows.length) {
      throw new Error(`Enterprise seed references missing tables: ${coverage.rows.map((row) => row.table_name).join(", ")}`);
    }

    const counts = await pool.query(
      `SELECT relname AS table_name, n_live_tup::bigint AS estimated_rows
       FROM pg_stat_user_tables
       WHERE schemaname = 'public'
         AND relname = ANY($1::text[])
       ORDER BY relname`,
      [[...SEEDED_TABLES]]
    );
    console.table(counts.rows.map((row) => ({ table: row.table_name, estimatedRows: row.estimated_rows })));
  } finally {
    await pool.end();
  }
}

const usersSql = `
INSERT INTO users (id, email, name, password_hash, role, preferences, created_at, updated_at)
SELECT
  specora_stress_uuid('user', gs),
  'stress-' || gs || '@specora.example',
  'Stress User ' || gs,
  '$2b$10$UcP3YzFw1vKY32IG7Iov1./u9zaYsZShLVNbM81gAqiQvz7QRXjqO',
  (ARRAY['viewer','operator','change_manager','incident_manager','admin','security_admin'])[1 + (gs % 6)],
  jsonb_build_object('persona', 'stress', 'region', (ARRAY['NA','EMEA','APAC','LATAM'])[1 + (gs % 4)]),
  NOW() - (gs || ' minutes')::interval,
  NOW()
FROM generate_series(1, $1::int) AS gs
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  name = EXCLUDED.name,
  role = EXCLUDED.role,
  preferences = EXCLUDED.preferences,
  updated_at = NOW();
`;

const platformSql = `
INSERT INTO marketplace_apps (id, name, description, url, icon, version, permissions, author, status, package_id, package_name, premium, entitlement_mode, bundled_with_platform)
SELECT
  'stress-app-' || gs,
  'Stress App ' || gs,
  'Synthetic enterprise-scale package used for performance testing.',
  'https://packages.specora.example/stress-app-' || gs || '/index.js',
  (ARRAY['Boxes','ChartNoAxesCombined','Database','Network','Shield','Workflow'])[1 + (gs % 6)],
  '1.' || (gs % 20) || '.0',
  jsonb_build_array('read:stress-' || gs, 'write:stress-' || gs),
  'Specora Load Lab',
  (ARRAY['approved','pending','rejected'])[1 + (gs % 3)],
  'stress-package-' || (1 + (gs % 20)),
  'Stress Package ' || (1 + (gs % 20)),
  gs % 5 = 0,
  CASE WHEN gs % 5 = 0 THEN 'entitled' ELSE 'included' END,
  gs % 5 <> 0
FROM generate_series(1, $1::int) AS gs
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  status = EXCLUDED.status,
  package_id = EXCLUDED.package_id,
  premium = EXCLUDED.premium,
  updated_at = NOW();

INSERT INTO app_installations (app_id, status, installed_by, installed_at, metadata, updated_at)
SELECT
  'stress-app-' || gs,
  (ARRAY['installed','uninstalled','installing'])[1 + (gs % 3)],
  specora_stress_uuid('user', 1 + (gs % $2::int)),
  NOW() - (gs || ' hours')::interval,
  jsonb_build_object('stress', true, 'profile', 'enterprise'),
  NOW()
FROM generate_series(1, $1::int) AS gs
ON CONFLICT (app_id) DO UPDATE SET
  status = EXCLUDED.status,
  installed_by = EXCLUDED.installed_by,
  metadata = EXCLUDED.metadata,
  updated_at = NOW();

INSERT INTO app_provisioning_jobs (id, app_id, action, status, requested_by, message, metadata, created_at, updated_at, completed_at)
SELECT
  specora_stress_uuid('app_provisioning_job', gs),
  'stress-app-' || (1 + (gs % $1::int)),
  (ARRAY['install','uninstall','upgrade'])[1 + (gs % 3)],
  (ARRAY['queued','running','completed','failed'])[1 + (gs % 4)],
  specora_stress_uuid('user', 1 + (gs % $2::int)),
  'Synthetic provisioning job ' || gs,
  jsonb_build_object('durationMs', 50 + (gs % 5000), 'stress', true),
  NOW() - (gs || ' minutes')::interval,
  NOW(),
  CASE WHEN gs % 4 IN (2,3) THEN NOW() - ((gs % 60) || ' seconds')::interval ELSE NULL END
FROM generate_series(1, GREATEST($1::int * 4, 20)) AS gs
ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, updated_at = NOW();

INSERT INTO package_entitlements (id, package_id, tenant_id, status, source, starts_at, expires_at, metadata)
SELECT
  specora_stress_uuid('package_entitlement', gs),
  'stress-package-' || gs,
  'stress-tenant',
  (ARRAY['active','trial','expired','placeholder'])[1 + (gs % 4)],
  'stress-seed',
  NOW() - INTERVAL '30 days',
  NOW() + ((30 + gs) || ' days')::interval,
  jsonb_build_object('seatLimit', 100 + gs, 'stress', true)
FROM generate_series(1, 20) AS gs
ON CONFLICT (package_id, tenant_id) DO UPDATE SET status = EXCLUDED.status, metadata = EXCLUDED.metadata, updated_at = NOW();

INSERT INTO app_permissions (id, role, resource, action)
SELECT
  specora_stress_uuid('app_permission', gs),
  (ARRAY['viewer','operator','admin','security_admin','stress_role_' || (gs % 10)])[1 + (gs % 5)],
  'stress-resource-' || (gs % 50),
  (ARRAY['read','write','approve','operate','govern'])[1 + (gs % 5)]
FROM generate_series(1, GREATEST($1::int * 4, 100)) AS gs
ON CONFLICT (role, resource, action) DO NOTHING;

INSERT INTO system_properties (key, value, updated_at)
SELECT 'stress.property.' || gs, jsonb_build_object('value', gs, 'stress', true)::text, NOW()
FROM generate_series(1, 50) AS gs
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
`;

const ciClassSql = `
INSERT INTO ci_classes (id, name, display_name, description, parent_class, icon, color, is_system, created_by_app_id)
SELECT
  specora_stress_uuid('ci_class', gs),
  'StressClass' || gs,
  'Stress Class ' || gs,
  'Synthetic class used for registry scale testing.',
  NULL,
  'Box',
  '#38bdf8',
  false,
  'enterprise-seed'
FROM generate_series(1, $1::int) AS gs
ON CONFLICT (name) DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = NOW();

INSERT INTO ci_class_attributes (id, class_id, name, display_name, description, attr_type, is_mandatory, is_health_required, is_key_attribute, sort_order)
SELECT
  specora_stress_uuid('ci_class_attribute', (class_no * 100) + attr_no),
  specora_stress_uuid('ci_class', class_no),
  'stressAttribute' || attr_no,
  'Stress Attribute ' || attr_no,
  'Synthetic class attribute for table scale testing.',
  (ARRAY['string','number','boolean','date','json','reference'])[1 + (attr_no % 6)],
  attr_no % 5 = 0,
  attr_no % 3 = 0,
  attr_no = 1,
  attr_no
FROM generate_series(1, $1::int) AS class_no
CROSS JOIN generate_series(1, 8) AS attr_no
ON CONFLICT (class_id, name) DO UPDATE SET display_name = EXCLUDED.display_name;
`;

const discoverySql = `
INSERT INTO discovery_sources (id, name, type, config, created_at, updated_at, last_tested_at, last_status, credential_ref)
SELECT
  specora_stress_uuid('discovery_source', gs),
  'Stress Source ' || gs,
  (ARRAY['csv','api','database','cloud','edge'])[1 + (gs % 5)],
  jsonb_build_object('endpoint', 'stress-source-' || gs, 'batchSize', 1000),
  NOW() - (gs || ' days')::interval,
  NOW(),
  NOW() - ((gs % 48) || ' hours')::interval,
  (ARRAY['passed','failed','warning'])[1 + (gs % 3)],
  'credential:stress:' || gs
FROM generate_series(1, LEAST($1::int, 5000)) AS gs
ON CONFLICT (id) DO UPDATE SET last_status = EXCLUDED.last_status, updated_at = NOW();

INSERT INTO discovery_pipelines (id, name, description, status, definition, created_by, created_at, updated_at, number, version, published_definition, last_published_at, last_run_at)
SELECT
  specora_stress_uuid('discovery_pipeline', gs),
  'Stress Pipeline ' || gs,
  'Synthetic builder-linker pipeline for enterprise load testing.',
  (ARRAY['draft','published','retired'])[1 + (gs % 3)],
  jsonb_build_object('nodes', jsonb_build_array(jsonb_build_object('id','source','type','source'), jsonb_build_object('id','transform','type','transform')), 'edges', jsonb_build_array(jsonb_build_object('source','source','target','transform'))),
  specora_stress_uuid('user', 1 + (gs % $2::int)),
  NOW() - (gs || ' hours')::interval,
  NOW(),
  'DISCST' || lpad(gs::text, 8, '0'),
  1 + (gs % 10),
  jsonb_build_object('published', true, 'version', 1 + (gs % 10)),
  NOW() - ((gs % 90) || ' days')::interval,
  NOW() - ((gs % 24) || ' hours')::interval
FROM generate_series(1, LEAST($1::int, 10000)) AS gs
ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, updated_at = NOW();

INSERT INTO discovery_jobs (id, source_id, file_path, status, stats, created_at, updated_at, number, pipeline_id, pipeline_version, trigger_source)
SELECT
  specora_stress_uuid('discovery_job', gs),
  specora_stress_uuid('discovery_source', 1 + (gs % LEAST($1::int, 5000))),
  '/uploads/stress/source-' || gs || '.csv',
  (ARRAY['pending','running','completed','failed'])[1 + (gs % 4)],
  jsonb_build_object('created', gs % 200, 'updated', gs % 700, 'relationships', gs % 2000, 'issues', gs % 9),
  NOW() - (gs || ' minutes')::interval,
  NOW(),
  'DJOBST' || lpad(gs::text, 8, '0'),
  specora_stress_uuid('discovery_pipeline', 1 + (gs % LEAST($1::int, 10000))),
  1 + (gs % 10),
  (ARRAY['manual','schedule','api','edge'])[1 + (gs % 4)]
FROM generate_series(1, $1::int) AS gs
ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, stats = EXCLUDED.stats, updated_at = NOW();

INSERT INTO discovery_pipeline_schedules (pipeline_id, enabled, interval, next_run_at, last_run_at, last_discovery_job_id, last_status, updated_at)
SELECT
  specora_stress_uuid('discovery_pipeline', gs),
  gs % 4 <> 0,
  (ARRAY['hourly','daily','weekly','manual'])[1 + (gs % 4)],
  NOW() + ((gs % 1440) || ' minutes')::interval,
  NOW() - ((gs % 1440) || ' minutes')::interval,
  specora_stress_uuid('discovery_job', 1 + (gs % $1::int)),
  (ARRAY['completed','failed','running'])[1 + (gs % 3)],
  NOW()
FROM generate_series(1, LEAST($1::int, 10000)) AS gs
ON CONFLICT (pipeline_id) DO UPDATE SET enabled = EXCLUDED.enabled, next_run_at = EXCLUDED.next_run_at, last_status = EXCLUDED.last_status, updated_at = NOW();

INSERT INTO discovery_staged_records (id, discovery_job_id, row_number, action, target_class, ci_id, name, environment, attributes, match_keys, errors, warnings, status, committed_ci_id, created_at, updated_at)
SELECT
  specora_stress_uuid('discovery_staged_record', (job_no * 100000) + row_no),
  specora_stress_uuid('discovery_job', job_no),
  row_no,
  (ARRAY['create','update','skip'])[1 + (row_no % 3)],
  (ARRAY['Server','Database','Application','ApplicationService','NetworkGear'])[1 + (row_no % 5)],
  'stress-ci-' || job_no || '-' || row_no,
  'stress-node-' || job_no || '-' || row_no,
  (ARRAY['Production','Development','Test'])[1 + (row_no % 3)],
  jsonb_build_object('hostname', 'stress-' || job_no || '-' || row_no, 'ipAddress', '10.' || (job_no % 255) || '.' || (row_no % 255) || '.10'),
  jsonb_build_array('name','ipAddress'),
  CASE WHEN row_no % 97 = 0 THEN jsonb_build_array('missing required owner') ELSE '[]'::jsonb END,
  CASE WHEN row_no % 23 = 0 THEN jsonb_build_array('low confidence match') ELSE '[]'::jsonb END,
  (ARRAY['staged','approved','committed','rejected'])[1 + (row_no % 4)],
  CASE WHEN row_no % 4 = 2 THEN 'stress-ci-' || job_no || '-' || row_no ELSE NULL END,
  NOW() - (row_no || ' seconds')::interval,
  NOW()
FROM generate_series(1, $1::int) AS job_no
CROSS JOIN generate_series(1, $3::int) AS row_no
ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, updated_at = NOW();

INSERT INTO discovery_staged_relationships (id, discovery_job_id, row_number, from_class, to_class, rel_type, source_field, target_hint, confidence, status, message, created_at, updated_at)
SELECT
  specora_stress_uuid('discovery_staged_relationship', (job_no * 100000) + row_no),
  specora_stress_uuid('discovery_job', job_no),
  row_no,
  'ApplicationService',
  (ARRAY['Server','Database','Application'])[1 + (row_no % 3)],
  (ARRAY['DEPENDS_ON','HOSTED_ON','PART_OF'])[1 + (row_no % 3)],
  'db_host',
  'stress-target-' || row_no,
  round((0.55 + ((row_no % 45)::numeric / 100))::numeric, 2),
  (ARRAY['staged','approved','committed'])[1 + (row_no % 3)],
  'Synthetic relationship candidate',
  NOW() - (row_no || ' seconds')::interval,
  NOW()
FROM generate_series(1, $1::int) AS job_no
CROSS JOIN generate_series(1, GREATEST(1, $3::int / 2)) AS row_no
ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, updated_at = NOW();

INSERT INTO reconciliation_rules (id, ci_class, match_keys, conflict_strategy, priority)
SELECT
  specora_stress_uuid('reconciliation_rule', gs),
  'StressClass' || gs,
  jsonb_build_array('name','serialNumber','ipAddress'),
  jsonb_build_object('strategy', 'highest_confidence', 'sourcePriority', jsonb_build_array('edge','discovery','manual')),
  gs
FROM generate_series(1, 50) AS gs
ON CONFLICT (ci_class) DO UPDATE SET match_keys = EXCLUDED.match_keys, conflict_strategy = EXCLUDED.conflict_strategy;

INSERT INTO reconciliation_logs (id, discovery_job_id, ci_id, action, old_values, new_values, created_at)
SELECT
  specora_stress_uuid('reconciliation_log', gs),
  specora_stress_uuid('discovery_job', 1 + (gs % $1::int)),
  'stress-ci-' || gs,
  (ARRAY['created','updated','skipped'])[1 + (gs % 3)],
  jsonb_build_object('name', 'old-' || gs),
  jsonb_build_object('name', 'new-' || gs),
  NOW() - (gs || ' seconds')::interval
FROM generate_series(1, $1::int) AS gs
ON CONFLICT (id) DO UPDATE SET action = EXCLUDED.action, new_values = EXCLUDED.new_values;
`;

const incidentSql = `
INSERT INTO incidents (id, source, external_ref, title, description, service, ci_id, status, severity, priority, assignment_group, owner_id, commander_id, ai_state, ai_confidence, ai_summary, ai_next_action, auto_remediation_allowed, detected_at, acknowledged_at, resolved_at, created_at, updated_at, number, requester_id)
SELECT
  specora_stress_uuid('incident', gs),
  (ARRAY['monitoring','customer-portal','api','edge'])[1 + (gs % 4)],
  'stress-incident-' || gs,
  'Stress incident ' || gs || ' affecting service tier ' || (gs % 20),
  'Synthetic incident with queue, AI, event, role, CI, and postmortem coverage.',
  'Service ' || (gs % 100),
  'demo-applicationservice-' || lpad(((gs % 1000) + 1)::text, 4, '0'),
  (ARRAY['new','investigating','mitigating','resolved','closed'])[1 + (gs % 5)],
  (ARRAY['low','medium','high','critical'])[1 + (gs % 4)],
  1 + (gs % 4),
  (ARRAY['Platform Operations','Service Desk','Database Reliability','Network Operations'])[1 + (gs % 4)],
  specora_stress_uuid('user', 1 + (gs % $2::int)),
  specora_stress_uuid('user', 1 + ((gs + 7) % $2::int)),
  (ARRAY['queued','triaged','remediating','needs_human','resolved'])[1 + (gs % 5)],
  round(((gs % 100)::numeric / 100), 2),
  'AI summary for stress incident ' || gs,
  'Check service health and dependency map.',
  gs % 3 = 0,
  NOW() - (gs || ' minutes')::interval,
  CASE WHEN gs % 5 <> 0 THEN NOW() - ((gs % 120) || ' minutes')::interval ELSE NULL END,
  CASE WHEN gs % 5 IN (3,4) THEN NOW() - ((gs % 60) || ' minutes')::interval ELSE NULL END,
  NOW() - (gs || ' minutes')::interval,
  NOW(),
  'INCST' || lpad(gs::text, 8, '0'),
  specora_stress_uuid('user', 1 + ((gs + 13) % $2::int))
FROM generate_series(1, $1::int) AS gs
ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, severity = EXCLUDED.severity, updated_at = NOW();

INSERT INTO incident_events (id, incident_id, type, message, actor_id, metadata, created_at)
SELECT
  specora_stress_uuid('incident_event', (incident_no * 100) + event_no),
  specora_stress_uuid('incident', incident_no),
  (ARRAY['created','ai_triage','note','status_change','remediation'])[1 + (event_no % 5)],
  'Synthetic incident event ' || event_no || ' for incident ' || incident_no,
  specora_stress_uuid('user', 1 + ((incident_no + event_no) % $2::int)),
  jsonb_build_object('stress', true, 'eventNo', event_no),
  NOW() - ((incident_no + event_no) || ' minutes')::interval
FROM generate_series(1, $1::int) AS incident_no
CROSS JOIN generate_series(1, $3::int) AS event_no
ON CONFLICT (id) DO UPDATE SET message = EXCLUDED.message;

INSERT INTO incident_actions (id, incident_id, name, kind, status, risk_level, confidence, requires_approval, approved_by, result, created_at, updated_at)
SELECT
  specora_stress_uuid('incident_action', gs),
  specora_stress_uuid('incident', gs),
  'Restart synthetic component ' || gs,
  (ARRAY['recommendation','automation','communication'])[1 + (gs % 3)],
  (ARRAY['proposed','approved','completed','rejected'])[1 + (gs % 4)],
  (ARRAY['low','medium','high'])[1 + (gs % 3)],
  round((0.50 + ((gs % 50)::numeric / 100))::numeric, 2),
  gs % 4 <> 0,
  CASE WHEN gs % 4 IN (1,2) THEN specora_stress_uuid('user', 1 + (gs % $2::int)) ELSE NULL END,
  CASE WHEN gs % 4 = 2 THEN 'Completed successfully' ELSE NULL END,
  NOW() - (gs || ' minutes')::interval,
  NOW()
FROM generate_series(1, $1::int) AS gs
ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, updated_at = NOW();

INSERT INTO incident_cis (incident_id, ci_id, role, distance)
SELECT specora_stress_uuid('incident', gs), 'demo-server-' || lpad(((gs % 1000) + 1)::text, 4, '0'), 'affected', gs % 4
FROM generate_series(1, $1::int) AS gs
ON CONFLICT (incident_id, ci_id) DO UPDATE SET distance = EXCLUDED.distance;

INSERT INTO incident_roles (incident_id, user_id, role, assigned_at)
SELECT specora_stress_uuid('incident', gs), specora_stress_uuid('user', 1 + (gs % $2::int)), (ARRAY['commander','scribe','resolver'])[1 + (gs % 3)], NOW() - (gs || ' minutes')::interval
FROM generate_series(1, $1::int) AS gs
ON CONFLICT (incident_id, user_id, role) DO UPDATE SET assigned_at = EXCLUDED.assigned_at;

INSERT INTO incident_postmortems (id, incident_id, status, summary, root_cause, prevention_items, generated_by, created_at, updated_at)
SELECT specora_stress_uuid('incident_postmortem', gs), specora_stress_uuid('incident', gs), (ARRAY['draft','review','published'])[1 + (gs % 3)], 'Synthetic postmortem summary ' || gs, 'Synthetic root cause ' || gs, jsonb_build_array(jsonb_build_object('title','Improve monitoring','owner','SRE')), specora_stress_uuid('user', 1 + (gs % $2::int)), NOW() - (gs || ' hours')::interval, NOW()
FROM generate_series(1, GREATEST(1, $1::int / 4)) AS gs
ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, updated_at = NOW();
`;

const changeSql = `
INSERT INTO change_requests (id, ci_id, title, description, status, requester_id, approver_id, scheduled_at, created_at, updated_at, planned_start_at, planned_end_at, risk_score, blast_radius, priority, number)
SELECT
  specora_stress_uuid('change', gs),
  'demo-applicationservice-' || lpad(((gs % 1000) + 1)::text, 4, '0'),
  'Stress change ' || gs,
  'Synthetic change for CAB, CI impact, comments, approvals, and risk history testing.',
  (ARRAY['draft','pending_approval','approved','implemented','closed','rejected'])[1 + (gs % 6)],
  specora_stress_uuid('user', 1 + (gs % $2::int)),
  specora_stress_uuid('user', 1 + ((gs + 9) % $2::int)),
  NOW() + ((gs % 720) || ' minutes')::interval,
  NOW() - (gs || ' minutes')::interval,
  NOW(),
  NOW() + ((gs % 720) || ' minutes')::interval,
  NOW() + (((gs % 720) + 90) || ' minutes')::interval,
  gs % 100,
  1 + (gs % 500),
  (ARRAY['low','medium','high','critical'])[1 + (gs % 4)],
  'CHGST' || lpad(gs::text, 8, '0')
FROM generate_series(1, $1::int) AS gs
ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, risk_score = EXCLUDED.risk_score, updated_at = NOW();

INSERT INTO change_request_cis (change_request_id, ci_id, role, distance, direction, contribution)
SELECT specora_stress_uuid('change', gs), 'demo-server-' || lpad(((gs % 1000) + 1)::text, 4, '0'), (ARRAY['affected','dependency','business_service'])[1 + (gs % 3)], gs % 5, (ARRAY['upstream','downstream'])[1 + (gs % 2)], round(((gs % 100)::numeric / 100)::numeric, 2)
FROM generate_series(1, $1::int) AS gs
ON CONFLICT (change_request_id, ci_id) DO UPDATE SET distance = EXCLUDED.distance, contribution = EXCLUDED.contribution;

INSERT INTO change_request_approvers (change_request_id, user_id, role, approved_at)
SELECT specora_stress_uuid('change', gs), specora_stress_uuid('user', 1 + ((gs + 3) % $2::int)), 'approver', CASE WHEN gs % 3 = 0 THEN NOW() - ((gs % 100) || ' minutes')::interval ELSE NULL END
FROM generate_series(1, $1::int) AS gs
ON CONFLICT (change_request_id, user_id) DO UPDATE SET approved_at = EXCLUDED.approved_at;

INSERT INTO change_request_comments (id, change_request_id, user_id, content, created_at)
SELECT specora_stress_uuid('change_comment', (change_no * 100) + event_no), specora_stress_uuid('change', change_no), specora_stress_uuid('user', 1 + ((change_no + event_no) % $2::int)), 'Synthetic CAB comment ' || event_no, NOW() - ((change_no + event_no) || ' minutes')::interval
FROM generate_series(1, $1::int) AS change_no
CROSS JOIN generate_series(1, $3::int) AS event_no
ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content;

INSERT INTO change_request_risk_history (id, change_request_id, risk_score, blast_radius, priority, computed_at, computed_by)
SELECT specora_stress_uuid('change_risk', (change_no * 100) + event_no), specora_stress_uuid('change', change_no), (change_no + event_no) % 100, 1 + ((change_no + event_no) % 500), (ARRAY['low','medium','high','critical'])[1 + ((change_no + event_no) % 4)], NOW() - (event_no || ' hours')::interval, 'enterprise-seed'
FROM generate_series(1, $1::int) AS change_no
CROSS JOIN generate_series(1, GREATEST(1, $3::int / 2)) AS event_no
ON CONFLICT (id) DO UPDATE SET risk_score = EXCLUDED.risk_score;
`;

const knowledgeSql = `
INSERT INTO knowledge_items (id, type, title, summary, content, status, audience, source, source_ref, owner_id, service, ci_id, tags, trust_score, health_score, ai_confidence, reuse_count, deflection_count, last_validated_at, published_at, number, created_at, updated_at)
SELECT
  specora_stress_uuid('knowledge', gs),
  (ARRAY['article','known_error','runbook','faq'])[1 + (gs % 4)],
  'Stress knowledge article ' || gs,
  'Synthetic knowledge summary for service ' || (gs % 100),
  'Synthetic enterprise knowledge content. This record exists to test search, queue, trust, validation, and relationship performance at scale.',
  (ARRAY['draft','published','needs_review','retired'])[1 + (gs % 4)],
  (ARRAY['internal','public','agent'])[1 + (gs % 3)],
  (ARRAY['manual','ai','incident','problem'])[1 + (gs % 4)],
  'stress-kb-source-' || gs,
  specora_stress_uuid('user', 1 + (gs % $2::int)),
  'Service ' || (gs % 100),
  'demo-applicationservice-' || lpad(((gs % 1000) + 1)::text, 4, '0'),
  ARRAY['stress','service-' || (gs % 100),'tier-' || (gs % 5)],
  round((0.40 + ((gs % 60)::numeric / 100))::numeric, 2),
  round((0.30 + ((gs % 70)::numeric / 100))::numeric, 2),
  round(((gs % 100)::numeric / 100), 2),
  gs % 10000,
  gs % 5000,
  NOW() - ((gs % 90) || ' days')::interval,
  CASE WHEN gs % 4 = 1 THEN NOW() - ((gs % 60) || ' days')::interval ELSE NULL END,
  'KBST' || lpad(gs::text, 8, '0'),
  NOW() - (gs || ' minutes')::interval,
  NOW()
FROM generate_series(1, $1::int) AS gs
ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, trust_score = EXCLUDED.trust_score, updated_at = NOW();

INSERT INTO knowledge_events (id, knowledge_id, type, message, actor_id, metadata, created_at)
SELECT specora_stress_uuid('knowledge_event', (knowledge_no * 100) + event_no), specora_stress_uuid('knowledge', knowledge_no), (ARRAY['created','reviewed','used','validated'])[1 + (event_no % 4)], 'Synthetic knowledge event ' || event_no, specora_stress_uuid('user', 1 + ((knowledge_no + event_no) % $2::int)), jsonb_build_object('stress', true), NOW() - ((knowledge_no + event_no) || ' minutes')::interval
FROM generate_series(1, $1::int) AS knowledge_no
CROSS JOIN generate_series(1, $3::int) AS event_no
ON CONFLICT (id) DO UPDATE SET message = EXCLUDED.message;

INSERT INTO knowledge_feedback (id, knowledge_id, user_id, helpful, outcome, comment, context, created_at)
SELECT specora_stress_uuid('knowledge_feedback', gs), specora_stress_uuid('knowledge', 1 + (gs % $1::int)), specora_stress_uuid('user', 1 + (gs % $2::int)), gs % 3 <> 0, (ARRAY['deflected','escalated','unclear'])[1 + (gs % 3)], 'Synthetic feedback ' || gs, jsonb_build_object('channel','portal','stress',true), NOW() - (gs || ' minutes')::interval
FROM generate_series(1, $1::int) AS gs
ON CONFLICT (id) DO UPDATE SET helpful = EXCLUDED.helpful, outcome = EXCLUDED.outcome;

INSERT INTO knowledge_gaps (id, query, context, status, demand_count, proposed_knowledge_id, created_at, updated_at)
SELECT specora_stress_uuid('knowledge_gap', gs), 'How do I resolve stress scenario ' || gs || '?', jsonb_build_object('service','Service ' || (gs % 100)), (ARRAY['open','proposed','closed'])[1 + (gs % 3)], 1 + (gs % 500), CASE WHEN gs % 3 = 1 THEN specora_stress_uuid('knowledge', 1 + (gs % $1::int)) ELSE NULL END, NOW() - (gs || ' minutes')::interval, NOW()
FROM generate_series(1, GREATEST(1, $1::int / 5)) AS gs
ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, demand_count = EXCLUDED.demand_count, updated_at = NOW();

INSERT INTO knowledge_links (id, knowledge_id, target_type, target_id, relationship, created_at)
SELECT specora_stress_uuid('knowledge_link', gs), specora_stress_uuid('knowledge', 1 + (gs % $1::int)), (ARRAY['incident','change','ci','catalog_item'])[1 + (gs % 4)], 'stress-target-' || gs, (ARRAY['related','resolves','documents','prevents'])[1 + (gs % 4)], NOW() - (gs || ' minutes')::interval
FROM generate_series(1, $1::int) AS gs
ON CONFLICT (id) DO UPDATE SET relationship = EXCLUDED.relationship;
`;

const preventionSql = `
INSERT INTO prevention_records (id, title, description, status, category, priority, service, ci_id, owner_id, recurrence_count, impact_score, confidence, estimated_hours_saved, verified_reduction_pct, known_error_id, created_at, updated_at, resolved_at, number)
SELECT specora_stress_uuid('prevention', gs), 'Stress prevention opportunity ' || gs, 'Synthetic prevention record derived from recurring incidents.', (ARRAY['candidate','active','implemented','prevented'])[1 + (gs % 4)], (ARRAY['recurring_incident','capacity','change_risk','knowledge_gap'])[1 + (gs % 4)], 1 + (gs % 4), 'Service ' || (gs % 100), 'demo-applicationservice-' || lpad(((gs % 1000) + 1)::text, 4, '0'), specora_stress_uuid('user', 1 + (gs % $2::int)), 1 + (gs % 50), round(((gs % 100)::numeric / 10), 2), round(((gs % 100)::numeric / 100), 2), round(((gs % 200)::numeric / 10), 2), CASE WHEN gs % 4 = 3 THEN round(((gs % 80)::numeric / 100), 2) ELSE NULL END, CASE WHEN gs % 3 = 0 THEN specora_stress_uuid('knowledge', 1 + (gs % $1::int)) ELSE NULL END, NOW() - (gs || ' minutes')::interval, NOW(), CASE WHEN gs % 4 = 3 THEN NOW() - ((gs % 90) || ' days')::interval ELSE NULL END, 'PRVST' || lpad(gs::text, 8, '0')
FROM generate_series(1, $1::int) AS gs
ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, updated_at = NOW();

INSERT INTO prevention_actions (id, prevention_id, type, title, status, target_app, target_id, result, created_at, updated_at)
SELECT specora_stress_uuid('prevention_action', gs), specora_stress_uuid('prevention', gs), (ARRAY['automation','knowledge','change','monitoring'])[1 + (gs % 4)], 'Synthetic prevention action ' || gs, (ARRAY['proposed','accepted','completed','rejected'])[1 + (gs % 4)], (ARRAY['knowledge-core','change-manager','incident-manager','discovery'])[1 + (gs % 4)], 'stress-target-' || gs, CASE WHEN gs % 4 = 2 THEN 'Completed' ELSE NULL END, NOW() - (gs || ' minutes')::interval, NOW()
FROM generate_series(1, $1::int) AS gs
ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, updated_at = NOW();

INSERT INTO prevention_events (id, prevention_id, type, message, actor_id, metadata, created_at)
SELECT specora_stress_uuid('prevention_event', (record_no * 100) + event_no), specora_stress_uuid('prevention', record_no), (ARRAY['created','analyzed','actioned','verified'])[1 + (event_no % 4)], 'Synthetic prevention event ' || event_no, specora_stress_uuid('user', 1 + ((record_no + event_no) % $2::int)), jsonb_build_object('stress', true), NOW() - ((record_no + event_no) || ' minutes')::interval
FROM generate_series(1, $1::int) AS record_no
CROSS JOIN generate_series(1, $3::int) AS event_no
ON CONFLICT (id) DO UPDATE SET message = EXCLUDED.message;

INSERT INTO prevention_evidence (id, prevention_id, source_type, source_id, summary, weight, created_at)
SELECT specora_stress_uuid('prevention_evidence', gs), specora_stress_uuid('prevention', gs), (ARRAY['incident','knowledge','change','metric'])[1 + (gs % 4)], 'stress-source-' || gs, 'Synthetic evidence summary ' || gs, round((0.5 + ((gs % 50)::numeric / 100))::numeric, 2), NOW() - (gs || ' minutes')::interval
FROM generate_series(1, $1::int) AS gs
ON CONFLICT (id) DO UPDATE SET summary = EXCLUDED.summary;
`;

const assetSql = `
INSERT INTO asset_contracts (id, name, vendor, contract_type, status, source, source_ref, document_name, extracted_summary, ai_confidence, starts_at, ends_at, renewal_at, annual_cost)
SELECT specora_stress_uuid('asset_contract', gs), 'Stress Contract ' || gs, (ARRAY['Microsoft','Adobe','Oracle','Dell','Cisco','ServiceNow'])[1 + (gs % 6)], (ARRAY['software','hardware','cloud','support'])[1 + (gs % 4)], (ARRAY['active','pending','expired'])[1 + (gs % 3)], 'stress-seed', 'contract-' || gs, 'contract-' || gs || '.pdf', 'Synthetic entitlement extraction summary.', round(((gs % 100)::numeric / 100), 2), NOW() - INTERVAL '365 days', NOW() + INTERVAL '365 days', NOW() + ((gs % 120) || ' days')::interval, 10000 + (gs * 100)
FROM generate_series(1, GREATEST(1, $1::int / 20)) AS gs
ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, annual_cost = EXCLUDED.annual_cost, updated_at = NOW();

INSERT INTO asset_records (id, asset_tag, serial_number, name, category, asset_type, status, lifecycle_state, manufacturer, model, assigned_to, owner_group, location, ci_id, cost, purchase_order, invoice_ref, contract_id, warranty_expires_at, acquisition_date, confidence, evidence_score, number, created_at, updated_at)
SELECT specora_stress_uuid('asset', gs), 'ST-AST-' || lpad(gs::text, 8, '0'), 'ST-SN-' || lpad(gs::text, 10, '0'), 'Stress Asset ' || gs, (ARRAY['hardware','software','cloud','network'])[1 + (gs % 4)], (ARRAY['device','server','license','subscription'])[1 + (gs % 4)], (ARRAY['in_use','in_stock','retired','inbox'])[1 + (gs % 4)], (ARRAY['identified','ordered','received','deployed','disposed'])[1 + (gs % 5)], (ARRAY['Dell','Apple','Lenovo','Cisco','Microsoft'])[1 + (gs % 5)], 'Model ' || (gs % 200), specora_stress_uuid('user', 1 + (gs % $2::int)), (ARRAY['Endpoint Services','Platform Operations','Finance Apps'])[1 + (gs % 3)], (ARRAY['Dallas','Chicago','London','Singapore'])[1 + (gs % 4)], 'demo-server-' || lpad(((gs % 1000) + 1)::text, 4, '0'), 500 + (gs % 5000), 'PO-ST-' || (gs % 5000), 'INV-ST-' || gs, specora_stress_uuid('asset_contract', 1 + (gs % GREATEST(1, $1::int / 20))), NOW() + ((gs % 900) || ' days')::interval, NOW() - ((gs % 900) || ' days')::interval, round((0.40 + ((gs % 60)::numeric / 100))::numeric, 2), round((0.30 + ((gs % 70)::numeric / 100))::numeric, 2), 'ASTST' || lpad(gs::text, 8, '0'), NOW() - (gs || ' minutes')::interval, NOW()
FROM generate_series(1, $1::int) AS gs
ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, lifecycle_state = EXCLUDED.lifecycle_state, updated_at = NOW();

INSERT INTO software_entitlements (id, contract_id, publisher, product, sku, metric, quantity, consumed, rights, constraints, status, confidence, source_citation, starts_at, ends_at, created_at, updated_at)
SELECT specora_stress_uuid('software_entitlement', gs), specora_stress_uuid('asset_contract', 1 + (gs % GREATEST(1, $1::int / 20))), (ARRAY['Microsoft','Adobe','Oracle','Atlassian','GitHub'])[1 + (gs % 5)], 'Stress Product ' || (gs % 200), 'SKU-' || gs, (ARRAY['user','device','core','install'])[1 + (gs % 4)], 100 + (gs % 10000), gs % 10000, jsonb_build_object('downgrade', gs % 2 = 0, 'virtualization', gs % 3 = 0), jsonb_build_object('region','global'), (ARRAY['active','expired','pending'])[1 + (gs % 3)], round((0.50 + ((gs % 50)::numeric / 100))::numeric, 2), 'Synthetic contract clause ' || gs, NOW() - INTERVAL '180 days', NOW() + INTERVAL '180 days', NOW() - (gs || ' minutes')::interval, NOW()
FROM generate_series(1, GREATEST(1, $1::int / 4)) AS gs
ON CONFLICT (id) DO UPDATE SET consumed = EXCLUDED.consumed, updated_at = NOW();

INSERT INTO software_usage (id, publisher, product, normalized_product, version, metric, quantity, user_id, asset_id, ci_id, source, source_ref, last_seen_at, created_at)
SELECT specora_stress_uuid('software_usage', gs), (ARRAY['Microsoft','Adobe','Oracle','Atlassian','GitHub'])[1 + (gs % 5)], 'Stress Product ' || (gs % 200), 'stress_product_' || (gs % 200), 'v' || (1 + (gs % 10)) || '.' || (gs % 20), (ARRAY['install','user','device'])[1 + (gs % 3)], 1 + (gs % 8), specora_stress_uuid('user', 1 + (gs % $2::int)), specora_stress_uuid('asset', 1 + (gs % $1::int)), 'demo-server-' || lpad(((gs % 1000) + 1)::text, 4, '0'), 'stress-discovery', 'software-inventory-' || gs, NOW() - ((gs % 30) || ' days')::interval, NOW() - (gs || ' minutes')::interval
FROM generate_series(1, $1::int) AS gs
ON CONFLICT (id) DO UPDATE SET quantity = EXCLUDED.quantity, last_seen_at = EXCLUDED.last_seen_at;

INSERT INTO asset_evidence (id, asset_id, contract_id, entitlement_id, evidence_type, source, source_ref, payload, confidence, created_at)
SELECT specora_stress_uuid('asset_evidence', gs), specora_stress_uuid('asset', 1 + (gs % $1::int)), specora_stress_uuid('asset_contract', 1 + (gs % GREATEST(1, $1::int / 20))), specora_stress_uuid('software_entitlement', 1 + (gs % GREATEST(1, $1::int / 4))), (ARRAY['purchase_order','invoice','scan','contract'])[1 + (gs % 4)], 'stress-seed', 'evidence-' || gs, jsonb_build_object('confidenceSource','synthetic'), round((0.50 + ((gs % 50)::numeric / 100))::numeric, 2), NOW() - (gs || ' minutes')::interval
FROM generate_series(1, $1::int) AS gs
ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload;

INSERT INTO asset_scan_events (id, asset_id, scan_type, value, action, location, condition, scanned_by, payload, created_at)
SELECT specora_stress_uuid('asset_scan_event', gs), specora_stress_uuid('asset', 1 + (gs % $1::int)), (ARRAY['barcode','rfid','manual'])[1 + (gs % 3)], 'ST-AST-' || lpad((1 + (gs % $1::int))::text, 8, '0'), (ARRAY['verify','move','receive','dispose'])[1 + (gs % 4)], (ARRAY['Dallas','Chicago','London','Singapore'])[1 + (gs % 4)], (ARRAY['good','damaged','unknown'])[1 + (gs % 3)], specora_stress_uuid('user', 1 + (gs % $2::int)), jsonb_build_object('stress', true), NOW() - (gs || ' minutes')::interval
FROM generate_series(1, $1::int) AS gs
ON CONFLICT (id) DO UPDATE SET action = EXCLUDED.action;

INSERT INTO asset_reconciliation_runs (id, type, status, summary, risk_score, savings_estimate, created_by, created_at)
SELECT specora_stress_uuid('asset_reconciliation_run', gs), (ARRAY['sam','ham','contract'])[1 + (gs % 3)], (ARRAY['completed','running','failed'])[1 + (gs % 3)], 'Synthetic reconciliation run ' || gs, gs % 100, gs * 100, specora_stress_uuid('user', 1 + (gs % $2::int)), NOW() - (gs || ' hours')::interval
FROM generate_series(1, GREATEST(1, $1::int / 100)) AS gs
ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, risk_score = EXCLUDED.risk_score;

INSERT INTO asset_exceptions (id, run_id, asset_id, entitlement_id, usage_id, type, severity, status, title, detail, financial_impact, created_at, updated_at)
SELECT specora_stress_uuid('asset_exception', gs), specora_stress_uuid('asset_reconciliation_run', 1 + (gs % GREATEST(1, $1::int / 100))), specora_stress_uuid('asset', 1 + (gs % $1::int)), specora_stress_uuid('software_entitlement', 1 + (gs % GREATEST(1, $1::int / 4))), specora_stress_uuid('software_usage', 1 + (gs % $1::int)), (ARRAY['over_deployed','under_used','missing_evidence'])[1 + (gs % 3)], (ARRAY['low','medium','high','critical'])[1 + (gs % 4)], (ARRAY['open','accepted','remediated'])[1 + (gs % 3)], 'Synthetic asset exception ' || gs, 'Synthetic exception detail.', gs * 10, NOW() - (gs || ' minutes')::interval, NOW()
FROM generate_series(1, GREATEST(1, $1::int / 2)) AS gs
ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, financial_impact = EXCLUDED.financial_impact, updated_at = NOW();
`;

const dcimSql = `
WITH site_rows AS (
  SELECT gs AS site_no FROM generate_series(1, $1::int) AS gs
)
INSERT INTO dcim_sites (id, name, location, status, capacity_kw, used_kw, cooling_capacity_kw, metadata, created_at, updated_at)
SELECT specora_stress_uuid('dcim_site', site_no), 'Stress DC ' || site_no, (ARRAY['Dallas','Chicago','London','Singapore','Sydney'])[1 + (site_no % 5)], (ARRAY['operational','warning','maintenance'])[1 + (site_no % 3)], 5000 + site_no, 2500 + (site_no % 1000), 6000 + site_no, jsonb_build_object('stress', true), NOW() - (site_no || ' days')::interval, NOW()
FROM site_rows
ON CONFLICT (id) DO UPDATE SET used_kw = EXCLUDED.used_kw, updated_at = NOW();

INSERT INTO dcim_rooms (id, site_id, name, floor_label, status, temperature_c, humidity_percent, metadata, created_at, updated_at)
SELECT specora_stress_uuid('dcim_room', (site_no * 1000) + room_no), specora_stress_uuid('dcim_site', site_no), 'Hall ' || room_no, 'L' || (1 + (room_no % 5)), (ARRAY['operational','warning'])[1 + (room_no % 2)], 20 + (room_no % 8), 35 + (room_no % 30), jsonb_build_object('stress', true), NOW() - (room_no || ' days')::interval, NOW()
FROM generate_series(1, $1::int) AS site_no
CROSS JOIN generate_series(1, $2::int) AS room_no
ON CONFLICT (id) DO UPDATE SET temperature_c = EXCLUDED.temperature_c, updated_at = NOW();

INSERT INTO dcim_racks (id, room_id, name, row_label, position_label, ru_total, ru_used, power_capacity_kw, power_used_kw, weight_capacity_kg, weight_used_kg, redundancy, risk_score, status, metadata, created_at, updated_at)
SELECT specora_stress_uuid('dcim_rack', (((site_no * 1000) + room_no) * 1000) + rack_no), specora_stress_uuid('dcim_room', (site_no * 1000) + room_no), chr(65 + (rack_no % 12)) || lpad(rack_no::text, 2, '0'), chr(65 + (rack_no % 12)), rack_no::text, 42, 10 + (rack_no % 32), 18 + (rack_no % 8), 4 + (rack_no % 20), 1200, 300 + (rack_no % 900), (ARRAY['A/B','N+1','2N'])[1 + (rack_no % 3)], rack_no % 100, (ARRAY['operational','warning','critical'])[1 + (rack_no % 3)], jsonb_build_object('stress', true), NOW() - (rack_no || ' hours')::interval, NOW()
FROM generate_series(1, $1::int) AS site_no
CROSS JOIN generate_series(1, $2::int) AS room_no
CROSS JOIN generate_series(1, $3::int) AS rack_no
ON CONFLICT (id) DO UPDATE SET power_used_kw = EXCLUDED.power_used_kw, risk_score = EXCLUDED.risk_score, updated_at = NOW();

INSERT INTO dcim_floorplans (id, room_id, name, width, height, unit, metadata, created_at, updated_at)
SELECT specora_stress_uuid('dcim_floorplan', (site_no * 1000) + room_no), specora_stress_uuid('dcim_room', (site_no * 1000) + room_no), 'Stress Floorplan ' || site_no || '-' || room_no, 2400, 1600, 'px', jsonb_build_object('stress', true), NOW(), NOW()
FROM generate_series(1, $1::int) AS site_no
CROSS JOIN generate_series(1, $2::int) AS room_no
ON CONFLICT (room_id, name) DO UPDATE SET width = EXCLUDED.width, updated_at = NOW();

INSERT INTO dcim_floorplan_objects (id, floorplan_id, object_type, object_id, label, x, y, width, height, rotation, layer, style, metadata, created_at, updated_at)
SELECT specora_stress_uuid('dcim_floorplan_object', (((site_no * 1000) + room_no) * 1000) + rack_no), specora_stress_uuid('dcim_floorplan', (site_no * 1000) + room_no), 'rack', specora_stress_uuid('dcim_rack', (((site_no * 1000) + room_no) * 1000) + rack_no), chr(65 + (rack_no % 12)) || lpad(rack_no::text, 2, '0'), 40 + ((rack_no % 20) * 110), 40 + ((rack_no / 20) * 160), 90, 140, 0, 'rack', jsonb_build_object('fill', '#2563eb'), jsonb_build_object('stress', true), NOW(), NOW()
FROM generate_series(1, $1::int) AS site_no
CROSS JOIN generate_series(1, $2::int) AS room_no
CROSS JOIN generate_series(1, $3::int) AS rack_no
ON CONFLICT (floorplan_id, object_type, object_id) DO UPDATE SET x = EXCLUDED.x, y = EXCLUDED.y, updated_at = NOW();

INSERT INTO dcim_floorplan_connections (id, floorplan_id, source_object_id, target_object_id, connection_type, label, status, metadata, created_at, updated_at)
SELECT specora_stress_uuid('dcim_floorplan_connection', (((site_no * 1000) + room_no) * 1000) + rack_no), specora_stress_uuid('dcim_floorplan', (site_no * 1000) + room_no), specora_stress_uuid('dcim_floorplan_object', (((site_no * 1000) + room_no) * 1000) + rack_no), specora_stress_uuid('dcim_floorplan_object', (((site_no * 1000) + room_no) * 1000) + GREATEST(1, rack_no - 1)), (ARRAY['network','power','dependency'])[1 + (rack_no % 3)], 'Synthetic link ' || rack_no, (ARRAY['operational','warning'])[1 + (rack_no % 2)], jsonb_build_object('stress', true), NOW(), NOW()
FROM generate_series(1, $1::int) AS site_no
CROSS JOIN generate_series(1, $2::int) AS room_no
CROSS JOIN generate_series(2, $3::int) AS rack_no
ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, updated_at = NOW();

INSERT INTO dcim_assets (id, rack_id, ci_id, asset_id, name, asset_type, vendor, model, ru_start, ru_height, power_draw_kw, network_ports, status, metadata, created_at, updated_at)
SELECT specora_stress_uuid('dcim_asset', gs), specora_stress_uuid('dcim_rack', 1001000 + (1 + (gs % $3::int))), 'demo-server-' || lpad(((gs % 1000) + 1)::text, 4, '0'), specora_stress_uuid('asset', 1 + (gs % $4::int)), 'Stress DCIM Asset ' || gs, (ARRAY['server','network','storage'])[1 + (gs % 3)], (ARRAY['Dell','HPE','Cisco'])[1 + (gs % 3)], 'DCIM Model ' || (gs % 100), 1 + (gs % 40), 1 + (gs % 4), round((0.2 + ((gs % 30)::numeric / 10))::numeric, 2), 2 + (gs % 12), (ARRAY['operational','warning','maintenance'])[1 + (gs % 3)], jsonb_build_object('stress', true), NOW() - (gs || ' minutes')::interval, NOW()
FROM generate_series(1, $4::int) AS gs
ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, updated_at = NOW();

INSERT INTO dcim_power_paths (id, site_id, rack_id, source_name, source_type, path_role, capacity_kw, load_kw, redundancy_group, status, metadata, created_at, updated_at)
SELECT specora_stress_uuid('dcim_power_path', gs), specora_stress_uuid('dcim_site', 1 + (gs % $1::int)), specora_stress_uuid('dcim_rack', 1001000 + (1 + (gs % $3::int))), 'UPS Stress ' || gs, (ARRAY['ups','pdu','utility'])[1 + (gs % 3)], (ARRAY['A','B','primary'])[1 + (gs % 3)], 12 + (gs % 20), 2 + (gs % 18), 'RG-' || (gs % 100), (ARRAY['operational','warning'])[1 + (gs % 2)], jsonb_build_object('stress', true), NOW(), NOW()
FROM generate_series(1, GREATEST(1, $4::int / 2)) AS gs
ON CONFLICT (id) DO UPDATE SET load_kw = EXCLUDED.load_kw, updated_at = NOW();

INSERT INTO dcim_events (id, source, external_ref, severity, status, event_type, title, description, site_id, room_id, rack_id, asset_id, ai_summary, first_seen_at, last_seen_at, metadata, created_at, updated_at)
SELECT specora_stress_uuid('dcim_event', gs), 'stress-sensor', 'stress-dcim-event-' || gs, (ARRAY['info','warning','critical'])[1 + (gs % 3)], (ARRAY['open','acknowledged','closed'])[1 + (gs % 3)], (ARRAY['power','thermal','capacity','network'])[1 + (gs % 4)], 'Stress DCIM event ' || gs, 'Synthetic DCIM event for data center operations scale testing.', specora_stress_uuid('dcim_site', 1 + (gs % $1::int)), specora_stress_uuid('dcim_room', ((1 + (gs % $1::int)) * 1000) + (1 + (gs % $2::int))), specora_stress_uuid('dcim_rack', 1001000 + (1 + (gs % $3::int))), specora_stress_uuid('dcim_asset', 1 + (gs % $4::int)), 'Synthetic AI summary for DCIM event ' || gs, NOW() - (gs || ' minutes')::interval, NOW(), jsonb_build_object('stress', true), NOW() - (gs || ' minutes')::interval, NOW()
FROM generate_series(1, $4::int) AS gs
ON CONFLICT (source, external_ref) DO UPDATE SET severity = EXCLUDED.severity, status = EXCLUDED.status, last_seen_at = NOW(), updated_at = NOW();
`;

const catalogSql = `
INSERT INTO catalog_items (id, key, title, description, category, item_type, status, audience, questions, fulfillment, related_knowledge_ids, owner_group, fulfillment_group, ai_prompt, version, created_at, updated_at)
SELECT specora_stress_uuid('catalog_item', gs), 'stress-catalog-item-' || gs, 'Stress Catalog Item ' || gs, 'Synthetic catalog item for portal and fulfillment load testing.', (ARRAY['Access','Hardware','Software','Help','Facilities'])[1 + (gs % 5)], (ARRAY['service_request','access_request','hardware_request','incident_intake'])[1 + (gs % 4)], (ARRAY['published','draft','retired'])[1 + (gs % 3)], jsonb_build_array('employee','agent'), jsonb_build_array(jsonb_build_object('key','summary','type','text','required',true)), jsonb_build_array(jsonb_build_object('type','approval'), jsonb_build_object('type','automation')), jsonb_build_array(specora_stress_uuid('knowledge', 1 + (gs % GREATEST(1, $2::int)))::text), 'Service Catalog', (ARRAY['Identity Operations','Endpoint Services','Service Desk'])[1 + (gs % 3)], 'Classify, deflect, and fulfill this synthetic request.', 1 + (gs % 20), NOW() - (gs || ' days')::interval, NOW()
FROM generate_series(1, $1::int) AS gs
ON CONFLICT (key) DO UPDATE SET title = EXCLUDED.title, status = EXCLUDED.status, updated_at = NOW();

INSERT INTO support_channels (id, name, channel_type, description, target, enabled, priority, rules, integration_config, created_at, updated_at)
SELECT specora_stress_uuid('support_channel', gs), 'Stress Support Channel ' || gs, (ARRAY['chat','phone','callback','webhook'])[1 + (gs % 4)], 'Synthetic support handoff channel.', 'stress-channel-' || gs, gs % 5 <> 0, gs, jsonb_build_object('priority', gs), jsonb_build_object('adapter','stress'), NOW(), NOW()
FROM generate_series(1, 50) AS gs
ON CONFLICT (id) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW();

INSERT INTO catalog_requests (id, number, requester_id, catalog_item_id, title, description, request_type, status, priority, source, intent_summary, answers, ai_resolution, fulfillment_plan, support_channel_id, created_at, updated_at)
SELECT specora_stress_uuid('catalog_request', gs), 'REQST' || lpad(gs::text, 8, '0'), specora_stress_uuid('user', 1 + (gs % $3::int)), specora_stress_uuid('catalog_item', 1 + (gs % $1::int)), 'Stress catalog request ' || gs, 'Synthetic portal request with routing and fulfillment context.', (ARRAY['service_request','access_request','incident_intake','hardware_request'])[1 + (gs % 4)], (ARRAY['submitted','triaged','in_progress','fulfilled','cancelled'])[1 + (gs % 5)], 1 + (gs % 4), (ARRAY['portal','chat','api'])[1 + (gs % 3)], 'Synthetic request intent summary.', jsonb_build_object('summary','Need help with stress request ' || gs), jsonb_build_object('route','catalog_request','confidence',0.9), jsonb_build_array(jsonb_build_object('step','triage'), jsonb_build_object('step','fulfill')), specora_stress_uuid('support_channel', 1 + (gs % 50)), NOW() - (gs || ' minutes')::interval, NOW()
FROM generate_series(1, $2::int) AS gs
ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, ai_resolution = EXCLUDED.ai_resolution, updated_at = NOW();

INSERT INTO catalog_request_events (id, request_id, type, message, actor_id, metadata, created_at)
SELECT specora_stress_uuid('catalog_request_event', (request_no * 100) + event_no), specora_stress_uuid('catalog_request', request_no), (ARRAY['created','classified','routed','work_note','fulfilled'])[1 + (event_no % 5)], 'Synthetic request event ' || event_no, specora_stress_uuid('user', 1 + ((request_no + event_no) % $3::int)), jsonb_build_object('stress', true), NOW() - ((request_no + event_no) || ' minutes')::interval
FROM generate_series(1, $2::int) AS request_no
CROSS JOIN generate_series(1, $4::int) AS event_no
ON CONFLICT (id) DO UPDATE SET message = EXCLUDED.message;

INSERT INTO support_handoffs (id, channel_id, requester_id, request_id, incident_id, status, reason, context, created_at, updated_at)
SELECT specora_stress_uuid('support_handoff', gs), specora_stress_uuid('support_channel', 1 + (gs % 50)), specora_stress_uuid('user', 1 + (gs % $3::int)), specora_stress_uuid('catalog_request', 1 + (gs % $2::int)), CASE WHEN gs % 3 = 0 THEN specora_stress_uuid('incident', 1 + (gs % $2::int)) ELSE NULL END, (ARRAY['requested','accepted','completed','cancelled'])[1 + (gs % 4)], 'Synthetic escalation reason ' || gs, jsonb_build_object('classifierConfidence', 0.6 + ((gs % 40)::numeric / 100)), NOW() - (gs || ' minutes')::interval, NOW()
FROM generate_series(1, GREATEST(1, $2::int / 5)) AS gs
ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, updated_at = NOW();
`;

const activitySql = `
INSERT INTO chat_sessions (id, user_id, title, created_at, updated_at, pathlight_trace_id)
SELECT specora_stress_uuid('chat_session', gs), specora_stress_uuid('user', 1 + (gs % $2::int))::text, 'Stress Chat Session ' || gs, NOW() - (gs || ' minutes')::interval, NOW(), 'stress-trace-' || gs
FROM generate_series(1, $1::int) AS gs
ON CONFLICT (id) DO UPDATE SET updated_at = NOW();

INSERT INTO chat_messages (id, session_id, role, content, tool_calls, tool_call_id, created_at)
SELECT specora_stress_uuid('chat_message', (session_no * 100) + msg_no), specora_stress_uuid('chat_session', session_no), (ARRAY['user','assistant','tool'])[1 + (msg_no % 3)], 'Synthetic chat message ' || msg_no || ' for session ' || session_no, CASE WHEN msg_no % 3 = 2 THEN jsonb_build_array(jsonb_build_object('name','stress.tool','arguments',jsonb_build_object('id',session_no))) ELSE NULL END, CASE WHEN msg_no % 3 = 2 THEN 'tool-call-' || session_no || '-' || msg_no ELSE NULL END, NOW() - ((session_no + msg_no) || ' seconds')::interval
FROM generate_series(1, $1::int) AS session_no
CROSS JOIN generate_series(1, $3::int) AS msg_no
ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content;

INSERT INTO jobs (id, type, payload, status, created_at, updated_at, priority, retries, max_retries, error_message, worker_id, started_at, completed_at)
SELECT specora_stress_uuid('job', gs), (ARRAY['discovery_pipeline','ai_classification','asset_reconciliation','notification'])[1 + (gs % 4)], jsonb_build_object('stress', true, 'id', gs), (ARRAY['pending','running','completed','failed'])[1 + (gs % 4)], NOW() - (gs || ' minutes')::interval, NOW(), gs % 10, gs % 3, 3, CASE WHEN gs % 4 = 3 THEN 'Synthetic failure' ELSE NULL END, 'stress-worker-' || (gs % 20), CASE WHEN gs % 4 IN (1,2,3) THEN NOW() - ((gs % 60) || ' seconds')::interval ELSE NULL END, CASE WHEN gs % 4 IN (2,3) THEN NOW() ELSE NULL END
FROM generate_series(1, $1::int) AS gs
ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, updated_at = NOW();

INSERT INTO events (id, type, payload, created_at)
SELECT specora_stress_uuid('event', gs), (ARRAY['incident.updated','change.updated','catalog.routed','asset.scanned','discovery.completed'])[1 + (gs % 5)], jsonb_build_object('stress', true, 'sequence', gs), NOW() - (gs || ' seconds')::interval
FROM generate_series(1, $1::int * $3::int) AS gs
ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload;

INSERT INTO audit_log (id, actor_id, action, entity_type, entity_id, old_values, new_values, metadata, created_at)
SELECT specora_stress_uuid('audit_log', gs), specora_stress_uuid('user', 1 + (gs % $2::int)), (ARRAY['create','update','delete','approve','execute'])[1 + (gs % 5)], (ARRAY['incident','change','catalog_request','asset','knowledge'])[1 + (gs % 5)], 'stress-entity-' || gs, jsonb_build_object('status','old'), jsonb_build_object('status','new'), jsonb_build_object('stress', true, 'source','enterprise-seed'), NOW() - (gs || ' seconds')::interval
FROM generate_series(1, $1::int * $3::int) AS gs
ON CONFLICT (id) DO UPDATE SET new_values = EXCLUDED.new_values;

INSERT INTO saved_views (user_id, name, root_id, class_filter, environment_filter, relationship_filter, camera_x, camera_y, camera_zoom, created_at, updated_at)
SELECT specora_stress_uuid('user', 1 + (gs % $2::int)), 'Stress View ' || gs, 'demo-businessservice-' || lpad(((gs % 500) + 1)::text, 4, '0'), jsonb_build_array('BusinessService','ApplicationService'), jsonb_build_array('Production'), jsonb_build_array('DEPENDS_ON','HOSTED_ON'), gs % 1000, gs % 800, 1.0, NOW() - (gs || ' minutes')::interval, NOW()
FROM generate_series(1, LEAST($1::int, 10000)) AS gs
WHERE NOT EXISTS (
  SELECT 1 FROM saved_views sv
  WHERE sv.user_id = specora_stress_uuid('user', 1 + (gs % $2::int))
    AND sv.name = 'Stress View ' || gs
);
`;

const recordNumbersSql = `
INSERT INTO number_sequences (id, app_id, table_name, record_type, prefix, next_value, padding, enabled, created_at, updated_at)
VALUES
  (specora_stress_uuid('number_sequence', 1), 'enterprise-seed', 'stress_records', 'Stress Record', 'STRESS', $1::bigint + 1, 8, true, NOW(), NOW())
ON CONFLICT (table_name) DO UPDATE SET next_value = GREATEST(number_sequences.next_value, EXCLUDED.next_value), updated_at = NOW();

INSERT INTO record_numbers (id, table_name, record_id, number, sequence_id, created_at)
SELECT specora_stress_uuid('record_number', gs), 'stress_records', specora_stress_uuid('stress_record', gs), 'STRESS' || lpad(gs::text, 8, '0'), specora_stress_uuid('number_sequence', 1), NOW() - (gs || ' seconds')::interval
FROM generate_series(1, $1::int) AS gs
ON CONFLICT (table_name, record_id) DO UPDATE SET number = EXCLUDED.number;
`;

if (import.meta.url === `file://${process.argv[1]}`) {
  seedEnterprisePostgres().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
