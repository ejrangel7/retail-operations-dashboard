import { describe, expect, it } from "vitest";
import { createCsvReport, reportFilename } from "./report";
import type { DashboardSummary, Order, Product } from "./types";

const summary: DashboardSummary = {
  totalProducts: 1,
  totalOrders: 1,
  revenue: 49.5,
  lowStockItems: 1,
};

const orders: Order[] = [{
  id: 1,
  orderNumber: "ORD-001",
  customerName: 'Doe, "Jane"',
  sku: "SKU-001",
  status: "processing",
  total: 49.5,
  createdAt: "2026-08-07T12:00:00.000Z",
}];

const products: Product[] = [{
  id: 1,
  sku: "SKU-001",
  name: "Travel Mug",
  category: "Accessories",
  price: 49.5,
  stock: 2,
  reorderLevel: 3,
}];

describe("CSV report", () => {
  it("exports overview, orders and inventory with safe CSV escaping", () => {
    const report = createCsvReport(
      summary,
      orders,
      products,
      new Date("2026-08-07T15:30:00.000Z"),
    );
    expect(report).toContain('"Generated at","2026-08-07T15:30:00.000Z"');
    expect(report).toContain('"Doe, ""Jane"""');
    expect(report).toContain('"Order","Customer","SKU","Status","Total","Created at"');
    expect(report).toContain('"SKU-001","Travel Mug","Accessories","49.50","2","3","Reorder"');
  });

  it("uses the generation date in the filename", () => {
    expect(reportFilename(new Date("2026-08-07T23:59:59.000Z"))).toBe(
      "retail-operations-report-2026-08-07.csv",
    );
  });
});
