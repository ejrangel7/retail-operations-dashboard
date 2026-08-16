import { Pool } from "pg";
import { createApp } from "./app.js";
import { requireDatabaseUrl } from "./database.js";

const port = Number(process.env.PORT ?? 4000);
const pool = new Pool({
  connectionString: requireDatabaseUrl("DATABASE_URL"),
});
const app = createApp(pool, { staticAssetsPath: process.env.STATIC_ASSETS_PATH });

app.listen(port, () => {
  console.log(`Retail Operations API listening on port ${port}`);
});
