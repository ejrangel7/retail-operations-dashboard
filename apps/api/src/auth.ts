import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type express from "express";
import type { CookieOptions, RequestHandler } from "express";
import type { Pool } from "pg";
import {
  createSecurityEvent,
  securityFingerprint,
  type SecurityLogger,
  writeSecurityEvent,
} from "./security-monitoring.js";

const scrypt = promisify(scryptCallback);
const sessionCookie = "retail_session";
const sessionMaxAgeMs = 8 * 60 * 60 * 1000;

export type UserRole = "operator" | "viewer";

export type AuthUser = {
  id: number;
  email: string;
  displayName: string;
  role: UserRole;
};

type UserRow = AuthUser & {
  passwordSalt: string;
  passwordHash: string;
};

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser;
      sessionTokenHash?: string;
    }
  }
}

function cookieOptions(secure: boolean): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure,
    maxAge: sessionMaxAgeMs,
    path: "/",
  };
}

function readCookie(request: express.Request, name: string) {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function passwordMatches(password: string, salt: string, expectedHash: string) {
  const actual = await scrypt(password, salt, 64) as Buffer;
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function authenticate(pool: Pool, securityLogger: SecurityLogger = writeSecurityEvent): RequestHandler {
  return async (request, response, next) => {
    const token = readCookie(request, sessionCookie);
    if (!token) {
      response.status(401).json({ message: "Authentication required" });
      return;
    }

    const hash = tokenHash(token);
    const result = await pool.query<AuthUser>(
      `SELECT users.id, users.email, users.display_name AS "displayName", users.role
       FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = $1 AND sessions.expires_at > NOW()`,
      [hash],
    );
    if (result.rows.length === 0) {
      securityLogger(createSecurityEvent(request, {
        severity: "warning",
        event: "authentication.session_rejected",
        outcome: "failure",
        reason: "invalid_or_expired_session",
        statusCode: 401,
      }));
      response.clearCookie(sessionCookie, { path: "/" });
      response.status(401).json({ message: "Authentication required" });
      return;
    }

    request.authUser = result.rows[0];
    request.sessionTokenHash = hash;
    next();
  };
}

export function requireRole(role: UserRole, securityLogger: SecurityLogger = writeSecurityEvent): RequestHandler {
  return (request, response, next) => {
    if (request.authUser?.role !== role) {
      securityLogger(createSecurityEvent(request, {
        severity: "warning",
        event: "authorization.role_denied",
        outcome: "blocked",
        reason: `requires_${role}_role`,
        actor: request.authUser
          ? { userId: request.authUser.id, role: request.authUser.role }
          : undefined,
        statusCode: 403,
      }));
      response.status(403).json({ message: "You do not have permission to perform this action" });
      return;
    }
    next();
  };
}

export function registerAuthRoutes(
  app: express.Express,
  pool: Pool,
  secureCookies: boolean,
  operatorLoginEnabled = true,
  authenticatedReadLimiter: RequestHandler = (_request, _response, next) => next(),
  securityLogger: SecurityLogger = writeSecurityEvent,
) {
  app.post("/api/auth/login", async (request, response) => {
    const email = typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : "";
    const password = typeof request.body?.password === "string" ? request.body.password : "";
    if (!email || email.length > 160 || !password || password.length > 200) {
      securityLogger(createSecurityEvent(request, {
        severity: "warning",
        event: "authentication.login_failed",
        outcome: "failure",
        reason: "invalid_request",
        actor: email ? { accountFingerprint: securityFingerprint(email) } : undefined,
        statusCode: 400,
      }));
      response.status(400).json({ message: "Email and password are required" });
      return;
    }

    const result = await pool.query<UserRow>(
      `SELECT id, email, display_name AS "displayName", role,
              password_salt AS "passwordSalt", password_hash AS "passwordHash"
       FROM users WHERE email = $1`,
      [email],
    );
    const user = result.rows[0];
    if (!user || !(await passwordMatches(password, user.passwordSalt, user.passwordHash))) {
      securityLogger(createSecurityEvent(request, {
        severity: "warning",
        event: email === "operator@retail.local"
          ? "authentication.operator_login_blocked"
          : "authentication.login_failed",
        outcome: email === "operator@retail.local" ? "blocked" : "failure",
        reason: "invalid_credentials",
        actor: { accountFingerprint: securityFingerprint(email) },
        statusCode: 401,
      }));
      response.status(401).json({ message: "Invalid email or password" });
      return;
    }

    if (user.role === "operator" && !operatorLoginEnabled) {
      securityLogger(createSecurityEvent(request, {
        severity: "warning",
        event: "authentication.operator_login_blocked",
        outcome: "blocked",
        reason: "operator_access_disabled",
        actor: {
          userId: user.id,
          role: user.role,
          accountFingerprint: securityFingerprint(user.email),
        },
        statusCode: 403,
      }));
      response.status(403).json({ message: "Operator sign-in is disabled in the public demo" });
      return;
    }

    const token = randomBytes(32).toString("base64url");
    const hash = tokenHash(token);
    await pool.query("DELETE FROM sessions WHERE expires_at <= NOW()");
    await pool.query(
      "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '8 hours')",
      [hash, user.id],
    );
    response.cookie(sessionCookie, token, cookieOptions(secureCookies));
    response.json({ id: user.id, email: user.email, displayName: user.displayName, role: user.role });
  });

  app.get("/api/auth/me", authenticate(pool, securityLogger), authenticatedReadLimiter, (request, response) => {
    response.json(request.authUser);
  });

  app.post("/api/auth/logout", async (request, response) => {
    const token = readCookie(request, sessionCookie);
    if (token) await pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash(token)]);
    response.clearCookie(sessionCookie, { path: "/" });
    response.status(204).send();
  });
}
