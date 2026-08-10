// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { AuthUser } from "./types";

const operatorUser: AuthUser = { id: 1, email: "operator@retail.local", displayName: "Operations Manager", role: "operator" };
const viewerUser: AuthUser = { id: 2, email: "viewer@retail.local", displayName: "Reporting Viewer", role: "viewer" };

const orders = Array.from({ length: 4 }, (_, index) => ({
  id: index + 1,
  orderNumber: `ORD-00${index + 1}`,
  customerName: `Customer ${index + 1}`,
  status: "processing" as const,
  total: 25 + index,
  createdAt: "2026-08-07T12:00:00.000Z",
}));

const insights = {
  orderStatus: [
    { status: "processing", orderCount: 2, revenue: 51 },
    { status: "shipped", orderCount: 1, revenue: 27 },
    { status: "delivered", orderCount: 1, revenue: 28 },
  ],
  inventoryByCategory: [
    { category: "Accessories", productCount: 4, stockUnits: 10, lowStockItems: 3 },
  ],
};

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

function mockDashboardRequests(duplicateOrder = false, authenticatedUser = operatorUser, loginUser = authenticatedUser) {
  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    if (url.pathname.endsWith("/auth/me")) {
      return Promise.resolve(new Response(JSON.stringify(authenticatedUser)));
    }
    if (url.pathname.endsWith("/auth/logout")) return Promise.resolve(new Response(null, { status: 204 }));
    if (method === "POST" && url.pathname.endsWith("/auth/login")) {
      return Promise.resolve(new Response(JSON.stringify(loginUser)));
    }
    if (method === "POST" && url.pathname.endsWith("/orders")) {
      if (duplicateOrder) {
        return Promise.resolve(new Response(JSON.stringify({ message: "An order with this number already exists" }), { status: 409 }));
      }
      const body = JSON.parse(String(init?.body));
      return Promise.resolve(new Response(JSON.stringify({
        id: 5,
        ...body,
        createdAt: "2026-08-08T12:00:00.000Z",
      }), { status: 201 }));
    }
    if (method === "PATCH" && url.pathname.includes("/orders/")) {
      const body = JSON.parse(String(init?.body));
      return Promise.resolve(new Response(JSON.stringify({ ...orders[0], ...body })));
    }
    if (url.pathname.endsWith("/dashboard")) {
      return Promise.resolve(new Response(JSON.stringify({ totalProducts: 4, totalOrders: 4, revenue: 106, lowStockItems: 3 })));
    }
    if (url.pathname.endsWith("/reports/operations")) {
      return Promise.resolve(new Response(JSON.stringify(insights)));
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
    expect(await screen.findByRole("region", { name: "Operations insights" })).toBeInTheDocument();
    expect(await screen.findByText("ORD-003")).toBeInTheDocument();
    expect(screen.queryByText("ORD-004")).not.toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Orders pagination" })).getByText("Page 1 of 2")).toBeInTheDocument();

    await user.click(within(screen.getByRole("region", { name: "Orders" })).getByRole("button", { name: "View all" }));
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

  it("shows all inventory products and restores pagination", async () => {
    mockDashboardRequests();
    const user = userEvent.setup();
    render(<App />);
    const inventory = await screen.findByRole("region", { name: "Stock watch" });
    await within(inventory).findByText("Product 1");

    await user.click(within(inventory).getByRole("button", { name: "View all" }));
    expect(await within(inventory).findByText("Product 4")).toBeInTheDocument();
    expect(within(inventory).getByRole("button", { name: "Show pages" })).toHaveAttribute("aria-expanded", "true");
    expect(within(inventory).queryByRole("navigation", { name: "Products pagination" })).not.toBeInTheDocument();

    await user.click(within(inventory).getByRole("button", { name: "Show pages" }));
    expect(await within(inventory).findByRole("navigation", { name: "Products pagination" })).toHaveTextContent("Page 1 of 2");
  });

  it("applies order search and resets the status filter", async () => {
    mockDashboardRequests();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("ORD-001");

    await user.type(screen.getByPlaceholderText("Order or customer"), "Customer 1");
    await user.selectOptions(screen.getByLabelText("Status"), "processing");
    const applyOrderSearch = within(screen.getByRole("form", { name: "Filter orders" })).getByRole("button", { name: "Apply order search" });
    expect(applyOrderSearch).toHaveAttribute("title", "Apply search");
    expect(screen.getByRole("button", { name: "Apply inventory search" })).toHaveAttribute("title", "Apply search");
    await user.click(applyOrderSearch);

    await waitFor(() => {
      const fetchMock = vi.mocked(fetch);
      expect(fetchMock.mock.calls.some(([input]) => {
        const url = String(input);
        return url.includes("/orders?") && url.includes("search=Customer+1") && !url.includes("status=");
      })).toBe(true);
    });
    expect(screen.getByLabelText("Status")).toHaveValue("all");
    expect(screen.getByText("1 matching orders")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reset order filters" }));
    expect(screen.getByPlaceholderText("Order or customer")).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Reset order filters" })).not.toBeInTheDocument();
  });

  it("submits inventory search with Enter, resets stock, and clears all filters", async () => {
    mockDashboardRequests();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Product 1");

    const productSearch = screen.getByPlaceholderText("SKU or product");
    await user.type(productSearch, "Product 1");
    await user.selectOptions(screen.getByLabelText("Stock"), "low");
    await user.type(productSearch, "{Enter}");

    await waitFor(() => {
      const fetchMock = vi.mocked(fetch);
      expect(fetchMock.mock.calls.some(([input]) => {
        const url = String(input);
        return url.includes("/products?") && url.includes("search=Product+1") && !url.includes("stock=");
      })).toBe(true);
    });
    expect(screen.getByLabelText("Stock")).toHaveValue("all");

    await user.click(screen.getByRole("button", { name: "Reset inventory filters" }));
    expect(productSearch).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Reset inventory filters" })).not.toBeInTheDocument();
  });

  it("creates an order from the dashboard form", async () => {
    mockDashboardRequests();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("ORD-001");

    await user.click(screen.getByRole("button", { name: "New order" }));
    const form = screen.getByRole("form", { name: "Create order" });
    const orderNumber = within(form).getByLabelText("Order number");
    await user.type(orderNumber, "1049");
    expect(orderNumber).toHaveAttribute("aria-invalid", "true");
    expect(orderNumber).toHaveClass("input-danger");
    expect(within(form).getByRole("alert")).toHaveTextContent("Order number must use the format BT-0000.");
    await user.clear(orderNumber);
    await user.type(orderNumber, "bt-1049");
    expect(orderNumber).toHaveValue("BT-1049");
    expect(orderNumber).toHaveAttribute("aria-invalid", "false");
    expect(within(form).queryByRole("alert")).not.toBeInTheDocument();
    await user.type(within(form).getByLabelText("Customer"), "Sample Customer F");
    await user.type(within(form).getByLabelText("Total"), "84.50");
    await user.click(within(form).getByRole("button", { name: "Create order" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Order BT-1049 created successfully.");
    const postCall = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "POST");
    expect(postCall).toBeDefined();
    expect(JSON.parse(String(postCall?.[1]?.body))).toEqual({
      orderNumber: "BT-1049",
      customerName: "Sample Customer F",
      status: "processing",
      total: 84.5,
    });
  });

  it("clears workspace messages when a new session starts", async () => {
    mockDashboardRequests(false, operatorUser, viewerUser);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("ORD-001");

    await user.click(screen.getByRole("button", { name: "New order" }));
    const form = screen.getByRole("form", { name: "Create order" });
    await user.type(within(form).getByLabelText("Order number"), "BT-1050");
    await user.type(within(form).getByLabelText("Customer"), "Session test");
    await user.type(within(form).getByLabelText("Total"), "10");
    await user.click(within(form).getByRole("button", { name: "Create order" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Order BT-1050 created successfully.");

    await user.click(screen.getByRole("button", { name: "Sign out" }));
    await user.type(screen.getByLabelText("Email"), viewerUser.email);
    await user.type(screen.getByLabelText("Password"), "RetailView!2026");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("heading", { name: "Good morning, Reporting Viewer." })).toBeInTheDocument();
    expect(screen.queryByText("Order BT-1050 created successfully.")).not.toBeInTheDocument();
  });

  it("shows duplicate order feedback in the reserved form footer", async () => {
    mockDashboardRequests(true);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("ORD-001");

    await user.click(screen.getByRole("button", { name: "New order" }));
    const form = screen.getByRole("form", { name: "Create order" });
    const errorSlot = form.querySelector(".order-form-submit-error");
    expect(errorSlot).toBeInTheDocument();
    expect(errorSlot).not.toHaveAttribute("role", "alert");

    await user.type(within(form).getByLabelText("Order number"), "BT-1048");
    await user.type(within(form).getByLabelText("Customer"), "Sample Customer");
    await user.type(within(form).getByLabelText("Total"), "7.00");
    await user.click(within(form).getByRole("button", { name: "Create order" }));

    expect(await within(form).findByRole("alert")).toHaveTextContent("An order with this number already exists");
    expect(form.querySelector(".order-form-submit-error")).toBe(errorSlot);
    expect(document.querySelector(".error-banner")).not.toBeInTheDocument();
    expect(within(form).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(within(form).getByRole("button", { name: "Create order" })).toBeInTheDocument();
  });

  it("renders viewer access as read-only", async () => {
    mockDashboardRequests(false, viewerUser);
    render(<App />);
    await screen.findByText("ORD-001");

    expect(screen.getByRole("heading", { name: "Good morning, Reporting Viewer." })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New order" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Update status for ORD-001")).not.toBeInTheDocument();
    expect(screen.getAllByText("processing").length).toBeGreaterThan(0);
  });

  it("updates fulfillment status from the orders table", async () => {
    mockDashboardRequests();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("ORD-001");

    await user.selectOptions(screen.getByLabelText("Update status for ORD-001"), "shipped");

    expect(await screen.findByRole("status")).toHaveTextContent("Order ORD-001 updated to shipped.");
    const patchCall = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(patchCall?.[0].toString()).toContain("/orders/1");
    expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({ status: "shipped" });
  });

  it("shows useful feedback when operational API requests fail", async () => {
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/auth/me")) return Promise.resolve(new Response(JSON.stringify(operatorUser)));
      return Promise.resolve(new Response(null, { status: 500 }));
    }));
    render(<App />);
    await waitFor(() => expect(screen.getAllByRole("alert")[0]).toBeInTheDocument());
  });
});
