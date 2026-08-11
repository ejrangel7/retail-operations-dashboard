import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const baseURL = process.env.SCREENSHOT_BASE_URL ?? "https://retail-operations-dashboard.onrender.com";
const outputDirectory = fileURLToPath(new URL("../docs/images/", import.meta.url));
await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });

try {
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill("viewer@retail.local");
  await page.getByLabel("Password").fill("RetailView!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "Good morning, Reporting Viewer." }).waitFor();
  await page.getByRole("table", { name: "Fulfillment report data" }).waitFor();
  await page.screenshot({ path: join(outputDirectory, "dashboard-overview.png"), fullPage: false });
  await page.locator("#reports").screenshot({ path: join(outputDirectory, "dashboard-insights.png") });
} finally {
  await browser.close();
}
