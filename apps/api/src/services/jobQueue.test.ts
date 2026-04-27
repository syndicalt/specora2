import { describe, it, expect, vi } from "vitest";
import { enqueueJob, claimJob, completeJob, failJob, getJobStatus, getJobQueueSummary, listDeadLetterJobs, listJobs, requeueStaleRunningJobs } from "./jobQueue";

function mockFastify(pgRows: any[] = []) {
  return {
    pg: {
      query: vi.fn().mockResolvedValue({ rows: pgRows, rowCount: pgRows.length }),
      connect: vi.fn().mockResolvedValue({
        query: vi.fn().mockResolvedValue({ rows: pgRows }),
        execute: vi.fn().mockResolvedValue(undefined),
        release: vi.fn(),
      }),
    },
  } as any;
}

describe("jobQueue", () => {
  it("enqueues a job", async () => {
    const fastify = mockFastify([{
      id: "job-1", type: "discovery", payload: {}, status: "pending",
      priority: 5, retries: 0, max_retries: 3, error_message: null,
      worker_id: null, started_at: null, completed_at: null,
      created_at: "2024-01-01", updated_at: "2024-01-01",
    }]);
    const job = await enqueueJob(fastify, "discovery", { file: "test.csv" }, 5);
    expect(job.type).toBe("discovery");
    expect(job.priority).toBe(5);
  });

  it("claims a pending job", async () => {
    const fastify = mockFastify([{
      id: "job-1", type: "discovery", payload: {}, status: "pending",
      priority: 0, retries: 0, max_retries: 3, error_message: null,
      worker_id: null, started_at: null, completed_at: null,
      created_at: "2024-01-01", updated_at: "2024-01-01",
    }]);
    const job = await claimJob(fastify, "worker-1");
    expect(job).not.toBeNull();
    expect(job?.status).toBe("running");
  });

  it("completes a job", async () => {
    const fastify = mockFastify([]);
    await completeJob(fastify, "job-1");
    expect(fastify.pg.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE jobs SET status = 'completed'"),
      ["job-1"]
    );
  });

  it("fails a job with retry", async () => {
    const fastify = mockFastify([{ retries: 0, max_retries: 3 }]);
    await failJob(fastify, "job-1", "timeout");
    expect(fastify.pg.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE jobs SET status = $1"),
      ["pending", 1, "timeout", "job-1"]
    );
  });

  it("fails a job permanently after max retries", async () => {
    const fastify = mockFastify([{ retries: 2, max_retries: 3 }]);
    await failJob(fastify, "job-1", "timeout");
    expect(fastify.pg.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE jobs SET status = $1"),
      ["failed", 3, "timeout", "job-1"]
    );
  });

  it("gets job status", async () => {
    const fastify = mockFastify([{
      id: "job-1", type: "discovery", payload: {}, status: "completed",
      priority: 0, retries: 0, max_retries: 3, error_message: null,
      worker_id: null, started_at: null, completed_at: "2024-01-01",
      created_at: "2024-01-01", updated_at: "2024-01-01",
    }]);
    const job = await getJobStatus(fastify, "job-1");
    expect(job?.status).toBe("completed");
  });

  it("lists jobs with filters", async () => {
    const fastify = mockFastify([{
      id: "job-1", type: "discovery", payload: {}, status: "pending",
      priority: 0, retries: 0, max_retries: 3, error_message: null,
      worker_id: null, started_at: null, completed_at: null,
      created_at: "2024-01-01", updated_at: "2024-01-01",
    }]);
    const jobs = await listJobs(fastify, { status: "pending", type: "discovery" });
    expect(jobs).toHaveLength(1);
  });

  it("summarizes queue health", async () => {
    const calls: any[] = [
      { rows: [{ status: "pending", count: 2 }, { status: "running", count: 1 }], rowCount: 2 },
      { rows: [{ count: 1 }], rowCount: 1 },
      { rows: [{ count: 3 }], rowCount: 1 },
    ];
    const fastify = { pg: { query: vi.fn().mockImplementation(() => Promise.resolve(calls.shift())) } } as any;
    const summary = await getJobQueueSummary(fastify, 10);
    expect(summary.byStatus).toMatchObject({ pending: 2, running: 1 });
    expect(summary.staleRunning).toBe(1);
    expect(summary.deadLetter).toBe(3);
  });

  it("lists dead-letter jobs with bounded limits", async () => {
    const fastify = mockFastify([{
      id: "job-1", type: "discovery", payload: {}, status: "failed",
      priority: 0, retries: 3, max_retries: 3, error_message: "boom",
      worker_id: null, started_at: null, completed_at: null,
      created_at: "2024-01-01", updated_at: "2024-01-01",
    }]);
    const jobs = await listDeadLetterJobs(fastify, 9999);
    expect(jobs[0].status).toBe("failed");
    expect(fastify.pg.query).toHaveBeenCalledWith(expect.stringContaining("status = 'failed'"), [500]);
  });

  it("requeues stale running jobs", async () => {
    const fastify = mockFastify([{
      id: "job-1", type: "discovery", payload: {}, status: "pending",
      priority: 0, retries: 1, max_retries: 3, error_message: "Requeued after stale running timeout",
      worker_id: null, started_at: null, completed_at: null,
      created_at: "2024-01-01", updated_at: "2024-01-01",
    }]);
    const result = await requeueStaleRunningJobs(fastify, 15, 10);
    expect(result.jobs).toHaveLength(1);
    expect(fastify.pg.query).toHaveBeenCalledWith(expect.stringContaining("WITH stale AS"), [15, 10]);
  });
});
