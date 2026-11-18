import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sql = await readFile(new URL('../migrations/postgres/0042_renumber_catalog_ids.sql', import.meta.url), 'utf8');

test('renumbering orders by pharmacy account number, then name, and keeps a mapping', () => {
  assert.match(sql, /min\(d\.account_no\)/);
  assert.match(sql, /lower\(m\.brand_name\), m\.id/);
  assert.match(sql, /CREATE TABLE medicine_id_renumbering/);
});

test('renumbering updates every referencing table together and checks the result', () => {
  assert.match(sql, /confrelid = 'medicines'::regclass/);
  assert.match(sql, /ON UPDATE CASCADE/);
  assert.match(sql, /SET id = -r\.new_id/);
  assert.match(sql, /SET id = -id WHERE id < 0/);
  assert.match(sql, /RESTART WITH/);
  assert.match(sql, /RAISE EXCEPTION 'Catalog renumbering check failed/);
  assert.match(sql, /pending stock submissions/);
});

test('original foreign keys are restored without ON UPDATE CASCADE', () => {
  const restore = sql.slice(sql.lastIndexOf('FOR fk IN'));
  assert.doesNotMatch(restore.split('END LOOP')[0], /ON UPDATE CASCADE/);
});
