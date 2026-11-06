import { describe, it, expect, vi } from "vitest";
import request from "supertest";

vi.mock("../src/clients/chroma.js", () => ({ isChromaUp: async () => true }));

import { createApp } from "../src/app.js";

const app = createApp();

describe("CORS", () => {
  it("allows the admin app's origin (default http://localhost:5173)", async () => {
    const res = await request(app)
      .options("/api/v1/admin/documents")
      .set("Origin", "http://localhost:5173")
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "x-admin-key");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(res.headers["access-control-allow-headers"]).toMatch(/x-admin-key/);
  });

  it("does not allow other origins", async () => {
    const res = await request(app).get("/health").set("Origin", "https://evil.example");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("request limits and headers", () => {
  it("rejects a JSON body over 100 KB with 413", async () => {
    const res = await request(app)
      .post("/api/v1/chat/ask")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ question: "x".repeat(150_000) }));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("body_too_large");
  });

  it("doesn't advertise Express", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});
