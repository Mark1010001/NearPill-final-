-- Match the status constraints and application schema for new rows.
ALTER TABLE orders ALTER COLUMN status SET DEFAULT 'reserved';
ALTER TABLE order_drugstores ALTER COLUMN status SET DEFAULT 'reserved';
