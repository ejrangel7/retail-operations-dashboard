import type { DashboardSummary, Order, Product } from "./types";

const escapeCsvCell = (value: string | number) =>
  `"${String(value).replaceAll('"', '""')}"`;

export function createCsvReport(
  summary: DashboardSummary,
  orders: Order[],
  products: Product[],
  generatedAt = new Date(),
) {
  const rows: Array<Array<string | number>> = [
    ["Retail Operations Report"],
    ["Generated at", generatedAt.toISOString()],
    [],
    ["Business overview"],
    ["Revenue", "Orders", "Products", "Low stock items"],
    [summary.revenue.toFixed(2), summary.totalOrders, summary.totalProducts, summary.lowStockItems],
    [],
    ["Orders"],
    ["Order", "Customer", "SKU", "Status", "Total", "Created at"],
    ...orders.map((order) => [
      order.orderNumber,
      order.customerName,
      order.sku,
      order.status,
      order.total.toFixed(2),
      new Date(order.createdAt).toISOString(),
    ]),
    [],
    ["Inventory"],
    ["SKU", "Product", "Category", "Price", "Stock", "Reorder level", "Stock status"],
    ...products.map((product) => [
      product.sku,
      product.name,
      product.category,
      product.price.toFixed(2),
      product.stock,
      product.reorderLevel,
      product.stock <= product.reorderLevel ? "Reorder" : "In stock",
    ]),
  ];

  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\r\n");
}

export function reportFilename(generatedAt = new Date()) {
  return `retail-operations-report-${generatedAt.toISOString().slice(0, 10)}.csv`;
}
