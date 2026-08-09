import type { OperationsInsights } from "./types";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

const statusLabels = {
  processing: "Processing",
  shipped: "Shipped",
  delivered: "Delivered",
};

function percentage(value: number, maximum: number) {
  return `${Math.round((value / Math.max(maximum, 1)) * 100)}%`;
}

export function OperationsInsightsPanel({ data }: { data: OperationsInsights | null | undefined }) {
  const maximumOrders = Math.max(0, ...(data?.orderStatus.map((item) => item.orderCount) ?? []));
  const maximumStock = Math.max(0, ...(data?.inventoryByCategory.map((item) => item.stockUnits) ?? []));

  return (
    <section id="reports" className="insights-section" aria-labelledby="insights-title">
      <div className="section-heading">
        <div><p className="eyebrow">Decision support</p><h2 id="insights-title">Operations insights</h2></div>
        <span className="updated-label">Live aggregates</span>
      </div>
      {data === undefined && <p className="report-loading" aria-live="polite">Loading reporting data...</p>}
      {data === null && <p className="report-loading">Reporting data is unavailable.</p>}
      {data && (
        <div className="report-grid">
          <article className="report-card" aria-labelledby="fulfillment-report-title">
            <div className="report-card-heading">
              <div><h3 id="fulfillment-report-title">Fulfillment mix</h3><p>Order volume and value by status.</p></div>
            </div>
            <div className="chart-visual" aria-hidden="true">
              {data.orderStatus.map((item) => (
                <div className="chart-row" key={item.status}>
                  <div className="chart-label"><span>{statusLabels[item.status]}</span><strong>{item.orderCount}</strong></div>
                  <div className="chart-track"><span className={`chart-fill ${item.status}`} style={{ width: percentage(item.orderCount, maximumOrders) }} /></div>
                </div>
              ))}
            </div>
            <div className="report-table-wrap">
              <table>
                <caption>Fulfillment report data</caption>
                <thead><tr><th scope="col">Status</th><th scope="col">Orders</th><th scope="col">Order value</th></tr></thead>
                <tbody>
                  {data.orderStatus.map((item) => (
                    <tr key={item.status}><th scope="row">{statusLabels[item.status]}</th><td>{item.orderCount}</td><td>{money.format(item.revenue)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <article className="report-card" aria-labelledby="inventory-report-title">
            <div className="report-card-heading">
              <div><h3 id="inventory-report-title">Inventory coverage</h3><p>Available units and reorder exposure by category.</p></div>
            </div>
            <div className="chart-visual" aria-hidden="true">
              {data.inventoryByCategory.map((item) => (
                <div className="chart-row" key={item.category}>
                  <div className="chart-label"><span>{item.category}</span><strong>{item.stockUnits}</strong></div>
                  <div className="chart-track"><span className="chart-fill inventory" style={{ width: percentage(item.stockUnits, maximumStock) }} /></div>
                  <small>{item.lowStockItems} {item.lowStockItems === 1 ? "reorder item" : "reorder items"}</small>
                </div>
              ))}
            </div>
            <div className="report-table-wrap">
              <table>
                <caption>Inventory report data</caption>
                <thead><tr><th scope="col">Category</th><th scope="col">Products</th><th scope="col">Units</th><th scope="col">Reorder</th></tr></thead>
                <tbody>
                  {data.inventoryByCategory.map((item) => (
                    <tr key={item.category}><th scope="row">{item.category}</th><td>{item.productCount}</td><td>{item.stockUnits}</td><td>{item.lowStockItems}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        </div>
      )}
    </section>
  );
}
