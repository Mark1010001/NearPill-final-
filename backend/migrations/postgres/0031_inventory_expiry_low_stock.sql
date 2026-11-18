-- Pharmacies can record when a stock lot expires and the stock level at which
-- they want a low-stock warning. Both are optional and informational: they do not
-- change prices, reserved stock, ordering rules, or prescription blocking.
ALTER TABLE inventory
  ADD COLUMN expiry_date date,
  ADD COLUMN low_stock_threshold integer
    CHECK (low_stock_threshold IS NULL OR (low_stock_threshold >= 0 AND low_stock_threshold <= 1000000));
