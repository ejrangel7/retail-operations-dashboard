import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { Pool, PoolClient } from "pg";

const migrationFilePattern = /^\d{3}_[a-z0-9-]+\.sql$/;
const runtimeRolePattern = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;
const migrationLockId = 1_386_633_281;

type DatabaseClient = Pick<PoolClient, "query">;

export interface AppliedMigration {
  name: string;
  checksum: string;
}

export function validateMigrationHistory(
  migrationNames: string[],
  appliedMigrations: AppliedMigration[],
) {
  const available = new Set(migrationNames);
  const missingFile = appliedMigrations.find((migration) => !available.has(migration.name));
  if (missingFile) {
    throw new Error(`Applied migration ${missingFile.name} is missing from the repository`);
  }

  const applied = new Set(appliedMigrations.map((migration) => migration.name));
  const latestApplied = appliedMigrations.at(-1)?.name;
  const outOfOrder = migrationNames.find(
    (name) => !applied.has(name) && latestApplied && name < latestApplied,
  );
  if (outOfOrder) {
    throw new Error(`Pending migration ${outOfOrder} predates an applied migration`);
  }
}

interface RuntimeRoleSecurity {
  rolsuper: boolean;
  rolcreaterole: boolean;
  rolcreatedb: boolean;
  rolreplication: boolean;
  rolbypassrls: boolean;
  has_memberships: boolean;
}

export function requireDatabaseUrl(name: "DATABASE_URL" | "MIGRATION_DATABASE_URL") {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export async function runSqlFile(client: DatabaseClient, path: string) {
  const sql = await readFile(path, "utf8");
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function runMigrations(pool: Pool, migrationsPath: string) {
  const entries = await readdir(migrationsPath, { withFileTypes: true });
  const migrationNames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();

  const invalidName = migrationNames.find((name) => !migrationFilePattern.test(name));
  if (invalidName) {
    throw new Error(
      `Invalid migration filename ${invalidName}; expected NNN_lowercase-name.sql`,
    );
  }

  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [migrationLockId]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name VARCHAR(255) PRIMARY KEY,
        checksum CHAR(64) NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const appliedResult = await client.query<AppliedMigration>(
      "SELECT name, checksum FROM schema_migrations ORDER BY name",
    );
    validateMigrationHistory(migrationNames, appliedResult.rows);
    const applied = new Map(appliedResult.rows.map((migration) => [migration.name, migration.checksum]));

    for (const name of migrationNames) {
      const sql = await readFile(resolve(migrationsPath, name), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const existingChecksum = applied.get(name);

      if (existingChecksum && existingChecksum !== checksum) {
        throw new Error(`Applied migration ${name} has been modified`);
      }
      if (existingChecksum) continue;

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)",
          [name, checksum],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [migrationLockId]).catch(() => undefined);
    client.release();
  }
}

function quoteIdentifier(value: string) {
  if (!runtimeRolePattern.test(value)) {
    throw new Error("DATABASE_RUNTIME_ROLE must be a valid PostgreSQL role name");
  }
  return `"${value.replaceAll('"', '""')}"`;
}

export async function grantRuntimePrivileges(
  client: DatabaseClient,
  runtimeRole: string,
  allowOrderWrites: boolean,
) {
  const role = quoteIdentifier(runtimeRole);
  const roleResult = await client.query<RuntimeRoleSecurity>(
    `SELECT rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls,
            EXISTS (SELECT 1 FROM pg_auth_members WHERE member = pg_roles.oid) AS has_memberships
     FROM pg_roles
     WHERE rolname = $1`,
    [runtimeRole],
  );
  const roleSecurity = roleResult.rows[0];
  if (!roleSecurity) throw new Error(`PostgreSQL runtime role ${runtimeRole} does not exist`);
  if (
    roleSecurity.rolsuper ||
    roleSecurity.rolcreaterole ||
    roleSecurity.rolcreatedb ||
    roleSecurity.rolreplication ||
    roleSecurity.rolbypassrls ||
    roleSecurity.has_memberships
  ) {
    throw new Error(
      `PostgreSQL runtime role ${runtimeRole} has elevated attributes or inherited memberships`,
    );
  }

  await client.query("BEGIN");
  try {
    await client.query(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${role}`);
    await client.query(`REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM ${role}`);
    await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await client.query(`GRANT SELECT ON products, orders, users TO ${role}`);
    await client.query(`GRANT SELECT, INSERT, DELETE ON sessions TO ${role}`);

    if (allowOrderWrites) {
      await client.query(`GRANT INSERT, UPDATE ON orders TO ${role}`);
      await client.query(`GRANT USAGE, SELECT ON SEQUENCE orders_id_seq TO ${role}`);
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export function describeSqlPath(path: string) {
  return basename(path);
}
