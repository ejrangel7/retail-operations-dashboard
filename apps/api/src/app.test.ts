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
      sku: "TOTE-NAT",
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

  it("creates a validated order", async () => {
    const created = {
      id: 6,
      orderNumber: "BT-1049",
      customerName: "Sample Customer F",
      sku: "TEE-BLK-M",
      status: "processing",
      total: 84.5,
      createdAt: "2026-08-08T12:00:00.000Z",
    };
    const pool = poolWithRows([created]);

    const response = await request(createApp(pool)).post("/api/orders").send({
      orderNumber: "BT-1049",
      customerName: "Sample Customer F",
      sku: "tee-blk-m",
      status: "processing",
      total: 84.5,
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual(created);
    expect(vi.mocked(pool.query).mock.calls[0][1]).toEqual([
      "BT-1049", "Sample Customer F", "TEE-BLK-M", "processing", 84.5,
    ]);
  });

  it("rejects invalid and duplicate orders", async () => {
    const invalidPool = poolWithRows();
    const invalid = await request(createApp(invalidPool)).post("/api/orders").send({
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
    const duplicate = await request(createApp(duplicatePool)).post("/api/orders").send({
      orderNumber: "BT-1049",
      customerName: "Sample Customer F",
      sku: "TEE-BLK-M",
      status: "processing",
      total: 84.5,
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body).toEqual({ message: "An order with this number already exists" });
  });

  it("rejects malformed and unknown SKUs", async () => {
    const malformedPool = poolWithRows();
    const malformed = await request(createApp(malformedPool)).post("/api/orders").send({
      orderNumber: "BT-1050", customerName: "Sample Customer G", sku: "bad sku",
      status: "processing", total: 25,
    });
    expect(malformed.status).toBe(400);
    expect(malformedPool.query).not.toHaveBeenCalled();

    const unknownPool = {
      query: vi.fn().mockRejectedValue(Object.assign(new Error("foreign key"), { code: "23503" })),
    } as unknown as Pool;
    const unknown = await request(createApp(unknownPool)).post("/api/orders").send({
      orderNumber: "BT-1050", customerName: "Sample Customer G", sku: "SKU-999",
      status: "processing", total: 25,
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body).toEqual({ message: "SKU does not exist in inventory" });
  });

  it("updates an order fulfillment status", async () => {
    const updated = {
      id: 3,
      orderNumber: "BT-1046",
      customerName: "Sample Customer C",
      sku: "TOTE-NAT",
      status: "shipped",
      total: 69,
      createdAt: "2026-08-06T12:00:00.000Z",
    };
    const pool = poolWithRows([updated]);
    const response = await request(createApp(pool)).patch("/api/orders/3").send({ status: "shipped" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(updated);
    expect(vi.mocked(pool.query).mock.calls[0][1]).toEqual(["shipped", 3]);
  });

  it("returns validation and not-found responses for order updates", async () => {
    const invalidPool = poolWithRows();
    const invalid = await request(createApp(invalidPool)).patch("/api/orders/not-a-number").send({ status: "unknown" });
    expect(invalid.status).toBe(400);
    expect(invalidPool.query).not.toHaveBeenCalled();

    const missingPool = poolWithRows([]);
    const missing = await request(createApp(missingPool)).patch("/api/orders/999").send({ status: "delivered" });
    expect(missing.status).toBe(404);
  });

  it("returns a safe error response when the database fails", async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error("database unavailable")) } as unknown as Pool;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await request(createApp(pool)).get("/api/products");
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: "Unexpected server error" });
  });
});
