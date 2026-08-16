ALTER TABLE products
  ADD CONSTRAINT products_price_nonnegative_check CHECK (price >= 0) NOT VALID,
  ADD CONSTRAINT products_stock_nonnegative_check CHECK (stock >= 0) NOT VALID,
  ADD CONSTRAINT products_reorder_level_nonnegative_check CHECK (reorder_level >= 0) NOT VALID;

ALTER TABLE orders
  ADD CONSTRAINT orders_status_check
    CHECK (status IN ('processing', 'shipped', 'delivered')) NOT VALID,
  ADD CONSTRAINT orders_total_nonnegative_check CHECK (total >= 0) NOT VALID;

ALTER TABLE products VALIDATE CONSTRAINT products_price_nonnegative_check;
ALTER TABLE products VALIDATE CONSTRAINT products_stock_nonnegative_check;
ALTER TABLE products VALIDATE CONSTRAINT products_reorder_level_nonnegative_check;
ALTER TABLE orders VALIDATE CONSTRAINT orders_status_check;
ALTER TABLE orders VALIDATE CONSTRAINT orders_total_nonnegative_check;
