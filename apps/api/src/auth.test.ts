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

  it("blocks operator sign-in when the public demo disables it", async () => {
    const salt = "0123456789abcdef0123456789abcdef";
    const passwordHash = scryptSync("RetailOps!2026", salt, 64).toString("hex");
    const pool = poolWithRows([{ ...operator, passwordSalt: salt, passwordHash }]);

    const response = await request(createApp(pool, {
      operatorLoginEnabled: false,
      rateLimitsEnabled: false,
    }))
      .post("/api/auth/login")
      .send({ email: operator.email, password: "RetailOps!2026" });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: "Operator sign-in is disabled in the public demo" });
    expect(vi.mocked(pool.query)).toHaveBeenCalledTimes(1);
  });

  it("disables operator sign-in by default in production", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousOperatorSetting = process.env.OPERATOR_LOGIN_ENABLED;
    process.env.NODE_ENV = "production";
    delete process.env.OPERATOR_LOGIN_ENABLED;

    try {
      const salt = "0123456789abcdef0123456789abcdef";
      const passwordHash = scryptSync("RetailOps!2026", salt, 64).toString("hex");
      const pool = poolWithRows([{ ...operator, passwordSalt: salt, passwordHash }]);

      const response = await request(createApp(pool, { rateLimitsEnabled: false }))
        .post("/api/auth/login")
        .send({ email: operator.email, password: "RetailOps!2026" });

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ message: "Operator sign-in is disabled in the public demo" });
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousOperatorSetting === undefined) delete process.env.OPERATOR_LOGIN_ENABLED;
      else process.env.OPERATOR_LOGIN_ENABLED = previousOperatorSetting;
    }
  });

  it("keeps viewer sign-in available in the public demo", async () => {
    const salt = "abcdef0123456789abcdef0123456789";
    const passwordHash = scryptSync("RetailView!2026", salt, 64).toString("hex");
    const pool = poolWithRows([{ ...viewer, passwordSalt: salt, passwordHash }], [], []);

    const response = await request(createApp(pool, {
      operatorLoginEnabled: false,
      rateLimitsEnabled: false,
    }))
      .post("/api/auth/login")
      .send({ email: viewer.email, password: "RetailView!2026" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(viewer);
    expect(vi.mocked(pool.query)).toHaveBeenCalledTimes(3);
  });

  it("blocks order changes from an existing operator session in the public demo", async () => {
    const pool = poolWithRows([operator]);

    const response = await request(createApp(pool, {
      operatorLoginEnabled: false,
      rateLimitsEnabled: false,
    }))
      .post("/api/orders")
      .set("Cookie", "retail_session=operator-token")
      .send({
        orderNumber: "BT-1050",
        customerName: "Sample Customer",
        status: "processing",
        total: 25,
      });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: "Order changes are disabled in the public demo" });
    expect(vi.mocked(pool.query)).toHaveBeenCalledTimes(1);
  });

  it("rate-limits repeated failed sign-in attempts", async () => {
    const pool = poolWithRows();
    const app = createApp(pool, { rateLimitsEnabled: true, trustProxyHops: 1 });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await request(app)
        .post("/api/auth/login")
        .set("X-Forwarded-For", "203.0.113.10")
        .send({});
      expect(response.status).toBe(400);
    }

    const limited = await request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-For", "203.0.113.10")
      .send({});
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ message: "Too many sign-in attempts. Please try again later." });
    expect(limited.headers).toHaveProperty("ratelimit");
    expect(pool.query).not.toHaveBeenCalled();
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

  it("rate-limits repeated order changes", async () => {
    const pool = poolWithRows(...Array.from({ length: 31 }, () => [viewer]));
    const app = createApp(pool, { rateLimitsEnabled: true });
    const order = {
      orderNumber: "BT-1050",
      customerName: "Sample Customer",
      status: "processing",
      total: 25,
    };

    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await request(app)
        .post("/api/orders")
        .set("Cookie", "retail_session=viewer-token")
        .send(order);
      expect(response.status).toBe(403);
    }

    const limited = await request(app)
      .post("/api/orders")
      .set("Cookie", "retail_session=viewer-token")
      .send(order);
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ message: "Too many order changes. Please try again later." });
    expect(limited.headers).toHaveProperty("ratelimit");
    expect(vi.mocked(pool.query)).toHaveBeenCalledTimes(31);
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
