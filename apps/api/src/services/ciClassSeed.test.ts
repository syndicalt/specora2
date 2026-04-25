import { beforeEach, describe, expect, it, vi } from "vitest";
import { seedCIClasses } from "./ciClassSeed";

function mockPool(existingCount = "0", failOnInsert = false) {
  const release = vi.fn();
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("SELECT COUNT(*)")) {
      return { rows: [{ count: existingCount }] };
    }
    if (failOnInsert && sql.includes("INSERT INTO ci_classes")) {
      throw new Error("insert failed");
    }
    if (sql.includes("INSERT INTO ci_classes")) {
      return { rows: [{ id: `class-${query.mock.calls.length}` }] };
    }
    return { rows: [] };
  });
  return {
    client: { query, release },
    pool: { connect: vi.fn(async () => ({ query, release })) } as any,
  };
}

describe("seedCIClasses", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("does nothing when CI classes already exist", async () => {
    const { pool, client } = mockPool("3");

    await seedCIClasses(pool);

    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("inserts built-in classes and their attributes when empty", async () => {
    const { pool, client } = mockPool("0");

    await seedCIClasses(pool);

    const classInserts = client.query.mock.calls.filter(([sql]) =>
      String(sql).includes("INSERT INTO ci_classes")
    );
    const attrInserts = client.query.mock.calls.filter(([sql]) =>
      String(sql).includes("INSERT INTO ci_class_attributes")
    );

    expect(classInserts).toHaveLength(10);
    expect(attrInserts.length).toBeGreaterThan(30);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("logs and releases the client when seeding fails", async () => {
    const { pool, client } = mockPool("0", true);

    await seedCIClasses(pool);

    expect(console.error).toHaveBeenCalledWith("Failed to seed CI classes:", expect.any(Error));
    expect(client.release).toHaveBeenCalledOnce();
  });
});
