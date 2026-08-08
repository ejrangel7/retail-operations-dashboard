import cors from "cors";
import express from "express";
import type { Pool } from "pg";

export function createApp(pool: Pool) {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get("/api/health", async (_request, response) => {
    const result = await pool.query<{ now: string }>("SELECT NOW() AS now");
    response.json({ status: "ok", databaseTime: result.rows[0].now });
  });

  app.get("/api/dashboard", async (_request, response) => {
    const [products, orders, revenue, lowStock] = await Promise.all([
      pool.query<{ count: string }>("SELECT COUNT(*) AS count FROM products"),
      pool.query<{ count: string }>("SELECT COUNT(*) AS count FROM orders"),
      pool.query<{ total: string }>("SELECT COALESCE(SUM(total), 0) AS total FROM orders"),
      pool.query<{ count: string }>(
        "SELECT COUNT(*) AS count FROM products WHERE stock <= reorder_level",
      ),
    ]);

    response.json({
      totalProducts: Number(products.rows[0].count),
      totalOrders: Number(orders.rows[0].count),
      revenue: Number(revenue.rows[0].total),
      lowStockItems: Number(lowStock.rows[0].count),
    });
  });

  app.get("/api/products", async (_request, response) => {
    const result = await pool.query(
      `SELECT id, sku, name, category, price::float, stock, reorder_level AS "reorderLevel"
       FROM products
       ORDER BY stock ASC, name ASC`,
    );
    response.json(result.rows);
  });

  app.get("/api/orders", async (_request, response) => {
    const result = await pool.query(
      `SELECT id, order_number AS "orderNumber", customer_name AS "customerName",
              status, total::float, created_at AS "createdAt"
       FROM orders
       ORDER BY created_at DESC`,
    );
    response.json(result.rows);
  });

  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      console.error(error);
      response.status(500).json({ message: "Unexpected server error" });
    },
  );

  return app;
}
