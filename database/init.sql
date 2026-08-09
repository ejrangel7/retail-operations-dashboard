CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  sku VARCHAR(32) UNIQUE NOT NULL,
  name VARCHAR(120) NOT NULL,
  category VARCHAR(80) NOT NULL,
  price NUMERIC(10, 2) NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  reorder_level INTEGER NOT NULL DEFAULT 10
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  order_number VARCHAR(7) UNIQUE NOT NULL
    CONSTRAINT orders_order_number_format_check CHECK (order_number ~ '^BT-[0-9]{4}$'),
  customer_name VARCHAR(120) NOT NULL,
  status VARCHAR(24) NOT NULL,
  total NUMERIC(10, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE orders DROP COLUMN IF EXISTS sku;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_order_number_format_check') THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_order_number_format_check
      CHECK (order_number ~ '^BT-[0-9]{4}$') NOT VALID;
  END IF;
END $$;

INSERT INTO products (sku, name, category, price, stock, reorder_level) VALUES
  ('TEE-BLK-M', 'Classic Black Tee', 'Apparel', 24.00, 42, 12),
  ('TEE-LAV-L', 'Lavender Graphic Tee', 'Apparel', 29.00, 8, 10),
  ('TOTE-NAT', 'Natural Canvas Tote', 'Accessories', 18.00, 17, 8),
  ('MUG-CAT', 'Catitude Mug', 'Home', 16.00, 5, 8),
  ('HAT-BLK', 'Embroidered Black Cap', 'Accessories', 22.00, 26, 10)
ON CONFLICT (sku) DO NOTHING;

INSERT INTO orders (order_number, customer_name, status, total, created_at) VALUES
  ('BT-1048', 'Sample Customer A', 'processing', 53.00, NOW() - INTERVAL '2 hours'),
  ('BT-1047', 'Sample Customer B', 'shipped', 42.00, NOW() - INTERVAL '8 hours'),
  ('BT-1046', 'Sample Customer C', 'delivered', 69.00, NOW() - INTERVAL '1 day'),
  ('BT-1045', 'Sample Customer D', 'processing', 24.00, NOW() - INTERVAL '2 days'),
  ('BT-1044', 'Sample Customer E', 'delivered', 76.00, NOW() - INTERVAL '3 days')
ON CONFLICT (order_number) DO NOTHING;
