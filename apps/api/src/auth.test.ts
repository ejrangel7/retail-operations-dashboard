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
    expect(vi.mocked(pool.query).mock.calls[1]).toEqual([
      "DELETE FROM sessions WHERE expires_at <= NOW()",
    ]);
  });

  it("rejects invalid credentials without creating a session", async () => {
    const salt = "0123456789abcdef0123456789abcdef";
    const passwordHash = scryptSync("RetailOps!2026", salt, 64).toString("hex");
    const pool = poolWithRows([{ ...operator, passwordSalt: salt, passwordHash }]);
    const securityLogger = vi.fn();

    const response = await request(createApp(pool, { securityLogger })).post("/api/auth/login").send({
      email: operator.email,
      password: "incorrect",
    });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: "Invalid email or password" });
    expect(vi.mocked(pool.query)).toHaveBeenCalledTimes(1);
    expect(securityLogger).toHaveBeenCalledWith(expect.objectContaining({
      event: "authentication.operator_login_blocked",
      outcome: "blocked",
      reason: "invalid_credentials",
      statusCode: 401,
      actor: { accountFingerprint: expect.stringMatching(/^[a-f0-9]{16}$/) },
    }));
    const serializedEvents = JSON.stringify(securityLogger.mock.calls);
    expect(serializedEvents).not.toContain(operator.email);
    expect(serializedEvents).not.toContain("incorrect");
  });

  it("blocks operator sign-in when the public demo disables it", async () => {
    const salt = "0123456789abcdef0123456789abcdef";
    const passwordHash = scryptSync("RetailOps!2026", salt, 64).toString("hex");
    const pool = poolWithRows([{ ...operator, passwordSalt: salt, passwordHash }]);
    const securityLogger = vi.fn();

    const response = await request(createApp(pool, {
      operatorLoginEnabled: false,
      rateLimitsEnabled: false,
      securityLogger,
    }))
      .post("/api/auth/login")
      .send({ email: operator.email, password: "RetailOps!2026" });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: "Operator sign-in is disabled in the public demo" });
    expect(vi.mocked(pool.query)).toHaveBeenCalledTimes(1);
    expect(securityLogger).toHaveBeenCalledWith(expect.objectContaining({
      event: "authentication.operator_login_blocked",
      outcome: "blocked",
      reason: "operator_access_disabled",
      actor: expect.objectContaining({ userId: operator.id, role: operator.role }),
      statusCode: 403,
    }));
  });

  it("disables operator sign-in by default in production", async () => {
    const salt = "0123456789abcdef0123456789abcdef";
    const passwordHash = scryptSync("RetailOps!2026", salt, 64).toString("hex");
    const pool = poolWithRows([{ ...operator, passwordSalt: salt, passwordHash }]);

    const response = await request(createApp(pool, { isProduction: true, rateLimitsEnabled: false }))
      .post("/api/auth/login")
      .send({ email: operator.email, password: "RetailOps!2026" });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: "Operator sign-in is disabled in the public demo" });
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
    const securityLogger = vi.fn();

    const response = await request(createApp(pool, {
      operatorLoginEnabled: false,
      rateLimitsEnabled: false,
      securityLogger,
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
    expect(securityLogger).toHaveBeenCalledWith(expect.objectContaining({
      event: "authorization.operator_mutation_blocked",
      outcome: "blocked",
      reason: "operator_mutations_disabled",
      actor: { userId: operator.id, role: operator.role },
      statusCode: 403,
    }));
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

  it("rate-limits repeated successful sign-in attempts", async () => {
    const salt = "abcdef0123456789abcdef0123456789";
    const passwordHash = scryptSync("RetailView!2026", salt, 64).toString("hex");
    const pool = {
      query: vi.fn().mockImplementation((query: string) => Promise.resolve({
        rows: query.includes("FROM users")
          ? [{ ...viewer, passwordSalt: salt, passwordHash }]
          : [],
      })),
    } as unknown as Pool;
    const app = createApp(pool, { rateLimitsEnabled: true, trustProxyHops: 1 });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await request(app)
        .post("/api/auth/login")
        .set("X-Forwarded-For", "203.0.113.11")
        .send({ email: viewer.email, password: "RetailView!2026" });
      expect(response.status).toBe(200);
    }

    const limited = await request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-For", "203.0.113.11")
      .send({ email: viewer.email, password: "RetailView!2026" });

    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ message: "Too many sign-in attempts. Please try again later." });
    expect(limited.headers).toHaveProperty("ratelimit");
    expect(vi.mocked(pool.query)).toHaveBeenCalledTimes(30);
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

  it("rate-limits authenticated reads by client address", async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [viewer] }),
    } as unknown as Pool;
    const app = createApp(pool, { rateLimitsEnabled: true, trustProxyHops: 1 });

    for (let attempt = 0; attempt < 120; attempt += 1) {
      const response = await request(app)
        .get("/api/auth/me")
        .set("Cookie", "retail_session=viewer-token")
        .set("X-Forwarded-For", "203.0.113.12");
      expect(response.status).toBe(200);
    }

    const limited = await request(app)
      .get("/api/auth/me")
      .set("Cookie", "retail_session=viewer-token")
      .set("X-Forwarded-For", "203.0.113.12");
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ message: "Too many data requests. Please try again later." });
    expect(limited.headers["ratelimit"]).toContain("authenticated-reads");
    expect(vi.mocked(pool.query)).toHaveBeenCalledTimes(121);
  });

  it("protects operational data when no session is present", async () => {
    const pool = poolWithRows();
    const response = await request(createApp(pool)).get("/api/dashboard");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: "Authentication required" });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("records an invalid session without exposing its token", async () => {
    const pool = poolWithRows([]);
    const securityLogger = vi.fn();
    const response = await request(createApp(pool, { securityLogger }))
      .get("/api/dashboard")
      .set("Cookie", "retail_session=sensitive-session-token");

    expect(response.status).toBe(401);
    expect(securityLogger).toHaveBeenCalledWith(expect.objectContaining({
      event: "authentication.session_rejected",
      outcome: "failure",
      reason: "invalid_or_expired_session",
      statusCode: 401,
    }));
    expect(JSON.stringify(securityLogger.mock.calls)).not.toContain("sensitive-session-token");
  });

  it("prevents viewers from creating orders", async () => {
    const pool = poolWithRows([viewer]);
    const securityLogger = vi.fn();
    const response = await request(createApp(pool, { securityLogger }))
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
    expect(securityLogger).toHaveBeenCalledWith(expect.objectContaining({
      event: "authorization.role_denied",
      outcome: "blocked",
      reason: "requires_operator_role",
      actor: { userId: viewer.id, role: viewer.role },
      statusCode: 403,
    }));
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
