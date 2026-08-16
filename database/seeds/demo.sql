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
