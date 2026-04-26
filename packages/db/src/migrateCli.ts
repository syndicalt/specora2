import { baselineMigrations, migrate, getMigrationStatus, readMigrationFiles, type MigrationResult } from "./migrations";

function printResult(result: MigrationResult) {
  const rows = [
    ...result.applied.map((row) => ({ ...row, status: "applied" })),
    ...result.pending.map((row) => ({ ...row, status: "pending" })),
    ...result.failed.map((row) => ({ ...row, status: "failed" })),
    ...result.checksumMismatches.map((row) => ({ ...row, status: "checksum_mismatch" })),
  ].sort((a, b) => a.filename.localeCompare(b.filename));
  for (const row of rows) {
    console.log(`${row.status.padEnd(18)} ${row.filename}`);
  }
  console.log(`applied=${result.applied.length} pending=${result.pending.length} failed=${result.failed.length} checksum_mismatches=${result.checksumMismatches.length}`);
}

async function main() {
  const command = process.argv[2] || "migrate";
  const databaseUrl = process.env.DATABASE_URL || "postgresql://specora:specora123@localhost:5432/specora";
  const pgModule = "pg";
  const { Pool } = await import(pgModule);
  const pool = new Pool({ connectionString: databaseUrl });
  const files = readMigrationFiles();

  try {
    if (command === "status") {
      printResult(await getMigrationStatus(pool, files));
      return;
    }
    if (command === "dry-run" || command === "--dry-run") {
      printResult(await migrate(pool, { files, dryRun: true }));
      return;
    }
    if (command === "baseline") {
      printResult(await baselineMigrations(pool, files));
      return;
    }
    if (command !== "migrate") {
      throw new Error(`Unknown migration command: ${command}`);
    }
    printResult(await migrate(pool, { files }));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
