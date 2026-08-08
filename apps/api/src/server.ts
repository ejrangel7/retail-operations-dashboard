import { Pool } from "pg";
import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 4000);
const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://retail:retail@localhost:5432/retail_ops",
});
const app = createApp(pool);

app.listen(port, () => {
  console.log(`Retail Operations API listening on port ${port}`);
});

