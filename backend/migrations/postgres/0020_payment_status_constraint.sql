-- The original inline constraint rejects statuses defined by the replacement in 0007.
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_payment_status_check;
