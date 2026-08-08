import { useEffect, useState } from "react";
import { createCsvReport, reportFilename } from "./report";
import type { DashboardSummary, Order, PaginatedResponse, Pagination, Product } from "./types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api";
const PAGE_SIZE = 3;

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const date = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const emptyPagination = (pageSize = PAGE_SIZE): Pagination => ({
  page: 1,
  pageSize,
  total: 0,
  totalPages: 1,
});

async function fetchJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { signal });
  if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
  return response.json() as Promise<T>;
}

function collectionPath(
  resource: "orders" | "products",
  page: number,
  pageSize: number,
  search: string,
  filterName: "status" | "stock",
  filterValue: string,
) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (search) params.set("search", search);
  if (filterValue !== "all") params.set(filterName, filterValue);
  return `/${resource}?${params.toString()}`;
}

async function fetchAllPages<T>(pathForPage: (page: number) => string) {
  const first = await fetchJson<PaginatedResponse<T>>(pathForPage(1));
  if (first.pagination.totalPages === 1) return first.items;
  const remaining = await Promise.all(
    Array.from({ length: first.pagination.totalPages - 1 }, (_, index) =>
      fetchJson<PaginatedResponse<T>>(pathForPage(index + 2)),
    ),
  );
  return [first, ...remaining].flatMap((result) => result.items);
}

function App() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderPagination, setOrderPagination] = useState(emptyPagination());
  const [products, setProducts] = useState<Product[]>([]);
  const [productPagination, setProductPagination] = useState(emptyPagination());
  const [orderPage, setOrderPage] = useState(1);
  const [productPage, setProductPage] = useState(1);
  const [showAllOrders, setShowAllOrders] = useState(false);
  const [orderSearchInput, setOrderSearchInput] = useState("");
  const [orderSearch, setOrderSearch] = useState("");
  const [orderStatus, setOrderStatus] = useState("all");
  const [productSearchInput, setProductSearchInput] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [stockFilter, setStockFilter] = useState("all");
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    fetchJson<DashboardSummary>("/dashboard")
      .then(setSummary)
      .catch(() => setError("The dashboard data could not be loaded."));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const pageSize = showAllOrders ? 100 : PAGE_SIZE;
    fetchJson<PaginatedResponse<Order>>(
      collectionPath("orders", orderPage, pageSize, orderSearch, "status", orderStatus),
      controller.signal,
    )
      .then((result) => {
        setOrders(result.items);
        setOrderPagination(result.pagination);
      })
      .catch((requestError: unknown) => {
        if (!(requestError instanceof DOMException && requestError.name === "AbortError")) {
          setError("Orders could not be loaded.");
        }
      });
    return () => controller.abort();
  }, [orderPage, orderSearch, orderStatus, showAllOrders]);

  useEffect(() => {
    const controller = new AbortController();
    fetchJson<PaginatedResponse<Product>>(
      collectionPath("products", productPage, PAGE_SIZE, productSearch, "stock", stockFilter),
      controller.signal,
    )
      .then((result) => {
        setProducts(result.items);
        setProductPagination(result.pagination);
      })
      .catch((requestError: unknown) => {
        if (!(requestError instanceof DOMException && requestError.name === "AbortError")) {
          setError("Inventory could not be loaded.");
        }
      });
    return () => controller.abort();
  }, [productPage, productSearch, stockFilter]);

  async function exportReport() {
    if (!summary || exporting) return;
    setExporting(true);
    try {
      const [allOrders, allProducts] = await Promise.all([
        fetchAllPages<Order>((page) =>
          collectionPath("orders", page, 100, orderSearch, "status", orderStatus),
        ),
        fetchAllPages<Product>((page) =>
          collectionPath("products", page, 100, productSearch, "stock", stockFilter),
        ),
      ]);
      const now = new Date();
      const csv = createCsvReport(summary, allOrders, allProducts, now);
      const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = reportFilename(now);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("The report could not be exported.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#top" aria-label="Retail Operations home">
          <span className="brand-mark">RO</span><span>Retail Ops</span>
        </a>
        <nav aria-label="Primary navigation">
          <a className="nav-link active" href="#overview">Overview</a>
          <a className="nav-link" href="#orders">Orders</a>
          <a className="nav-link" href="#inventory">Inventory</a>
        </nav>
        <div className="sidebar-note"><span className="status-dot" /> Demo environment</div>
      </aside>

      <main id="top">
        <header className="topbar">
          <div>
            <p className="eyebrow">Operations workspace</p>
            <h1>Good morning, Edward.</h1>
            <p>Here is what is happening across the store today.</p>
          </div>
          <button type="button" className="secondary-button" onClick={exportReport} disabled={!summary || exporting}>
            {exporting ? "Exporting…" : "Export report"}
          </button>
        </header>

        {error && <div className="error-banner" role="alert">{error}</div>}

        <section id="overview" aria-labelledby="overview-title">
          <div className="section-heading">
            <div><p className="eyebrow">At a glance</p><h2 id="overview-title">Business overview</h2></div>
            <span className="updated-label">Sample data</span>
          </div>
          <div className="metric-grid">
            <MetricCard label="Revenue" value={summary ? money.format(summary.revenue) : "—"} trend="Across sample orders" />
            <MetricCard label="Orders" value={summary?.totalOrders ?? "—"} trend="Recent activity" />
            <MetricCard label="Products" value={summary?.totalProducts ?? "—"} trend="Active catalog" />
            <MetricCard label="Low stock" value={summary?.lowStockItems ?? "—"} trend="Needs attention" alert />
          </div>
        </section>

        <div className="content-grid">
          <section id="orders" className="panel" aria-labelledby="orders-title">
            <div className="panel-heading">
              <div><p className="eyebrow">Fulfillment</p><h2 id="orders-title">Orders</h2></div>
              {orderPagination.total > PAGE_SIZE && (
                <button className="text-button" type="button" aria-expanded={showAllOrders} aria-controls="orders-table"
                  onClick={() => { setShowAllOrders((current) => !current); setOrderPage(1); }}>
                  {showAllOrders ? "Show pages" : "View all"}
                </button>
              )}
            </div>
            <form className="filters" aria-label="Filter orders" onSubmit={(event) => {
              event.preventDefault(); setOrderSearch(orderSearchInput.trim()); setOrderPage(1); setShowAllOrders(false);
            }}>
              <label className="filter-field"><span>Search</span>
                <input value={orderSearchInput} onChange={(event) => setOrderSearchInput(event.target.value)} placeholder="Order or customer" />
              </label>
              <label className="filter-field"><span>Status</span>
                <select value={orderStatus} onChange={(event) => { setOrderStatus(event.target.value); setOrderPage(1); setShowAllOrders(false); }}>
                  <option value="all">All statuses</option><option value="processing">Processing</option>
                  <option value="shipped">Shipped</option><option value="delivered">Delivered</option>
                </select>
              </label>
              <button className="filter-submit" type="submit">Apply</button>
            </form>
            <p className="results-meta" aria-live="polite">{orderPagination.total} matching orders</p>
            <div className="table-wrap" id="orders-table">
              <table>
                <thead><tr><th>Order</th><th>Customer</th><th>Status</th><th>Total</th><th>Date</th></tr></thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id}><td className="strong">{order.orderNumber}</td><td>{order.customerName}</td>
                      <td><span className={`status ${order.status}`}>{order.status}</span></td>
                      <td>{money.format(order.total)}</td><td>{date.format(new Date(order.createdAt))}</td></tr>
                  ))}
                  {orders.length === 0 && <tr><td className="empty-state" colSpan={5}>No orders match these filters.</td></tr>}
                </tbody>
              </table>
            </div>
            {!showAllOrders && <PaginationControls label="Orders" pagination={orderPagination} onPageChange={setOrderPage} />}
          </section>

          <section id="inventory" className="panel inventory-panel" aria-labelledby="inventory-title">
            <div className="panel-heading"><div><p className="eyebrow">Inventory</p><h2 id="inventory-title">Stock watch</h2></div></div>
            <form className="filters" aria-label="Filter inventory" onSubmit={(event) => {
              event.preventDefault(); setProductSearch(productSearchInput.trim()); setProductPage(1);
            }}>
              <label className="filter-field"><span>Search</span>
                <input value={productSearchInput} onChange={(event) => setProductSearchInput(event.target.value)} placeholder="SKU or product" />
              </label>
              <label className="filter-field"><span>Stock</span>
                <select value={stockFilter} onChange={(event) => { setStockFilter(event.target.value); setProductPage(1); }}>
                  <option value="all">All stock</option><option value="low">Reorder</option><option value="in-stock">In stock</option>
                </select>
              </label>
              <button className="filter-submit" type="submit">Apply</button>
            </form>
            <p className="results-meta" aria-live="polite">{productPagination.total} matching products</p>
            <div className="product-list">
              {products.map((product) => {
                const low = product.stock <= product.reorderLevel;
                return <article className="product-row" key={product.id}>
                  <div><h3>{product.name}</h3><p>{product.sku} · {product.category}</p></div>
                  <div className="stock-count"><strong className={low ? "low" : ""}>{product.stock}</strong><span>{low ? "Reorder" : "In stock"}</span></div>
                </article>;
              })}
              {products.length === 0 && <p className="empty-state">No products match these filters.</p>}
            </div>
            <PaginationControls label="Products" pagination={productPagination} onPageChange={setProductPage} />
          </section>
        </div>
      </main>
    </div>
  );
}

function PaginationControls({ label, pagination, onPageChange }: {
  label: string;
  pagination: Pagination;
  onPageChange: (page: number) => void;
}) {
  return <nav className="pagination" aria-label={`${label} pagination`}>
    <button type="button" disabled={pagination.page <= 1} onClick={() => onPageChange(pagination.page - 1)}>Previous</button>
    <span>Page {pagination.page} of {pagination.totalPages}</span>
    <button type="button" disabled={pagination.page >= pagination.totalPages} onClick={() => onPageChange(pagination.page + 1)}>Next</button>
  </nav>;
}

function MetricCard({ label, value, trend, alert = false }: { label: string; value: string | number; trend: string; alert?: boolean }) {
  return <article className={`metric-card${alert ? " alert" : ""}`}><p>{label}</p><strong>{value}</strong><span>{trend}</span></article>;
}

export default App;
