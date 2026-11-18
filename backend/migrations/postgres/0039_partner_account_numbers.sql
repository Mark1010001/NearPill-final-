-- Partner pharmacy accounts get a short, unique Account No. (1, 2, 3 ...), separate from the internal database id.
-- Existing pharmacies are numbered alphabetically (active ones first); pharmacies added later get the next number.
ALTER TABLE drugstores ADD COLUMN IF NOT EXISTS account_no integer;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY is_active DESC, lower(name), id) AS n
  FROM drugstores
  WHERE account_no IS NULL
)
UPDATE drugstores d
SET account_no = COALESCE((SELECT MAX(account_no) FROM drugstores), 0) + ranked.n
FROM ranked
WHERE d.id = ranked.id;

CREATE UNIQUE INDEX IF NOT EXISTS drugstores_account_no_unique ON drugstores (account_no);
