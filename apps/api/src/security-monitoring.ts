import { createHmac, randomBytes } from "node:crypto";
import type express from "express";

const fingerprintKey = randomBytes(32);

export type SecurityEvent = {
  timestamp: string;
  category: "security";
  severity: "warning" | "error";
  event: string;
  outcome: "failure" | "blocked" | "error";
  reason: string;
  request: {
    method: string;
    path: string;
    clientFingerprint: string;
  };
  actor?: {
    userId?: number;
    role?: string;
    accountFingerprint?: string;
  };
  control?: {
    name: string;
    limit?: number;
    windowMs?: number;
    observedRequests?: number;
  };
  error?: {
    name: string;
    code?: string;
  };
  statusCode: number;
};

export type SecurityEventInput = Omit<SecurityEvent, "timestamp" | "category" | "request">;
export type SecurityLogger = (event: SecurityEvent) => void;

export function securityFingerprint(value: string) {
  return createHmac("sha256", fingerprintKey).update(value).digest("hex").slice(0, 16);
}

export function createSecurityEvent(request: express.Request, input: SecurityEventInput): SecurityEvent {
  const path = request.originalUrl?.split("?", 1)[0] || request.path;
  return {
    timestamp: new Date().toISOString(),
    category: "security",
    ...input,
    request: {
      method: request.method,
      path,
      clientFingerprint: securityFingerprint(request.ip ?? "unknown"),
    },
  };
}

export function securityError(error: unknown): SecurityEvent["error"] {
  if (!error || typeof error !== "object") return { name: "UnknownError" };
  const name = "name" in error && typeof error.name === "string" ? error.name : "Error";
  const code = "code" in error && (typeof error.code === "string" || typeof error.code === "number")
    ? String(error.code)
    : undefined;
  return code ? { name, code } : { name };
}

export const writeSecurityEvent: SecurityLogger = (event) => {
  const serialized = JSON.stringify(event);
  if (event.severity === "error") {
    console.error(serialized);
  } else {
    console.warn(serialized);
  }
};
