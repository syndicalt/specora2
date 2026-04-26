import type { FastifyInstance } from "fastify";

function quoteIdentifier(value: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) throw new Error("Invalid SQL identifier");
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function formatNumber(prefix: string, value: number, padding: number) {
  return `${prefix}${String(value).padStart(Math.max(padding, 0), "0")}`;
}

export async function assignRecordNumber(fastify: FastifyInstance, tableName: string, recordId: string) {
  const client = await fastify.pg.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      "SELECT number FROM record_numbers WHERE table_name = $1 AND record_id = $2",
      [tableName, recordId]
    );
    if (existing.rows.length) {
      await client.query("COMMIT");
      return existing.rows[0].number as string;
    }

    const sequence = await client.query(
      `SELECT id, prefix, next_value, padding
       FROM number_sequences
       WHERE table_name = $1 AND enabled = TRUE
       FOR UPDATE`,
      [tableName]
    );
    if (!sequence.rows.length) {
      await client.query("COMMIT");
      return null;
    }

    const row = sequence.rows[0];
    const current = Number(row.next_value);
    const number = formatNumber(row.prefix, current, Number(row.padding));
    await client.query("UPDATE number_sequences SET next_value = next_value + 1, updated_at = NOW() WHERE id = $1", [row.id]);
    await client.query(
      "INSERT INTO record_numbers (table_name, record_id, number, sequence_id) VALUES ($1, $2, $3, $4)",
      [tableName, recordId, number, row.id]
    );
    try {
      await client.query(`UPDATE ${quoteIdentifier(tableName)} SET number = $1 WHERE id = $2`, [number, recordId]);
    } catch (err: any) {
      if (err?.code !== "42703") throw err;
    }
    await client.query("COMMIT");
    return number;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function assignRecordNumberToRow<T extends Record<string, any>>(fastify: FastifyInstance, tableName: string, row: T): Promise<T> {
  if (!row?.id || row.number) return row;
  if (typeof (fastify.pg as any).connect !== "function") return row;
  const number = await assignRecordNumber(fastify, tableName, String(row.id));
  return number ? { ...row, number } : row;
}
