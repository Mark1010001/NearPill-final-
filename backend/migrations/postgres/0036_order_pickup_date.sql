-- Customers choose a pickup date (and optionally a time window) when they place an order.
-- Dates are calendar dates in Philippine time. Old orders keep NULL ("No pickup date"). No location is stored.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS pickup_date date,
  ADD COLUMN IF NOT EXISTS pickup_window text,
  ADD COLUMN IF NOT EXISTS pickup_rescheduled boolean NOT NULL DEFAULT false;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_pickup_window_valid;
ALTER TABLE orders ADD CONSTRAINT orders_pickup_window_valid
  CHECK (pickup_window IS NULL OR pickup_window IN ('morning', 'afternoon', 'evening'));

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_pickup_window_needs_date;
ALTER TABLE orders ADD CONSTRAINT orders_pickup_window_needs_date
  CHECK (pickup_window IS NULL OR pickup_date IS NOT NULL);

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_pickup_date_not_before_order;
ALTER TABLE orders ADD CONSTRAINT orders_pickup_date_not_before_order
  CHECK (pickup_date IS NULL OR pickup_date >= ((created_at AT TIME ZONE 'Asia/Manila')::date));
