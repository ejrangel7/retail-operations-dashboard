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

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(160) UNIQUE NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  password_salt CHAR(32) NOT NULL,
  password_hash CHAR(128) NOT NULL,
  role VARCHAR(24) NOT NULL
    CONSTRAINT users_role_check CHECK (role IN ('operator', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash CHAR(64) PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);

ALTER TABLE orders DROP COLUMN IF EXISTS sku;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_order_number_format_check') THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_order_number_format_check
      CHECK (order_number ~ '^BT-[0-9]{4}$') NOT VALID;
  END IF;
END $$;

ALTER TABLE orders VALIDATE CONSTRAINT orders_order_number_format_check;

DELETE FROM users WHERE email = 'operator@retail.local';

INSERT INTO users (email, display_name, password_salt, password_hash, role) VALUES
  (
    'viewer@retail.local',
    'Reporting Viewer',
    '3612fa6edbc1630d30b5b00dd5d11801',
    'b67e8ca1fc3ba7a28c7363caa2c35ca67cf9e60a8325e5db9512ec535f6a52d759ee6fd0eae91ebf1eb4bea583fb9442cdb41c64cc81492fcb9709f7b3f23224',
    'viewer'
  )
ON CONFLICT (email) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  password_salt = EXCLUDED.password_salt,
  password_hash = EXCLUDED.password_hash,
  role = EXCLUDED.role;

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
