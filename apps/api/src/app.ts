import cors from "cors";
import express from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import type { Pool } from "pg";
import { authenticate, registerAuthRoutes, requireRole } from "./auth.js";
import {
  createSecurityEvent,
  securityError,
  type SecurityLogger,
  writeSecurityEvent,
} from "./security-monitoring.js";

const orderStatuses = new Set(["processing", "shipped", "delivered"]);
const stockFilters = new Set(["low", "in-stock"]);
const passThrough: express.RequestHandler = (_request, _response, next) => next();

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

type AppOptions = {
  authRequired?: boolean;
  isProduction?: boolean;
  operatorLoginEnabled?: boolean;
  rateLimitsEnabled?: boolean;
  securityLogger?: SecurityLogger;
  secureCookies?: boolean;
  staticAssetsPath?: string;
  trustProxyHops?: number;
  webOrigin?: string | false;
};

export function createApp(pool: Pool, options: AppOptions = {}) {
  const app = express();
  const isProduction = options.isProduction ?? process.env.NODE_ENV === "production";
  const operatorLoginEnabled = options.operatorLoginEnabled ?? (
    process.env.OPERATOR_LOGIN_ENABLED === undefined
      ? !isProduction
      : process.env.OPERATOR_LOGIN_ENABLED === "true"
  );
  const rateLimitsEnabled = options.rateLimitsEnabled ?? process.env.RATE_LIMITS_ENABLED !== "false";
  const securityLogger = options.securityLogger
    ?? (process.env.NODE_ENV === "test" ? () => undefined : writeSecurityEvent);
  const trustProxyHops = options.trustProxyHops
    ?? Number(process.env.TRUST_PROXY_HOPS ?? (isProduction ? 1 : 0));
  const webOrigin = options.webOrigin === false
    ? undefined
    : options.webOrigin
      ?? process.env.WEB_ORIGIN
      ?? process.env.RENDER_EXTERNAL_URL
      ?? (isProduction ? undefined : "http://localhost:8080");
  if (trustProxyHops > 0) app.set("trust proxy", trustProxyHops);
  app.disable("x-powered-by");
  app.use(helmet({
    contentSecurityPolicy: {
      directives: { upgradeInsecureRequests: isProduction ? [] : null },
    },
    ...(isProduction ? {} : { strictTransportSecurity: false }),
  }));
  if (webOrigin) {
    app.use(cors({
      origin: (requestOrigin, callback) => callback(null, !requestOrigin || requestOrigin === webOrigin),
      credentials: true,
    }));
  }

  let authenticatedReadLimiter: express.RequestHandler = passThrough;
  let operationsReportLimiter: express.RequestHandler = passThrough;
  const monitoredRateLimit = ({
    identifier,
    windowMs,
    limit,
    message,
    skip,
  }: {
    identifier: string;
    windowMs: number;
    limit: number;
    message: { message: string };
    skip?: (request: express.Request) => boolean;
  }) => rateLimit({
    windowMs,
    limit,
    identifier,
    skip,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message,
    handler: (request, response, _next, rateLimitOptions) => {
      const rateLimitInfo = (request as express.Request & { rateLimit?: { used: number } }).rateLimit;
      if (!rateLimitInfo || rateLimitInfo.used === limit + 1) {
        securityLogger(createSecurityEvent(request, {
          severity: "warning",
          event: "rate_limit.exceeded",
          outcome: "blocked",
          reason: "request_volume_exceeded",
          actor: request.authUser
            ? { userId: request.authUser.id, role: request.authUser.role }
            : undefined,
          control: {
            name: identifier,
            limit,
            windowMs,
            observedRequests: rateLimitInfo?.used,
          },
          statusCode: rateLimitOptions.statusCode,
        }));
      }
      response.status(rateLimitOptions.statusCode).json(message);
    },
  });
  if (rateLimitsEnabled) {
    app.use("/api", monitoredRateLimit({
      windowMs: 60 * 1000,
      limit: 300,
      identifier: "global-api",
      message: { message: "Too many API requests. Please try again later." },
    }));
    app.use("/api/auth/login", monitoredRateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 10,
      identifier: "sign-in",
      message: { message: "Too many sign-in attempts. Please try again later." },
    }));
    app.use("/api/health", monitoredRateLimit({
      windowMs: 60 * 1000,
      limit: 60,
      identifier: "health-check",
      message: { message: "Too many health checks. Please try again later." },
    }));
    authenticatedReadLimiter = monitoredRateLimit({
      windowMs: 60 * 1000,
      limit: 120,
      identifier: "authenticated-reads",
      skip: (request) => request.method !== "GET" && request.method !== "HEAD",
      message: { message: "Too many data requests. Please try again later." },
    });
    operationsReportLimiter = monitoredRateLimit({
      windowMs: 60 * 1000,
      limit: 30,
      identifier: "operations-report",
      message: { message: "Too many report requests. Please try again later." },
    });
  }
  app.use(express.json());

  app.get("/api/health", async (_request, response) => {
    const result = await pool.query<{ now: string }>("SELECT NOW() AS now");
    response.json({ status: "ok", databaseTime: result.rows[0].now });
  });

  registerAuthRoutes(
    app,
    pool,
    options.secureCookies ?? process.env.COOKIE_SECURE === "true",
    operatorLoginEnabled,
    authenticatedReadLimiter,
    securityLogger,
  );
  if (options.authRequired !== false) app.use("/api", authenticate(pool, securityLogger));
  app.use("/api", authenticatedReadLimiter);
  const operatorOnly: express.RequestHandler = options.authRequired === false
    ? (_request, _response, next) => next()
    : operatorLoginEnabled
      ? requireRole("operator", securityLogger)
      : (request, response) => {
          securityLogger(createSecurityEvent(request, {
            severity: "warning",
            event: "authorization.operator_mutation_blocked",
            outcome: "blocked",
            reason: "operator_mutations_disabled",
            actor: request.authUser
              ? { userId: request.authUser.id, role: request.authUser.role }
              : undefined,
            statusCode: 403,
          }));
          response.status(403).json({ message: "Order changes are disabled in the public demo" });
        };

  if (rateLimitsEnabled) {
    app.use("/api/orders", monitoredRateLimit({
      windowMs: 60 * 1000,
      limit: 30,
      identifier: "order-mutations",
      skip: (request) => request.method !== "POST" && request.method !== "PATCH",
      message: { message: "Too many order changes. Please try again later." },
    }));
  }

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

  app.get("/api/reports/operations", operationsReportLimiter, async (_request, response) => {
    const [orderStatus, inventoryByCategory] = await Promise.all([
      pool.query(
        `WITH statuses (status, position) AS (
           VALUES ('processing', 1), ('shipped', 2), ('delivered', 3)
         )
         SELECT statuses.status, COUNT(orders.id)::int AS "orderCount",
                COALESCE(SUM(orders.total), 0)::float AS revenue
         FROM statuses LEFT JOIN orders ON orders.status = statuses.status
         GROUP BY statuses.status, statuses.position ORDER BY statuses.position`,
      ),
      pool.query(
        `SELECT category, COUNT(*)::int AS "productCount", SUM(stock)::int AS "stockUnits",
                COUNT(*) FILTER (WHERE stock <= reorder_level)::int AS "lowStockItems"
         FROM products GROUP BY category ORDER BY category ASC`,
      ),
    ]);
    response.json({ orderStatus: orderStatus.rows, inventoryByCategory: inventoryByCategory.rows });
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

  app.post("/api/orders", operatorOnly, async (request, response) => {
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

  app.patch("/api/orders/:id", operatorOnly, async (request, response) => {
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

  if (options.staticAssetsPath) {
    app.use(express.static(options.staticAssetsPath));
    app.use((request, response, next) => {
      if (request.method !== "GET" || request.path === "/api" || request.path.startsWith("/api/")) { next(); return; }
      response.sendFile("index.html", { root: options.staticAssetsPath });
    });
  }

  app.use((error: unknown, request: express.Request, response: express.Response, _next: express.NextFunction) => {
    securityLogger(createSecurityEvent(request, {
      severity: "error",
      event: "application.unexpected_error",
      outcome: "error",
      reason: "unhandled_request_error",
      actor: request.authUser
        ? { userId: request.authUser.id, role: request.authUser.role }
        : undefined,
      error: securityError(error),
      statusCode: 500,
    }));
    response.status(500).json({ message: "Unexpected server error" });
  });
  return app;
}
