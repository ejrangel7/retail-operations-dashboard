import type { Pool } from "pg";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";

function poolWithRows(...rows: unknown[][]) {
  return {
    query: vi.fn().mockImplementation(() =>
      Promise.resolve({ rows: rows.shift() ?? [] }),
    ),
  } as unknown as Pool;
}

describe("Retail Operations API", () => {
  it("reports database health", async () => {
    const pool = poolWithRows([{ now: "2026-08-07T12:00:00.000Z" }]);
    const response = await request(createApp(pool)).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", databaseTime: "2026-08-07T12:00:00.000Z" });
  });

  it("converts dashboard aggregate values to numbers", async () => {
    const pool = poolWithRows(
      [{ count: "8" }],
      [{ count: "5" }],
      [{ total: "1549.95" }],
      [{ count: "2" }],
    );
    const response = await request(createApp(pool)).get("/api/dashboard");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      totalProducts: 8,
      totalOrders: 5,
      revenue: 1549.95,
      lowStockItems: 2,
    });
  });

  it("returns a safe error response when the database fails", async () => {
    const pool = {
      query: vi.fn().mockRejectedValue(new Error("database unavailable")),
    } as unknown as Pool;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await request(createApp(pool)).get("/api/products");
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: "Unexpected server error" });
  });
});
