// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OperationsInsightsPanel } from "./OperationsInsights";

const data = {
  orderStatus: [
    { status: "processing" as const, orderCount: 2, revenue: 77 },
    { status: "shipped" as const, orderCount: 1, revenue: 42 },
    { status: "delivered" as const, orderCount: 2, revenue: 145 },
  ],
  inventoryByCategory: [
    { category: "Accessories", productCount: 2, stockUnits: 43, lowStockItems: 0 },
    { category: "Apparel", productCount: 2, stockUnits: 50, lowStockItems: 1 },
  ],
};

describe("OperationsInsightsPanel", () => {
  it("pairs visual charts with accessible reporting tables", () => {
    render(<OperationsInsightsPanel data={data} />);

    const region = screen.getByRole("region", { name: "Operations insights" });
    const fulfillment = within(region).getByRole("table", { name: "Fulfillment report data" });
    const inventory = within(region).getByRole("table", { name: "Inventory report data" });

    expect(within(fulfillment).getByRole("row", { name: "Delivered 2 $145.00" })).toBeInTheDocument();
    expect(within(inventory).getByRole("row", { name: "Apparel 2 50 1" })).toBeInTheDocument();
    expect(region.querySelectorAll(".chart-visual[aria-hidden='true']")).toHaveLength(2);
    expect(region.querySelector(".chart-fill.processing")).toHaveStyle({ width: "100%" });
  });

  it("announces loading and unavailable states", () => {
    const { rerender } = render(<OperationsInsightsPanel data={undefined} />);
    expect(screen.getByText("Loading reporting data...")).toHaveAttribute("aria-live", "polite");

    rerender(<OperationsInsightsPanel data={null} />);
    expect(screen.getByText("Reporting data is unavailable.")).toBeInTheDocument();
  });
});
