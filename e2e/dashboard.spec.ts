import { expect, test } from "@playwright/test";

test("the development-only operator seed supports local workflows", async ({ page }) => {
  await page.goto("/");

  await page.getByLabel("Email").fill("operator@retail.local");
  await page.getByLabel("Password").fill("RetailOps!2026");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("heading", { name: "Good morning, Operations Manager." })).toBeVisible();
  await expect(page.getByRole("button", { name: "New order" })).toBeVisible();
});

test("viewer can sign in, navigate, and filter operational data", async ({ page }) => {
  await page.goto("/");

  await page.getByLabel("Email").fill("viewer@retail.local");
  await page.getByLabel("Password").fill("RetailView!2026");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("heading", { name: "Good morning, Reporting Viewer." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Business overview" })).toBeVisible();

  await page.getByRole("link", { name: "Reports" }).click();
  await expect(page).toHaveURL(/#reports$/);
  await expect(page.getByRole("heading", { name: "Operations insights" })).toBeVisible();

  await page.getByRole("link", { name: "Orders" }).click();
  await expect(page).toHaveURL(/#orders$/);
  const orders = page.getByRole("region", { name: "Orders" });
  const filteredOrdersResponse = page.waitForResponse((response) =>
    response.url().includes("/api/orders?")
      && new URL(response.url()).searchParams.get("status") === "processing",
  );
  await orders.getByLabel("Status").selectOption("processing");
  const filteredOrders = await filteredOrdersResponse;
  const filteredOrdersPayload = await filteredOrders.json() as {
    items: Array<{ status: string }>;
    pagination: { total: number };
  };
  expect(filteredOrders.ok()).toBe(true);
  expect(filteredOrdersPayload.items.every((order) => order.status === "processing")).toBe(true);
  await expect(orders.getByText(`${filteredOrdersPayload.pagination.total} matching orders`)).toBeVisible();
  await orders.getByPlaceholder("Order or customer").fill("BT-1048");
  await orders.getByRole("button", { name: "Apply order search" }).click();
  await expect(orders.getByLabel("Status")).toHaveValue("all");
  await expect(orders.getByText("1 matching orders")).toBeVisible();
  await expect(orders.getByRole("cell", { name: "BT-1048" })).toBeVisible();

  await page.getByRole("link", { name: "Inventory" }).click();
  await expect(page).toHaveURL(/#inventory$/);
  const inventory = page.getByRole("region", { name: "Stock watch" });
  const lowStockResponse = page.waitForResponse((response) =>
    response.url().includes("/api/products?")
      && new URL(response.url()).searchParams.get("stock") === "low",
  );
  await inventory.getByLabel("Stock").selectOption("low");
  const lowStock = await lowStockResponse;
  const lowStockPayload = await lowStock.json() as {
    items: Array<{ stock: number; reorderLevel: number }>;
    pagination: { total: number };
  };
  expect(lowStock.ok()).toBe(true);
  expect(lowStockPayload.items.every((product) => product.stock <= product.reorderLevel)).toBe(true);
  await expect(inventory.getByText(`${lowStockPayload.pagination.total} matching products`)).toBeVisible();
  await inventory.getByPlaceholder("SKU or product").fill("Catitude Mug");
  await inventory.getByPlaceholder("SKU or product").press("Enter");
  await expect(inventory.getByLabel("Stock")).toHaveValue("all");
  await expect(inventory.getByText("1 matching products")).toBeVisible();
  await expect(inventory.getByRole("heading", { name: "Catitude Mug" })).toBeVisible();
});
