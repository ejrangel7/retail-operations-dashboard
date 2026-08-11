import { expect, test } from "@playwright/test";

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
  await orders.getByLabel("Status").selectOption("processing");
  await expect(orders.getByText("2 matching orders")).toBeVisible();
  await orders.getByPlaceholder("Order or customer").fill("BT-1048");
  await orders.getByRole("button", { name: "Apply order search" }).click();
  await expect(orders.getByLabel("Status")).toHaveValue("all");
  await expect(orders.getByText("1 matching orders")).toBeVisible();
  await expect(orders.getByRole("cell", { name: "BT-1048" })).toBeVisible();

  await page.getByRole("link", { name: "Inventory" }).click();
  await expect(page).toHaveURL(/#inventory$/);
  const inventory = page.getByRole("region", { name: "Stock watch" });
  await inventory.getByLabel("Stock").selectOption("low");
  await expect(inventory.getByText("2 matching products")).toBeVisible();
  await inventory.getByPlaceholder("SKU or product").fill("Catitude Mug");
  await inventory.getByPlaceholder("SKU or product").press("Enter");
  await expect(inventory.getByLabel("Stock")).toHaveValue("all");
  await expect(inventory.getByText("1 matching products")).toBeVisible();
  await expect(inventory.getByRole("heading", { name: "Catitude Mug" })).toBeVisible();
});
