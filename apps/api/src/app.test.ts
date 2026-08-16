import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pool } from "pg";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";

const createTestApp = (pool: Pool) => createApp(pool, { authRequired: false });

function poolWithRows(...rows: unknown[][]) {
  return {
    query: vi.fn().mockImplementation(() => Promise.resolve({ rows: rows.shift() ?? [] })),
  } as unknown as Pool;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Retail Operations API", () => {
  it("reports database health", async () => {
    const pool = poolWithRows([{ now: "2026-08-07T12:00:00.000Z" }]);
    const response = await request(createTestApp(pool)).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", databaseTime: "2026-08-07T12:00:00.000Z" });
    expect(response.headers).not.toHaveProperty("strict-transport-security");
    expect(response.headers["content-security-policy"]).not.toContain("upgrade-insecure-requests");
    expect(response.headers).not.toHaveProperty("x-powered-by");
  });

  it("rate-limits public database health checks", async () => {
    const now = "2026-08-07T12:00:00.000Z";
    const pool = poolWithRows(...Array.from({ length: 60 }, () => [{ now }]));
    const app = createApp(pool, { authRequired: false, rateLimitsEnabled: true, trustProxyHops: 1 });

    for (let attempt = 0; attempt < 60; attempt += 1) {
      const response = await request(app)
        .get("/api/health")
        .set("X-Forwarded-For", "203.0.113.20");
      expect(response.status).toBe(200);
    }

    const limited = await request(app)
      .get("/api/health")
      .set("X-Forwarded-For", "203.0.113.20");
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ message: "Too many health checks. Please try again later." });
    expect(limited.headers["ratelimit"]).toContain("health-check");
    expect(vi.mocked(pool.query)).toHaveBeenCalledTimes(60);
  });

  it("applies a global limit before protected API work", async () => {
    const pool = poolWithRows();
    const app = createApp(pool, { rateLimitsEnabled: true, trustProxyHops: 1 });

    for (let attempt = 0; attempt < 300; attempt += 1) {
      const response = await request(app)
        .get("/api/dashboard")
        .set("X-Forwarded-For", "203.0.113.21");
      expect(response.status).toBe(401);
    }

    const limited = await request(app)
      .get("/api/dashboard")
      .set("X-Forwarded-For", "203.0.113.21");
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ message: "Too many API requests. Please try again later." });
    expect(limited.headers["ratelimit"]).toContain("global-api");
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("sets production security headers and allows Render's own origin", async () => {
    const origin = "https://retail-operations-dashboard.onrender.com";
    vi.stubEnv("RENDER_EXTERNAL_URL", origin);
    const pool = poolWithRows([{ now: "2026-08-07T12:00:00.000Z" }]);

    const response = await request(createApp(pool, {
      authRequired: false,
      isProduction: true,
      rateLimitsEnabled: false,
    }))
      .get("/api/health")
      .set("Origin", origin);

    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe(origin);
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
    expect(response.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(response.headers["content-security-policy"]).toContain("upgrade-insecure-requests");
    expect(response.headers["strict-transport-security"]).toContain("max-age=31536000");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(response.headers).not.toHaveProperty("x-powered-by");
  });

  it("does not authorize an untrusted cross-origin request", async () => {
    vi.stubEnv("RENDER_EXTERNAL_URL", "https://retail-operations-dashboard.onrender.com");

    const response = await request(createApp(poolWithRows(), {
      authRequired: false,
      isProduction: true,
      rateLimitsEnabled: false,
    }))
      .options("/api/auth/login")
      .set("Origin", "https://untrusted.example")
      .set("Access-Control-Request-Method", "POST");

    expect(response.headers).not.toHaveProperty("access-control-allow-origin");
    expect(response.headers).not.toHaveProperty("access-control-allow-credentials");
  });

  it("converts dashboard aggregate values to numbers", async () => {
    const pool = poolWithRows(
      [{ count: "8" }], [{ count: "5" }], [{ total: "1549.95" }], [{ count: "2" }],
    );
    const response = await request(createTestApp(pool)).get("/api/dashboard");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ totalProducts: 8, totalOrders: 5, revenue: 1549.95, lowStockItems: 2 });
  });

  it("returns accessible operations reporting aggregates", async () => {
    const orderStatus = [
      { status: "processing", orderCount: 2, revenue: 77 },
      { status: "shipped", orderCount: 1, revenue: 42 },
      { status: "delivered", orderCount: 2, revenue: 145 },
    ];
    const inventoryByCategory = [
      { category: "Accessories", productCount: 2, stockUnits: 43, lowStockItems: 0 },
      { category: "Apparel", productCount: 2, stockUnits: 50, lowStockItems: 1 },
    ];
    const pool = poolWithRows(orderStatus, inventoryByCategory);

    const response = await request(createTestApp(pool)).get("/api/reports/operations");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ orderStatus, inventoryByCategory });
    expect(vi.mocked(pool.query).mock.calls[0][0]).toContain("WITH statuses");
    expect(vi.mocked(pool.query).mock.calls[1][0]).toContain("GROUP BY category");
  });

  it("rate-limits the operations report separately from other reads", async () => {
    const pool = poolWithRows(...Array.from({ length: 60 }, () => []));
    const app = createApp(pool, { authRequired: false, rateLimitsEnabled: true, trustProxyHops: 1 });

    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await request(app)
        .get("/api/reports/operations")
        .set("X-Forwarded-For", "203.0.113.22");
      expect(response.status).toBe(200);
    }

    const limited = await request(app)
      .get("/api/reports/operations")
      .set("X-Forwarded-For", "203.0.113.22");
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ message: "Too many report requests. Please try again later." });
    expect(limited.headers["ratelimit"]).toContain("operations-report");
    expect(vi.mocked(pool.query)).toHaveBeenCalledTimes(60);
  });

  it("filters and paginates orders with parameterized queries", async () => {
    const order = {
      id: 3,
      orderNumber: "BT-1046",
      customerName: "Sample Customer C",
      status: "shipped",
      total: 69,
      createdAt: "2026-08-06T12:00:00.000Z",
    };
    const pool = poolWithRows([{ count: "3" }], [order]);

    const response = await request(createTestApp(pool)).get(
      "/api/orders?page=2&pageSize=2&search=sample&status=shipped",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      items: [order],
      pagination: { page: 2, pageSize: 2, total: 3, totalPages: 2 },
    });
    const query = vi.mocked(pool.query);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][1]).toEqual(["%sample%", "shipped"]);
    expect(query.mock.calls[1][1]).toEqual(["%sample%", "shipped", 2, 2]);
    expect(query.mock.calls[1][0]).toContain("status = $2");
  });

  it("filters low-stock products", async () => {
    const pool = poolWithRows([{ count: "1" }], []);
    const response = await request(createTestApp(pool)).get("/api/products?stock=low&pageSize=3");
    expect(response.status).toBe(200);
    expect(response.body.pagination).toEqual({ page: 1, pageSize: 3, total: 1, totalPages: 1 });
    expect(vi.mocked(pool.query).mock.calls[0][0]).toContain("stock <= reorder_level");
  });

  it("rejects invalid pagination and filter values before querying", async () => {
    const pool = poolWithRows();
    const invalidPage = await request(createTestApp(pool)).get("/api/orders?page=0");
    const invalidStock = await request(createTestApp(pool)).get("/api/products?stock=unknown");
    expect(invalidPage.status).toBe(400);
    expect(invalidStock.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("creates a validated order", async () => {
    const created = {
      id: 6,
      orderNumber: "BT-1049",
      customerName: "Sample Customer F",
      status: "processing",
      total: 84.5,
      createdAt: "2026-08-08T12:00:00.000Z",
    };
    const pool = poolWithRows([created]);

    const response = await request(createTestApp(pool)).post("/api/orders").send({
      orderNumber: "BT-1049",
      customerName: "Sample Customer F",
      status: "processing",
      total: 84.5,
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual(created);
    expect(vi.mocked(pool.query).mock.calls[0][1]).toEqual([
      "BT-1049", "Sample Customer F", "processing", 84.5,
    ]);
  });

  it("requires order numbers in BT-0000 format", async () => {
    const pool = poolWithRows();
    const response = await request(createTestApp(pool)).post("/api/orders").send({
      orderNumber: "ORD-1049", customerName: "Sample Customer F",
      status: "processing", total: 84.5,
    });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: "orderNumber must use the format BT-0000" });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("rejects invalid and duplicate orders", async () => {
    const invalidPool = poolWithRows();
    const invalid = await request(createTestApp(invalidPool)).post("/api/orders").send({
      orderNumber: "!",
      customerName: "",
      status: "unknown",
      total: -1,
    });
    expect(invalid.status).toBe(400);
    expect(invalidPool.query).not.toHaveBeenCalled();

    const duplicatePool = {
      query: vi.fn().mockRejectedValue(Object.assign(new Error("duplicate"), { code: "23505" })),
    } as unknown as Pool;
    const duplicate = await request(createTestApp(duplicatePool)).post("/api/orders").send({
      orderNumber: "BT-1049",
      customerName: "Sample Customer F",
      status: "processing",
      total: 84.5,
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body).toEqual({ message: "An order with this number already exists" });
  });

  it("updates an order fulfillment status", async () => {
    const updated = {
      id: 3,
      orderNumber: "BT-1046",
      customerName: "Sample Customer C",
      status: "shipped",
      total: 69,
      createdAt: "2026-08-06T12:00:00.000Z",
    };
    const pool = poolWithRows([updated]);
    const response = await request(createTestApp(pool)).patch("/api/orders/3").send({ status: "shipped" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(updated);
    expect(vi.mocked(pool.query).mock.calls[0][1]).toEqual(["shipped", 3]);
  });

  it("returns validation and not-found responses for order updates", async () => {
    const invalidPool = poolWithRows();
    const invalid = await request(createTestApp(invalidPool)).patch("/api/orders/not-a-number").send({ status: "unknown" });
    expect(invalid.status).toBe(400);
    expect(invalidPool.query).not.toHaveBeenCalled();

    const missingPool = poolWithRows([]);
    const missing = await request(createTestApp(missingPool)).patch("/api/orders/999").send({ status: "delivered" });
    expect(missing.status).toBe(404);
  });

  it("serves the production frontend without masking unknown API routes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "retail-static-"));
    try {
      await writeFile(join(directory, "index.html"), "<main>Retail production shell</main>");
      const app = createApp(poolWithRows(), { authRequired: false, staticAssetsPath: directory });

      const frontend = await request(app).get("/reports");
      const missingApi = await request(app).get("/api/missing");

      expect(frontend.status).toBe(200);
      expect(frontend.text).toContain("Retail production shell");
      expect(missingApi.status).toBe(404);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("returns a safe error response when the database fails", async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error("database unavailable")) } as unknown as Pool;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await request(createTestApp(pool)).get("/api/products");
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: "Unexpected server error" });
  });
});
