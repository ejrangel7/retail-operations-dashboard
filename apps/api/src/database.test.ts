import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { grantRuntimePrivileges, validateMigrationHistory } from "./database.js";

function createClient() {
  return {
    query: vi.fn().mockResolvedValue({
      rows: [
        {
          rolsuper: false,
          rolcreaterole: false,
          rolcreatedb: false,
          rolreplication: false,
          rolbypassrls: false,
          has_memberships: false,
        },
      ],
    }),
  } as unknown as Pick<PoolClient, "query">;
}

describe("runtime database privileges", () => {
  it("grants only read and session permissions for production", async () => {
    const client = createClient();

    await grantRuntimePrivileges(client, "retail_runtime", false);

    const statements = vi.mocked(client.query).mock.calls.map(([query]) => String(query));
    expect(statements).toContain('GRANT SELECT ON products, orders, users TO "retail_runtime"');
    expect(statements).toContain('GRANT SELECT, INSERT, DELETE ON sessions TO "retail_runtime"');
    expect(statements.some((statement) => statement.includes("GRANT INSERT, UPDATE ON orders"))).toBe(
      false,
    );
    expect(statements.some((statement) => /CREATE|ALTER|DROP/.test(statement))).toBe(false);
  });

  it("adds order write permissions only for the local operator environment", async () => {
    const client = createClient();

    await grantRuntimePrivileges(client, "retail_app", true);

    const statements = vi.mocked(client.query).mock.calls.map(([query]) => String(query));
    expect(statements).toContain('GRANT INSERT, UPDATE ON orders TO "retail_app"');
    expect(statements).toContain(
      'GRANT USAGE, SELECT ON SEQUENCE orders_id_seq TO "retail_app"',
    );
  });

  it("rejects unsafe role identifiers", async () => {
    const client = createClient();

    await expect(grantRuntimePrivileges(client, 'retail_app"; DROP SCHEMA public', false)).rejects.toThrow(
      "valid PostgreSQL role name",
    );
    expect(client.query).not.toHaveBeenCalled();
  });

  it("rejects roles with inherited or administrative privileges", async () => {
    const client = createClient();
    vi.mocked(client.query).mockResolvedValueOnce({
      rows: [
        {
          rolsuper: false,
          rolcreaterole: false,
          rolcreatedb: false,
          rolreplication: false,
          rolbypassrls: false,
          has_memberships: true,
        },
      ],
    } as never);

    await expect(grantRuntimePrivileges(client, "console_created_role", false)).rejects.toThrow(
      "elevated attributes or inherited memberships",
    );
    expect(client.query).toHaveBeenCalledTimes(1);
  });
});

describe("migration history", () => {
  it("rejects deleted migration files", () => {
    expect(() =>
      validateMigrationHistory([], [{ name: "001_baseline.sql", checksum: "a".repeat(64) }]),
    ).toThrow("missing from the repository");
  });

  it("rejects migrations inserted before the latest applied migration", () => {
    expect(() =>
      validateMigrationHistory(
        ["001_baseline.sql", "002_permissions.sql", "003_sessions.sql"],
        [
          { name: "001_baseline.sql", checksum: "a".repeat(64) },
          { name: "003_sessions.sql", checksum: "b".repeat(64) },
        ],
      ),
    ).toThrow("predates an applied migration");
  });

  it("accepts append-only migration history", () => {
    expect(() =>
      validateMigrationHistory(
        ["001_baseline.sql", "002_permissions.sql"],
        [{ name: "001_baseline.sql", checksum: "a".repeat(64) }],
      ),
    ).not.toThrow();
  });
});
