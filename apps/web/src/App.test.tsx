// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const orders = Array.from({ length: 4 }, (_, index) => ({
  id: index + 1,
  orderNumber: `ORD-00${index + 1}`,
  customerName: `Customer ${index + 1}`,
  status: "processing" as const,
  total: 25 + index,
  createdAt: "2026-08-07T12:00:00.000Z",
}));

function mockDashboardRequests() {
  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
    const url = String(input);
    const data = url.endsWith("/dashboard")
      ? { totalProducts: 1, totalOrders: 4, revenue: 106, lowStockItems: 1 }
      : url.endsWith("/products")
        ? [{ id: 1, sku: "SKU-001", name: "Travel Mug", category: "Accessories", price: 49.5, stock: 2, reorderLevel: 3 }]
        : orders;
    return Promise.resolve(new Response(JSON.stringify(data), { status: 200 }));
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("App", () => {
  it("loads dashboard data and expands all orders", async () => {
    mockDashboardRequests();
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText("$106.00")).toBeInTheDocument();
    expect(screen.queryByText("ORD-004")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "View all" }));
    expect(screen.getByText("ORD-004")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show recent" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("shows a useful error when API requests fail", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "The dashboard data could not be loaded.",
      );
    });
  });
});
