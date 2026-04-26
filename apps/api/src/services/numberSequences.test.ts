import { describe, expect, it, vi } from "vitest";
import { assignRecordNumber, assignRecordNumberToRow } from "./numberSequences";

function fastifyWithClient(client: any) {
  return {
    pg: {
      connect: vi.fn(async () => client),
    },
  } as any;
}

describe("numberSequences", () => {
  it("assigns the next number transactionally and updates the source table", async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("SELECT number FROM record_numbers")) return { rows: [] };
        if (sql.includes("FROM number_sequences")) return { rows: [{ id: "seq-1", prefix: "INC", next_value: 42, padding: 6 }] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const fastify = fastifyWithClient(client);

    const number = await assignRecordNumber(fastify, "incidents", "00000000-0000-4000-8000-000000000001");

    expect(number).toBe("INC000042");
    expect(client.query).toHaveBeenCalledWith("BEGIN");
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("FOR UPDATE"), ["incidents"]);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO record_numbers"), [
      "incidents",
      "00000000-0000-4000-8000-000000000001",
      "INC000042",
      "seq-1",
    ]);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE "incidents" SET number'), ["INC000042", "00000000-0000-4000-8000-000000000001"]);
    expect(client.query).toHaveBeenCalledWith("COMMIT");
  });

  it("returns an existing number without incrementing", async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("SELECT number FROM record_numbers")) return { rows: [{ number: "CHG000007" }] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };

    await expect(assignRecordNumber(fastifyWithClient(client), "change_requests", "00000000-0000-4000-8000-000000000007")).resolves.toBe("CHG000007");
    expect(client.query).not.toHaveBeenCalledWith(expect.stringContaining("UPDATE number_sequences"), expect.anything());
  });

  it("decorates returned rows when a sequence exists", async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("SELECT number FROM record_numbers")) return { rows: [] };
        if (sql.includes("FROM number_sequences")) return { rows: [{ id: "seq-1", prefix: "AST", next_value: 3, padding: 4 }] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };

    const row = await assignRecordNumberToRow(fastifyWithClient(client), "asset_records", { id: "00000000-0000-4000-8000-000000000003", name: "Laptop" });

    expect(row).toMatchObject({ number: "AST0003" });
  });
});
