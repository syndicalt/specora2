import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { discoveryRoutes } from "./discovery";

describe("discoveryRoutes", () => {
  async function buildApp() {
    const app = Fastify();
    await app.register(multipart);
    app.decorate("pg", {
      query: vi.fn().mockResolvedValue({ rows: [{ id: "dj-1" }] }),
    });
    await app.register(discoveryRoutes);
    return app;
  }

  it("uploads a file and creates a discovery job", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/discovery/upload",
      headers: {
        "content-type": "multipart/form-data; boundary=----formdata-boundary",
      },
      payload: [
        "------formdata-boundary",
        'Content-Disposition: form-data; name="file"; filename="test.csv"',
        "Content-Type: text/csv",
        "",
        "id,name",
        "1,Test",
        "------formdata-boundary--",
      ].join("\r\n"),
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).status).toBe("pending");
  });

  it("returns 400 when no file is uploaded", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/discovery/upload",
      headers: {
        "content-type": "multipart/form-data; boundary=----formdata-boundary",
      },
      payload: `------formdata-boundary\r\nContent-Disposition: form-data; name="text"\r\n\r\nhello\r\n------formdata-boundary--`,
    });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe("No file uploaded");
  });

  it("returns a discovery job by id", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/discovery/jobs/dj-1",
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).id).toBe("dj-1");
  });

  it("returns 404 for missing job", async () => {
    const app = await buildApp();
    (app.pg.query as any).mockResolvedValueOnce({ rows: [] });
    const response = await app.inject({
      method: "GET",
      url: "/discovery/jobs/missing",
    });
    expect(response.statusCode).toBe(404);
  });
});
