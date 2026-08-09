import { useState } from "react";
import type { CreateOrderInput, OrderStatus } from "./types";

type Props = {
  saving: boolean;
  onCancel: () => void;
  onSubmit: (input: CreateOrderInput) => Promise<void>;
};

export function NewOrderForm({ saving, onCancel, onSubmit }: Props) {
  const [orderNumber, setOrderNumber] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [sku, setSku] = useState("");
  const [status, setStatus] = useState<OrderStatus>("processing");
  const [total, setTotal] = useState("");

  return (
    <form
      id="new-order-form"
      className="order-form"
      aria-label="Create order"
      onSubmit={async (event) => {
        event.preventDefault();
        await onSubmit({ orderNumber: orderNumber.trim(), customerName: customerName.trim(), sku, status, total: Number(total) });
      }}
    >
      <div className="order-form-grid">
        <label>Order number
          <input value={orderNumber} onChange={(event) => setOrderNumber(event.target.value)} placeholder="BT-1049" pattern="[A-Za-z0-9-]{3,24}" maxLength={24} required />
        </label>
        <label>Customer
          <input value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Customer name" minLength={2} maxLength={120} required />
        </label>
        <label>SKU
          <input value={sku} onChange={(event) => setSku(event.target.value.toUpperCase())} placeholder="TEE-BLK-M" pattern="[A-Z0-9]+(-[A-Z0-9]+)+" minLength={3} maxLength={32} title="Use uppercase letters, numbers, and hyphen-separated segments, for example TEE-BLK-M" required />
        </label>
        <label>Order status
          <select value={status} onChange={(event) => setStatus(event.target.value as OrderStatus)}>
            <option value="processing">Processing</option>
            <option value="shipped">Shipped</option>
            <option value="delivered">Delivered</option>
          </select>
        </label>
        <label>Total
          <input type="number" value={total} onChange={(event) => setTotal(event.target.value)} min="0.01" max="99999999.99" step="0.01" placeholder="0.00" required />
        </label>
      </div>
      <div className="order-form-actions">
        <button className="secondary-button" type="button" onClick={onCancel} disabled={saving}>Cancel</button>
        <button className="primary-button" type="submit" disabled={saving}>{saving ? "Creating…" : "Create order"}</button>
      </div>
    </form>
  );
}
