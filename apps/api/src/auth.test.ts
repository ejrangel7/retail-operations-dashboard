import { scryptSync } from "node:crypto";
import type { Pool } from "pg";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";

function poolWithRows(...rows: unknown[][]) {
  return {
    query: vi.fn().mockImplementation(() => Promise.resolve({ rows: rows.shift() ?? [] })),
  } as unknown as Pool;
}

const operator = {
  id: 1,
  email: "operator@retail.local",
  displayName: "Operations Manager",
  role: "operator",
};

const viewer = {
  id: 2,
  email: "viewer@retail.local",
  displayName: "Reporting Viewer",
  role: "viewer",
};

describe("authentication and authorization", () => {
  it("creates an HTTP-only session for valid credentials", async () => {
    const salt = "0123456789abcdef0123456789abcdef";
    const passwordHash = scryptSync("RetailOps!2026", salt, 64).toString("hex");
    const pool = poolWithRows([{ ...operator, passwordSalt: salt, passwordHash }], [], []);

    const response = await request(createApp(pool, { secureCookies: false }))
      .post("/api/auth/login")
      .send({ email: "OPERATOR@RETAIL.LOCAL", password: "RetailOps!2026" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(operator);
    expect(response.headers["set-cookie"][0]).toContain("retail_session=");
    expect(response.headers["set-cookie"][0]).toContain("HttpOnly");
    expect(response.headers["set-cookie"][0]).toContain("SameSite=Lax");
    expect(response.headers["set-cookie"][0]).not.toContain("Secure");
    expect(vi.mocked(pool.query).mock.calls[0][1]).toEqual(["operator@retail.local"]);
    expect(vi.mocked(pool.query)).toHaveBeenCalledTimes(3);
  });

  it("rejects invalid credentials without creating a session", async () => {
    const salt = "0123456789abcdef0123456789abcdef";
    const passwordHash = scryptSync("RetailOps!2026", salt, 64).toString("hex");
    const pool = poolWithRows([{ ...operator, passwordSalt: salt, passwordHash }]);

    const response = await request(createApp(pool)).post("/api/auth/login").send({
      email: operator.email,
      password: "incorrect",
    });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: "Invalid email or password" });
    expect(vi.mocked(pool.query)).toHaveBeenCalledTimes(1);
  });

  it("returns the current user for an active session", async () => {
    const pool = poolWithRows([operator]);
    const response = await request(createApp(pool))
      .get("/api/auth/me")
      .set("Cookie", "retail_session=test-token");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(operator);
    expect(vi.mocked(pool.query).mock.calls[0][0]).toContain("sessions.expires_at > NOW()");
  });

  it("protects operational data when no session is present", async () => {
    const pool = poolWithRows();
    const response = await request(createApp(pool)).get("/api/dashboard");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: "Authentication required" });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("prevents viewers from creating orders", async () => {
    const pool = poolWithRows([viewer]);
    const response = await request(createApp(pool))
      .post("/api/orders")
      .set("Cookie", "retail_session=viewer-token")
      .send({
        orderNumber: "BT-1050",
        customerName: "Sample Customer",
        status: "processing",
        total: 25,
      });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: "You do not have permission to perform this action" });
    expect(vi.mocked(pool.query)).toHaveBeenCalledTimes(1);
  });

  it("allows operators to create orders", async () => {
    const created = {
      id: 6,
      orderNumber: "BT-1050",
      customerName: "Sample Customer",
      status: "processing",
      total: 25,
      createdAt: "2026-08-09T12:00:00.000Z",
    };
    const pool = poolWithRows([operator], [created]);
    const response = await request(createApp(pool))
      .post("/api/orders")
      .set("Cookie", "retail_session=operator-token")
      .send({
        orderNumber: "BT-1050",
        customerName: "Sample Customer",
        status: "processing",
        total: 25,
      });

    expect(response.status).toBe(201);
    expect(response.body).toEqual(created);
    expect(vi.mocked(pool.query)).toHaveBeenCalledTimes(2);
  });

  it("deletes the server-side session during logout", async () => {
    const pool = poolWithRows([]);
    const response = await request(createApp(pool))
      .post("/api/auth/logout")
      .set("Cookie", "retail_session=test-token");

    expect(response.status).toBe(204);
    expect(response.headers["set-cookie"][0]).toContain("retail_session=;");
    expect(vi.mocked(pool.query)).toHaveBeenCalledTimes(1);
  });
});
