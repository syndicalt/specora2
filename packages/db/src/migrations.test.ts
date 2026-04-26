import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyMigration,
  baselineMigrations,
  buildMigrationStatus,
  ensureSchemaMigrations,
  getMigrationStatus,
  migrate,
  readMigrationFiles,
  recordFailedMigration,
  type AppliedMigration,
  type MigrationFile,
  type PgLikeClient,
} from "./migrations";

function migration(filename: string, sql: string, checksum = `${filename}-checksum`): MigrationFile {
  return { filename, path: `/migrations/${filename}`, sql, checksum };
}

function clientWithRows(rows: any[] = []): PgLikeClient & { query: ReturnType<typeof vi.fn> } {
  return {
    query: vi.fn(async () => ({ rows })),
  };
}

describe("migration file loading", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loads SQL files in lexical order with stable checksums", () => {
    const dir = join(tmpdir(), `specora-migrations-${Date.now()}`);
    dirs.push(dir);
    mkdirSync(dir);
    writeFileSync(join(dir, "002_second.sql"), "SELECT 2;");
    writeFileSync(join(dir, "001_first.sql"), "SELECT 1;");
    writeFileSync(join(dir, "README.md"), "ignore");

    const files = readMigrationFiles(dir);

    expect(files.map((file) => file.filename)).toEqual(["001_first.sql", "002_second.sql"]);
    expect(files[0].checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(files[0].sql).toBe("SELECT 1;");
  });
});

describe("migration status", () => {
  it("classifies applied, pending, failed, and checksum mismatch migrations", () => {
    const files = [
      migration("001.sql", "SELECT 1;", "same"),
      migration("002.sql", "SELECT 2;", "new"),
      migration("003.sql", "SELECT 3;", "failed-new"),
      migration("004.sql", "SELECT 4;", "local"),
    ];
    const applied = new Map<string, AppliedMigration>([
      ["001.sql", { filename: "001.sql", checksum: "same", status: "applied", duration_ms: 4 }],
      ["003.sql", { filename: "003.sql", checksum: "old-failed", status: "failed", error: "boom" }],
      ["004.sql", { filename: "004.sql", checksum: "remote", status: "applied" }],
    ]);

    const rows = buildMigrationStatus(files, applied);

    expect(rows.map((row) => row.status)).toEqual(["applied", "pending", "failed", "checksum_mismatch"]);
    expect(rows[3]).toMatchObject({ appliedChecksum: "remote", error: "Applied migration checksum does not match the local file" });
  });

  it("ensures the tracking table before reading applied migrations", async () => {
    const client = clientWithRows([{ filename: "001.sql", checksum: "c1", status: "applied" }]);

    const status = await getMigrationStatus(client, [migration("001.sql", "SELECT 1;", "c1")]);

    expect(status.applied).toHaveLength(1);
    expect(client.query).toHaveBeenNthCalledWith(1, expect.stringContaining("CREATE TABLE IF NOT EXISTS schema_migrations"));
    expect(client.query).toHaveBeenNthCalledWith(2, expect.stringContaining("SELECT filename, checksum"));
  });
});

describe("migration application", () => {
  it("applies a migration inside a transaction and records success", async () => {
    const client = clientWithRows();
    const result = await applyMigration(client, migration("001.sql", "CREATE TABLE test(id int);", "c1"));

    expect(result).toMatchObject({ filename: "001.sql", status: "applied" });
    expect(client.query).toHaveBeenNthCalledWith(1, "BEGIN");
    expect(client.query).toHaveBeenNthCalledWith(2, "CREATE TABLE test(id int);");
    expect(client.query).toHaveBeenNthCalledWith(3, expect.stringContaining("INSERT INTO schema_migrations"), ["001.sql", "c1", expect.any(Number)]);
    expect(client.query).toHaveBeenNthCalledWith(4, "COMMIT");
  });

  it("rolls back, records failure, and rethrows when SQL fails", async () => {
    const error = new Error("bad sql");
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === "BROKEN;") throw error;
        return { rows: [] };
      }),
    };

    await expect(applyMigration(client, migration("002.sql", "BROKEN;", "c2"))).rejects.toThrow("bad sql");
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("status = 'failed'"), ["002.sql", "c2", expect.any(Number), "bad sql"]);
  });

  it("records non-Error failures as strings", async () => {
    const client = clientWithRows();
    await recordFailedMigration(client, migration("003.sql", "SELECT 3;", "c3"), 12, "string failure");

    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("status = 'failed'"), ["003.sql", "c3", 12, "string failure"]);
  });

  it("does not apply migrations in dry-run mode", async () => {
    const client = clientWithRows();
    const result = await migrate(client, { files: [migration("001.sql", "SELECT 1;")], dryRun: true });

    expect(result.pending).toHaveLength(1);
    expect(client.query).not.toHaveBeenCalledWith("BEGIN");
  });

  it("uses the default migration directory when files are not injected", async () => {
    const client = clientWithRows();
    const result = await migrate(client, { dryRun: true });

    expect(result.pending.length).toBeGreaterThan(0);
    expect(result.pending[0].filename).toMatch(/\.sql$/);
  });

  it("applies failed and pending migrations in filename order", async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("SELECT filename")) {
          return { rows: [{ filename: "002.sql", checksum: "old", status: "failed", error: "previous failure" }] };
        }
        return { rows: [] };
      }),
    };
    const files = [
      migration("003.sql", "SELECT 3;", "c3"),
      migration("001.sql", "SELECT 1;", "c1"),
      migration("002.sql", "SELECT 2;", "c2"),
    ];

    const result = await migrate(client, { files });

    expect(result.pending).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
    expect(client.query.mock.calls.filter(([sql]) => sql === "BEGIN")).toHaveLength(3);
    const appliedSql = client.query.mock.calls.filter(([sql]) => /^SELECT \d;/.test(String(sql)));
    expect(appliedSql.map(([sql]) => sql)).toEqual(["SELECT 1;", "SELECT 2;", "SELECT 3;"]);
  });

  it("fails before applying when an applied migration checksum changed", async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("SELECT filename")) {
          return { rows: [{ filename: "001.sql", checksum: "old", status: "applied" }] };
        }
        return { rows: [] };
      }),
    };

    await expect(migrate(client, { files: [migration("001.sql", "SELECT 1;", "new")] })).rejects.toThrow("Migration checksum mismatch: 001.sql");
    expect(client.query).not.toHaveBeenCalledWith("BEGIN");
  });

  it("baselines pending and failed migrations without executing SQL files", async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("SELECT filename")) {
          return { rows: [{ filename: "002.sql", checksum: "old", status: "failed", error: "previous failure" }] };
        }
        return { rows: [] };
      }),
    };

    const result = await baselineMigrations(client, [
      migration("001.sql", "SELECT 1;", "c1"),
      migration("002.sql", "SELECT 2;", "c2"),
    ]);

    expect(result.applied).toHaveLength(2);
    expect(result.pending).toHaveLength(0);
    expect(client.query).not.toHaveBeenCalledWith("BEGIN");
    expect(client.query).not.toHaveBeenCalledWith("SELECT 1;");
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("duration_ms, error, updated_at"), ["001.sql", "c1"]);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("duration_ms, error, updated_at"), ["002.sql", "c2"]);
  });

  it("does not baseline when an applied migration checksum changed", async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("SELECT filename")) {
          return { rows: [{ filename: "001.sql", checksum: "old", status: "applied" }] };
        }
        return { rows: [] };
      }),
    };

    await expect(baselineMigrations(client, [migration("001.sql", "SELECT 1;", "new")])).rejects.toThrow("Migration checksum mismatch: 001.sql");
    expect(client.query).not.toHaveBeenCalledWith(expect.stringContaining("ON CONFLICT (filename) DO UPDATE SET"), expect.any(Array));
  });

  it("can ensure the migration table directly", async () => {
    const client = clientWithRows();
    await ensureSchemaMigrations(client);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("schema_migrations"));
  });
});
