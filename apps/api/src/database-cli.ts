import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import {
  describeSqlPath,
  grantRuntimePrivileges,
  requireDatabaseUrl,
  runMigrations,
  runSqlFile,
} from "./database.js";

const repositoryDatabasePath = fileURLToPath(new URL("../../../database/", import.meta.url));
const migrationsPath = process.env.DATABASE_MIGRATIONS_PATH ?? `${repositoryDatabasePath}migrations`;
const demoSeedPath = process.env.DATABASE_DEMO_SEED_PATH ?? `${repositoryDatabasePath}seeds/demo.sql`;
const localRolePath = `${repositoryDatabasePath}local/runtime-role.sql`;
const localOperatorPath = `${repositoryDatabasePath}local/operator.sql`;

async function seed(pool: Pool, path: string) {
  const client = await pool.connect();
  try {
    await runSqlFile(client, path);
    console.log(`Applied database seed ${describeSqlPath(path)}`);
  } finally {
    client.release();
  }
}

async function grant(pool: Pool, allowOrderWrites: boolean) {
  const role = process.env.DATABASE_RUNTIME_ROLE?.trim();
  if (!role) throw new Error("DATABASE_RUNTIME_ROLE is required");

  const client = await pool.connect();
  try {
    await grantRuntimePrivileges(client, role, allowOrderWrites);
    console.log(`Granted runtime database privileges to ${role}`);
  } finally {
    client.release();
  }
}

async function main() {
  const command = process.argv[2];
  const pool = new Pool({ connectionString: requireDatabaseUrl("MIGRATION_DATABASE_URL") });

  try {
    if (command === "migrate") {
      await runMigrations(pool, migrationsPath);
      console.log("Database migrations are current");
      return;
    }

    if (command === "seed-demo") {
      await seed(pool, demoSeedPath);
      return;
    }

    if (command === "grant-runtime") {
      await grant(pool, process.env.DATABASE_RUNTIME_ORDER_WRITES === "true");
      return;
    }

    if (command === "prepare-local") {
      await runMigrations(pool, migrationsPath);
      await seed(pool, demoSeedPath);
      await seed(pool, localRolePath);
      await seed(pool, localOperatorPath);
      await grant(pool, true);
      console.log("Local database is ready");
      return;
    }

    throw new Error(
      "Database command must be migrate, seed-demo, grant-runtime, or prepare-local",
    );
  } finally {
    await pool.end();
  }
}

await main();
