import { useEffect, useState } from "react";
import { createCsvReport, reportFilename } from "./report";
import type { DashboardSummary, Order, Product } from "./types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const date = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`);

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return response.json() as Promise<T>;
}

function App() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [showAllOrders, setShowAllOrders] = useState(false);
  const [error, setError] = useState("");

  const visibleOrders = showAllOrders ? orders : orders.slice(0, 3);

  function exportReport() {
    if (!summary) return;

    const now = new Date();
    const csv = createCsvReport(summary, orders, products, now);
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = reportFilename(now);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    Promise.all([
      fetchJson<DashboardSummary>("/dashboard"),
      fetchJson<Product[]>("/products"),
      fetchJson<Order[]>("/orders"),
    ])
      .then(([summaryData, productsData, ordersData]) => {
        setSummary(summaryData);
        setProducts(productsData);
        setOrders(ordersData);
      })
      .catch(() => setError("The dashboard data could not be loaded."));
  }, []);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#top" aria-label="Retail Operations home">
          <span className="brand-mark">RO</span>
          <span>Retail Ops</span>
        </a>
        <nav aria-label="Primary navigation">
          <a className="nav-link active" href="#overview">Overview</a>
          <a className="nav-link" href="#orders">Orders</a>
          <a className="nav-link" href="#inventory">Inventory</a>
        </nav>
        <div className="sidebar-note">
          <span className="status-dot" /> Demo environment
        </div>
      </aside>

      <main id="top">
        <header className="topbar">
          <div>
            <p className="eyebrow">Operations workspace</p>
            <h1>Good morning, Edward.</h1>
            <p>Here is what is happening across the store today.</p>
          </div>
          <button type="button" className="secondary-button" onClick={exportReport} disabled={!summary}>
            Export report
          </button>
        </header>

        {error && <div className="error-banner" role="alert">{error}</div>}

        <section id="overview" aria-labelledby="overview-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">At a glance</p>
              <h2 id="overview-title">Business overview</h2>
            </div>
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
              <div>
                <p className="eyebrow">Fulfillment</p>
                <h2 id="orders-title">Recent orders</h2>
              </div>
              {orders.length > 3 && (
                <button
                  className="text-button"
                  type="button"
                  aria-expanded={showAllOrders}
                  aria-controls="orders-table"
                  onClick={() => setShowAllOrders((current) => !current)}
                >
                  {showAllOrders ? "Show recent" : "View all"}
                </button>
              )}
            </div>
            <div className="table-wrap" id="orders-table">
              <table>
                <thead>
                  <tr><th>Order</th><th>Customer</th><th>Status</th><th>Total</th><th>Date</th></tr>
                </thead>
                <tbody>
                  {visibleOrders.map((order) => (
                    <tr key={order.id}>
                      <td className="strong">{order.orderNumber}</td>
                      <td>{order.customerName}</td>
                      <td><span className={`status ${order.status}`}>{order.status}</span></td>
                      <td>{money.format(order.total)}</td>
                      <td>{date.format(new Date(order.createdAt))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section id="inventory" className="panel inventory-panel" aria-labelledby="inventory-title">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Inventory</p>
                <h2 id="inventory-title">Stock watch</h2>
              </div>
            </div>
            <div className="product-list">
              {products.map((product) => {
                const low = product.stock <= product.reorderLevel;
                return (
                  <article className="product-row" key={product.id}>
                    <div>
                      <h3>{product.name}</h3>
                      <p>{product.sku} · {product.category}</p>
                    </div>
                    <div className="stock-count">
                      <strong className={low ? "low" : ""}>{product.stock}</strong>
                      <span>{low ? "Reorder" : "In stock"}</span>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

function MetricCard({ label, value, trend, alert = false }: { label: string; value: string | number; trend: string; alert?: boolean }) {
  return (
    <article className={`metric-card${alert ? " alert" : ""}`}>
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{trend}</span>
    </article>
  );
}

export default App;
