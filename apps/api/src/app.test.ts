import type { Pool } from "pg";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";

function poolWithRows(...rows: unknown[][]) {
  return {
    query: vi.fn().mockImplementation(() => Promise.resolve({ rows: rows.shift() ?? [] })),
  } as unknown as Pool;
}

afterEach(() => vi.restoreAllMocks());

describe("Retail Operations API", () => {
  it("reports database health", async () => {
    const pool = poolWithRows([{ now: "2026-08-07T12:00:00.000Z" }]);
    const response = await request(createApp(pool)).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", databaseTime: "2026-08-07T12:00:00.000Z" });
  });

  it("converts dashboard aggregate values to numbers", async () => {
    const pool = poolWithRows(
      [{ count: "8" }], [{ count: "5" }], [{ total: "1549.95" }], [{ count: "2" }],
    );
    const response = await request(createApp(pool)).get("/api/dashboard");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ totalProducts: 8, totalOrders: 5, revenue: 1549.95, lowStockItems: 2 });
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

    const response = await request(createApp(pool)).get(
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
    const response = await request(createApp(pool)).get("/api/products?stock=low&pageSize=3");
    expect(response.status).toBe(200);
    expect(response.body.pagination).toEqual({ page: 1, pageSize: 3, total: 1, totalPages: 1 });
    expect(vi.mocked(pool.query).mock.calls[0][0]).toContain("stock <= reorder_level");
  });

  it("rejects invalid pagination and filter values before querying", async () => {
    const pool = poolWithRows();
    const invalidPage = await request(createApp(pool)).get("/api/orders?page=0");
    const invalidStock = await request(createApp(pool)).get("/api/products?stock=unknown");
    expect(invalidPage.status).toBe(400);
    expect(invalidStock.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("returns a safe error response when the database fails", async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error("database unavailable")) } as unknown as Pool;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await request(createApp(pool)).get("/api/products");
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: "Unexpected server error" });
  });
});
