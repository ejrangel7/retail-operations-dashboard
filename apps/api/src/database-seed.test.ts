import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const baselineMigrationUrl = new URL(
  "../../../database/migrations/001_baseline.sql",
  import.meta.url,
);
const demoSeedUrl = new URL("../../../database/seeds/demo.sql", import.meta.url);
const localOperatorUrl = new URL("../../../database/local/operator.sql", import.meta.url);
const serverUrl = new URL("./server.ts", import.meta.url);

describe("database seeds", () => {
  it("removes the legacy operator without packaging its known credential in migrations", async () => {
    const baselineMigration = await readFile(baselineMigrationUrl, "utf8");

    expect(baselineMigration).toContain("DELETE FROM users WHERE email = 'operator@retail.local'");
    expect(baselineMigration).not.toContain("Operations Manager");
    expect(baselineMigration).not.toContain("c5cf7a87c25e2ca125c348379485d478");
  });

  it("keeps the known operator in an idempotent local-only seed", async () => {
    const localOperator = await readFile(localOperatorUrl, "utf8");

    expect(localOperator).toContain("'operator@retail.local'");
    expect(localOperator).toContain("'operator'");
    expect(localOperator).toContain("ON CONFLICT (email) DO UPDATE");
  });

  it("keeps the public viewer and fictional records in a separate idempotent demo seed", async () => {
    const demoSeed = await readFile(demoSeedUrl, "utf8");

    expect(demoSeed).toContain("'viewer@retail.local'");
    expect(demoSeed).toContain("ON CONFLICT (email) DO UPDATE");
    expect(demoSeed).toContain("ON CONFLICT (order_number) DO NOTHING");
    expect(demoSeed).not.toContain("'operator@retail.local'");
  });

  it("does not execute migrations or seeds from the API startup process", async () => {
    const server = await readFile(serverUrl, "utf8");

    expect(server).not.toContain("DATABASE_INIT_PATH");
    expect(server).not.toContain("DATABASE_DEVELOPMENT_SEED_PATH");
    expect(server).not.toContain("readFile");
  });
});
