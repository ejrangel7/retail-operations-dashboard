import cors from "cors";
import express from "express";
import type { Pool } from "pg";

const orderStatuses = new Set(["processing", "shipped", "delivered"]);
const stockFilters = new Set(["low", "in-stock"]);

type ParsedQuery = { page: number; pageSize: number; search: string };
type CreateOrderInput = {
  orderNumber: string;
  customerName: string;
  status: string;
  total: number;
};

function readQueryValue(value: unknown) {
  return typeof value === "string" ? value.trim() : undefined;
}

function parsePositiveInteger(value: unknown, fallback: number, maximum?: number) {
  const raw = readQueryValue(value);
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  if (parsed < 1 || (maximum !== undefined && parsed > maximum)) return null;
  return parsed;
}

function parseCollectionQuery(query: express.Request["query"]): ParsedQuery | string {
  const page = parsePositiveInteger(query.page, 1);
  const pageSize = parsePositiveInteger(query.pageSize, 20, 100);
  const search = readQueryValue(query.search) ?? "";
  if (page === null) return "page must be a positive integer";
  if (pageSize === null) return "pageSize must be between 1 and 100";
  if (search.length > 100) return "search must be 100 characters or fewer";
  return { page, pageSize, search };
}

function parseCreateOrder(body: unknown): CreateOrderInput | string {
  if (!body || typeof body !== "object") return "request body must be an object";
  const candidate = body as Record<string, unknown>;
  const orderNumber = typeof candidate.orderNumber === "string" ? candidate.orderNumber.trim() : "";
  const customerName = typeof candidate.customerName === "string" ? candidate.customerName.trim() : "";
  const status = typeof candidate.status === "string" ? candidate.status : "";
  const total = candidate.total;

  if (!/^BT-[0-9]{4}$/.test(orderNumber)) {
    return "orderNumber must use the format BT-0000";
  }
  if (customerName.length < 2 || customerName.length > 120) {
    return "customerName must be between 2 and 120 characters";
  }
  if (!orderStatuses.has(status)) return "status is not supported";
  if (typeof total !== "number" || !Number.isFinite(total) || total <= 0 || total > 99_999_999.99) {
    return "total must be a positive number";
  }
  return { orderNumber, customerName, status, total };
}

function paginated<T>(items: T[], page: number, pageSize: number, total: number) {
  return {
    items,
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

function isPostgresError(error: unknown, code: string) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

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
      pool.query<{ count: string }>("SELECT COUNT(*) AS count FROM products WHERE stock <= reorder_level"),
    ]);
    response.json({
      totalProducts: Number(products.rows[0].count),
      totalOrders: Number(orders.rows[0].count),
      revenue: Number(revenue.rows[0].total),
      lowStockItems: Number(lowStock.rows[0].count),
    });
  });

  app.get("/api/products", async (request, response) => {
    const parsed = parseCollectionQuery(request.query);
    if (typeof parsed === "string") { response.status(400).json({ message: parsed }); return; }
    const stock = readQueryValue(request.query.stock) ?? "";
    if (stock && !stockFilters.has(stock)) { response.status(400).json({ message: "stock must be low or in-stock" }); return; }

    const conditions: string[] = [];
    const values: Array<string | number> = [];
    if (parsed.search) {
      values.push(`%${parsed.search}%`);
      conditions.push(`(sku ILIKE $${values.length} OR name ILIKE $${values.length} OR category ILIKE $${values.length})`);
    }
    if (stock === "low") conditions.push("stock <= reorder_level");
    if (stock === "in-stock") conditions.push("stock > reorder_level");
    const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
    const dataValues = [...values, parsed.pageSize, (parsed.page - 1) * parsed.pageSize];
    const [countResult, dataResult] = await Promise.all([
      pool.query<{ count: string }>(`SELECT COUNT(*) AS count FROM products${where}`, values),
      pool.query(
        `SELECT id, sku, name, category, price::float, stock, reorder_level AS "reorderLevel"
         FROM products${where} ORDER BY stock ASC, name ASC
         LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        dataValues,
      ),
    ]);
    response.json(paginated(dataResult.rows, parsed.page, parsed.pageSize, Number(countResult.rows[0].count)));
  });

  app.get("/api/orders", async (request, response) => {
    const parsed = parseCollectionQuery(request.query);
    if (typeof parsed === "string") { response.status(400).json({ message: parsed }); return; }
    const status = readQueryValue(request.query.status) ?? "";
    if (status && !orderStatuses.has(status)) { response.status(400).json({ message: "status is not supported" }); return; }

    const conditions: string[] = [];
    const values: Array<string | number> = [];
    if (parsed.search) {
      values.push(`%${parsed.search}%`);
      conditions.push(`(order_number ILIKE $${values.length} OR customer_name ILIKE $${values.length})`);
    }
    if (status) { values.push(status); conditions.push(`status = $${values.length}`); }
    const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
    const dataValues = [...values, parsed.pageSize, (parsed.page - 1) * parsed.pageSize];
    const [countResult, dataResult] = await Promise.all([
      pool.query<{ count: string }>(`SELECT COUNT(*) AS count FROM orders${where}`, values),
      pool.query(
        `SELECT id, order_number AS "orderNumber", customer_name AS "customerName",
                status, total::float, created_at AS "createdAt"
         FROM orders${where} ORDER BY created_at DESC
         LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        dataValues,
      ),
    ]);
    response.json(paginated(dataResult.rows, parsed.page, parsed.pageSize, Number(countResult.rows[0].count)));
  });

  app.post("/api/orders", async (request, response) => {
    const parsed = parseCreateOrder(request.body);
    if (typeof parsed === "string") { response.status(400).json({ message: parsed }); return; }
    try {
      const result = await pool.query(
        `INSERT INTO orders (order_number, customer_name, status, total)
         VALUES ($1, $2, $3, $4)
         RETURNING id, order_number AS "orderNumber", customer_name AS "customerName",
                   status, total::float, created_at AS "createdAt"`,
        [parsed.orderNumber, parsed.customerName, parsed.status, parsed.total],
      );
      response.status(201).json(result.rows[0]);
    } catch (error) {
      if (isPostgresError(error, "23505")) {
        response.status(409).json({ message: "An order with this number already exists" });
        return;
      }
      throw error;
    }
  });

  app.patch("/api/orders/:id", async (request, response) => {
    const id = parsePositiveInteger(request.params.id, 0);
    const status = request.body && typeof request.body.status === "string" ? request.body.status : "";
    if (id === null || id === 0) { response.status(400).json({ message: "order id must be a positive integer" }); return; }
    if (!orderStatuses.has(status)) { response.status(400).json({ message: "status is not supported" }); return; }

    const result = await pool.query(
      `UPDATE orders SET status = $1 WHERE id = $2
       RETURNING id, order_number AS "orderNumber", customer_name AS "customerName",
                 status, total::float, created_at AS "createdAt"`,
      [status, id],
    );
    if (result.rows.length === 0) { response.status(404).json({ message: "Order not found" }); return; }
    response.json(result.rows[0]);
  });

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    console.error(error);
    response.status(500).json({ message: "Unexpected server error" });
  });
  return app;
}
