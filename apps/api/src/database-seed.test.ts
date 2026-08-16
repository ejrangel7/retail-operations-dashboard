import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const productionInitUrl = new URL("../../../database/init.sql", import.meta.url);
const localOperatorUrl = new URL("../../../database/local-operator.sql", import.meta.url);

describe("database seeds", () => {
  it("removes the legacy operator without packaging its known credential in production initialization", async () => {
    const productionInit = await readFile(productionInitUrl, "utf8");

    expect(productionInit).toContain("DELETE FROM users WHERE email = 'operator@retail.local'");
    expect(productionInit).not.toContain("Operations Manager");
    expect(productionInit).not.toContain("c5cf7a87c25e2ca125c348379485d478");
  });

  it("keeps the known operator in an idempotent local-only seed", async () => {
    const localOperator = await readFile(localOperatorUrl, "utf8");

    expect(localOperator).toContain("'operator@retail.local'");
    expect(localOperator).toContain("'operator'");
    expect(localOperator).toContain("ON CONFLICT (email) DO UPDATE");
  });
});
