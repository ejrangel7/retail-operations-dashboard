import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 4000);
const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://retail:retail@localhost:5432/retail_ops",
});
const databaseInitPath = process.env.DATABASE_INIT_PATH;
if (databaseInitPath) {
  await pool.query(await readFile(databaseInitPath, "utf8"));
}
const databaseDevelopmentSeedPath = process.env.DATABASE_DEVELOPMENT_SEED_PATH;
if (process.env.NODE_ENV !== "production" && databaseDevelopmentSeedPath) {
  await pool.query(await readFile(databaseDevelopmentSeedPath, "utf8"));
}
const app = createApp(pool, { staticAssetsPath: process.env.STATIC_ASSETS_PATH });

app.listen(port, () => {
  console.log(`Retail Operations API listening on port ${port}`);
});
