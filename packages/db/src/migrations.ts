import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

export type MigrationStatus = "applied" | "pending" | "failed" | "checksum_mismatch";

export type MigrationFile = {
  filename: string;
  path: string;
  checksum: string;
  sql: string;
};

export type AppliedMigration = {
  filename: string;
  checksum: string;
  status: "applied" | "failed";
  applied_at?: unknown;
  duration_ms?: number | null;
  error?: string | null;
};

export type MigrationStatusRow = {
  filename: string;
  checksum: string;
  status: MigrationStatus;
  appliedChecksum?: string;
  appliedAt?: unknown;
  durationMs?: number | null;
  error?: string | null;
};

export type MigrationResult = {
  applied: MigrationStatusRow[];
  pending: MigrationStatusRow[];
  failed: MigrationStatusRow[];
  checksumMismatches: MigrationStatusRow[];
};

export type PgLikeClient = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

export const SCHEMA_MIGRATIONS_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('applied', 'failed')),
  applied_at TIMESTAMPTZ,
  duration_ms INTEGER,
  error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`;

function checksum(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

export function readMigrationFiles(migrationsDir = join(__dirname, "../migrations")): MigrationFile[] {
  return readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((filename) => {
      const path = join(migrationsDir, filename);
      const sql = readFileSync(path, "utf8");
      return { filename: basename(filename), path, sql, checksum: checksum(sql) };
    });
}

export async function ensureSchemaMigrations(client: PgLikeClient) {
  await client.query(SCHEMA_MIGRATIONS_SQL);
}

export async function loadAppliedMigrations(client: PgLikeClient) {
  await ensureSchemaMigrations(client);
  const result = await client.query(
    "SELECT filename, checksum, status, applied_at, duration_ms, error FROM schema_migrations ORDER BY filename"
  );
  return new Map<string, AppliedMigration>(
    result.rows.map((row) => [row.filename, {
      filename: row.filename,
      checksum: row.checksum,
      status: row.status,
      applied_at: row.applied_at,
      duration_ms: row.duration_ms,
      error: row.error,
    }])
  );
}

export function buildMigrationStatus(files: MigrationFile[], applied: Map<string, AppliedMigration>): MigrationStatusRow[] {
  return files.map((file) => {
    const row = applied.get(file.filename);
    if (!row) return { filename: file.filename, checksum: file.checksum, status: "pending" };
    if (row.status === "applied" && row.checksum !== file.checksum) {
      return {
        filename: file.filename,
        checksum: file.checksum,
        appliedChecksum: row.checksum,
        appliedAt: row.applied_at,
        durationMs: row.duration_ms,
        error: "Applied migration checksum does not match the local file",
        status: "checksum_mismatch",
      };
    }
    return {
      filename: file.filename,
      checksum: file.checksum,
      appliedChecksum: row.checksum,
      appliedAt: row.applied_at,
      durationMs: row.duration_ms,
      error: row.error,
      status: row.status === "failed" ? "failed" : "applied",
    };
  });
}

export async function getMigrationStatus(client: PgLikeClient, files = readMigrationFiles()): Promise<MigrationResult> {
  const rows = buildMigrationStatus(files, await loadAppliedMigrations(client));
  return {
    applied: rows.filter((row) => row.status === "applied"),
    pending: rows.filter((row) => row.status === "pending"),
    failed: rows.filter((row) => row.status === "failed"),
    checksumMismatches: rows.filter((row) => row.status === "checksum_mismatch"),
  };
}

export async function recordFailedMigration(client: PgLikeClient, file: MigrationFile, durationMs: number, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  await client.query(
    `INSERT INTO schema_migrations (filename, checksum, status, applied_at, duration_ms, error, updated_at)
     VALUES ($1, $2, 'failed', NULL, $3, $4, NOW())
     ON CONFLICT (filename) DO UPDATE SET
       checksum = EXCLUDED.checksum,
       status = 'failed',
       applied_at = NULL,
       duration_ms = EXCLUDED.duration_ms,
       error = EXCLUDED.error,
       updated_at = NOW()`,
    [file.filename, file.checksum, durationMs, message]
  );
}

export async function applyMigration(client: PgLikeClient, file: MigrationFile): Promise<MigrationStatusRow> {
  const start = Date.now();
  try {
    await client.query("BEGIN");
    await client.query(file.sql);
    const durationMs = Date.now() - start;
    await client.query(
      `INSERT INTO schema_migrations (filename, checksum, status, applied_at, duration_ms, error, updated_at)
       VALUES ($1, $2, 'applied', NOW(), $3, NULL, NOW())
       ON CONFLICT (filename) DO UPDATE SET
         checksum = EXCLUDED.checksum,
         status = 'applied',
         applied_at = NOW(),
         duration_ms = EXCLUDED.duration_ms,
         error = NULL,
         updated_at = NOW()`,
      [file.filename, file.checksum, durationMs]
    );
    await client.query("COMMIT");
    return { filename: file.filename, checksum: file.checksum, status: "applied", durationMs };
  } catch (error) {
    const durationMs = Date.now() - start;
    await client.query("ROLLBACK");
    await recordFailedMigration(client, file, durationMs, error);
    throw error;
  }
}

export async function migrate(client: PgLikeClient, options: { files?: MigrationFile[]; dryRun?: boolean } = {}): Promise<MigrationResult> {
  const files = options.files || readMigrationFiles();
  const status = await getMigrationStatus(client, files);
  if (status.checksumMismatches.length) {
    throw new Error(`Migration checksum mismatch: ${status.checksumMismatches.map((row) => row.filename).join(", ")}`);
  }
  if (options.dryRun) return status;

  const applied: MigrationStatusRow[] = [];
  for (const row of [...status.failed, ...status.pending].sort((a, b) => a.filename.localeCompare(b.filename))) {
    const file = files.find((candidate) => candidate.filename === row.filename)!;
    applied.push(await applyMigration(client, file));
  }

  return {
    applied: [...status.applied, ...applied],
    pending: [],
    failed: [],
    checksumMismatches: [],
  };
}

export async function baselineMigrations(client: PgLikeClient, files = readMigrationFiles()): Promise<MigrationResult> {
  const status = await getMigrationStatus(client, files);
  if (status.checksumMismatches.length) {
    throw new Error(`Migration checksum mismatch: ${status.checksumMismatches.map((row) => row.filename).join(", ")}`);
  }

  const rows = [...status.failed, ...status.pending].sort((a, b) => a.filename.localeCompare(b.filename));
  for (const row of rows) {
    const file = files.find((candidate) => candidate.filename === row.filename)!;
    await client.query(
      `INSERT INTO schema_migrations (filename, checksum, status, applied_at, duration_ms, error, updated_at)
       VALUES ($1, $2, 'applied', NOW(), 0, NULL, NOW())
       ON CONFLICT (filename) DO UPDATE SET
         checksum = EXCLUDED.checksum,
         status = 'applied',
         applied_at = COALESCE(schema_migrations.applied_at, NOW()),
         duration_ms = COALESCE(schema_migrations.duration_ms, 0),
         error = NULL,
         updated_at = NOW()`,
      [file.filename, file.checksum]
    );
  }

  return {
    applied: [...status.applied, ...rows.map((row) => ({ ...row, status: "applied" as const, durationMs: 0 }))],
    pending: [],
    failed: [],
    checksumMismatches: [],
  };
}
