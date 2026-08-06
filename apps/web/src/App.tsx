import { useEffect, useState } from "react";
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

function App() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      fetch(`${API_URL}/dashboard`).then((response) => response.json()),
      fetch(`${API_URL}/products`).then((response) => response.json()),
      fetch(`${API_URL}/orders`).then((response) => response.json()),
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
          <button type="button" className="secondary-button">Export report</button>
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
              <button className="text-button" type="button">View all</button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Order</th><th>Customer</th><th>Status</th><th>Total</th><th>Date</th></tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
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

