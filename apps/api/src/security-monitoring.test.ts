import type express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSecurityEvent,
  securityError,
  securityFingerprint,
  writeSecurityEvent,
} from "./security-monitoring.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("security monitoring", () => {
  it("creates correlatable events without retaining raw account or client identifiers", () => {
    const request = {
      method: "POST",
      path: "/api/auth/login",
      originalUrl: "/api/auth/login?email=viewer%40retail.local",
      ip: "203.0.113.42",
    } as express.Request;
    const accountFingerprint = securityFingerprint("viewer@retail.local");
    const event = createSecurityEvent(request, {
      severity: "warning",
      event: "authentication.login_failed",
      outcome: "failure",
      reason: "invalid_credentials",
      actor: { accountFingerprint },
      statusCode: 401,
    });

    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(event.request.path).toBe("/api/auth/login");
    expect(event.request.clientFingerprint).toMatch(/^[a-f0-9]{16}$/);
    expect(accountFingerprint).toBe(securityFingerprint("viewer@retail.local"));
    expect(JSON.stringify(event)).not.toContain("viewer@retail.local");
    expect(JSON.stringify(event)).not.toContain("203.0.113.42");
  });

  it("writes one JSON line at the event severity and sanitizes errors", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = Object.assign(new Error("connection string must stay private"), { code: "ECONNRESET" });
    const request = { method: "GET", path: "/api/orders", ip: "127.0.0.1" } as express.Request;
    const event = createSecurityEvent(request, {
      severity: "warning",
      event: "rate_limit.exceeded",
      outcome: "blocked",
      reason: "request_volume_exceeded",
      error: securityError(error),
      statusCode: 429,
    });

    writeSecurityEvent(event);

    expect(warning).toHaveBeenCalledTimes(1);
    const serialized = warning.mock.calls[0][0];
    expect(JSON.parse(serialized)).toEqual(event);
    expect(serialized).toContain('"code":"ECONNRESET"');
    expect(serialized).not.toContain("connection string must stay private");
  });
});
