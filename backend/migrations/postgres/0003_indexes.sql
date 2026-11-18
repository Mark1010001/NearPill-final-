CREATE INDEX IF NOT EXISTS pharmacy_memberships_drugstore_idx
  ON pharmacy_memberships (drugstore_id);
CREATE INDEX IF NOT EXISTS inventory_medicine_idx
  ON inventory (medicine_id);
CREATE INDEX IF NOT EXISTS inventory_store_availability_idx
  ON inventory (drugstore_id, availability, stock_count);
CREATE INDEX IF NOT EXISTS orders_user_status_created_idx
  ON orders (user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_expires_idx
  ON orders (status, expires_at)
  WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS order_drugstores_order_idx
  ON order_drugstores (order_id);
CREATE INDEX IF NOT EXISTS order_drugstores_drugstore_idx
  ON order_drugstores (drugstore_id);
CREATE INDEX IF NOT EXISTS order_items_order_drugstore_idx
  ON order_items (order_drugstore_id);
CREATE INDEX IF NOT EXISTS payments_order_created_idx
  ON payments (order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS subscriptions_store_status_idx
  ON subscriptions (drugstore_id, status);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx
  ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS medicines_brand_lower_idx
  ON medicines (LOWER(brand_name));
CREATE INDEX IF NOT EXISTS medicines_generic_lower_idx
  ON medicines (LOWER(generic_name));
