// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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

const products = Array.from({ length: 4 }, (_, index) => ({
  id: index + 1,
  sku: `SKU-00${index + 1}`,
  name: `Product ${index + 1}`,
  category: "Accessories",
  price: 20 + index,
  stock: index + 1,
  reorderLevel: 3,
}));

function page<T>(items: T[], currentPage: number, pageSize: number, total: number) {
  return { items, pagination: { page: currentPage, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
}

function mockDashboardRequests() {
  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/dashboard")) {
      return Promise.resolve(new Response(JSON.stringify({ totalProducts: 4, totalOrders: 4, revenue: 106, lowStockItems: 3 })));
    }
    const pageSize = Number(url.searchParams.get("pageSize"));
    const currentPage = Number(url.searchParams.get("page"));
    const start = (currentPage - 1) * pageSize;
    if (url.pathname.endsWith("/orders")) {
      const filteredOrders = url.searchParams.has("search") ? orders.slice(0, 1) : orders;
      return Promise.resolve(new Response(JSON.stringify(page(filteredOrders.slice(start, start + pageSize), currentPage, pageSize, filteredOrders.length))));
    }
    const filteredProducts = url.searchParams.has("search") ? products.slice(0, 1) : products;
    return Promise.resolve(new Response(JSON.stringify(page(filteredProducts.slice(start, start + pageSize), currentPage, pageSize, filteredProducts.length))));
  }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("App", () => {
  it("loads paginated data and preserves View all", async () => {
    mockDashboardRequests();
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText("$106.00")).toBeInTheDocument();
    expect(await screen.findByText("ORD-003")).toBeInTheDocument();
    expect(screen.queryByText("ORD-004")).not.toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Orders pagination" })).getByText("Page 1 of 2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "View all" }));
    expect(await screen.findByText("ORD-004")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show pages" })).toHaveAttribute("aria-expanded", "true");
  });

  it("requests the next inventory page", async () => {
    mockDashboardRequests();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Product 1");

    await user.click(within(screen.getByRole("navigation", { name: "Products pagination" })).getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Product 4")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Products pagination" })).toHaveTextContent("Page 2 of 2");
  });

  it("applies order search and status filters", async () => {
    mockDashboardRequests();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("ORD-001");

    await user.type(screen.getByPlaceholderText("Order or customer"), "Customer 1");
    await user.selectOptions(screen.getByLabelText("Status"), "processing");
    await user.click(within(screen.getByRole("form", { name: "Filter orders" })).getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      const fetchMock = vi.mocked(fetch);
      expect(fetchMock.mock.calls.some(([input]) => {
        const url = String(input);
        return url.includes("search=Customer+1") && url.includes("status=processing");
      })).toBe(true);
    });
    expect(screen.getByText("1 matching orders")).toBeInTheDocument();
  });

  it("shows useful feedback when API requests fail", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
    render(<App />);
    await waitFor(() => expect(screen.getAllByRole("alert")[0]).toBeInTheDocument());
  });
});
