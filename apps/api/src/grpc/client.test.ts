import { describe, it, expect } from "vitest";
import { workerClient } from "../grpc/client";

describe("workerClient", () => {
  it("exports promisified client methods", () => {
    expect(typeof workerClient.ingestCMDB).toBe("function");
    expect(typeof workerClient.runGraphMaintenance).toBe("function");
  });
});
