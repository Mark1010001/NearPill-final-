import assert from 'node:assert/strict';
import test from 'node:test';
import { STOCK_HEADERS, parseCsv, validateStockCsv, validateStockRows } from '../src/domain/inventory/stock-template.js';

const H = STOCK_HEADERS.join(',');
const good = '"ALV Pharmacy",12,Biogesic,Paracetamol,500 mg,Tablet,Non-prescription,Tablet,3.50,120';

test('template header is exactly the agreed columns', () => {
  assert.equal(H, 'pharmacy,catalog_id,brand,generic_name,strength,form,category,selling_unit,price,stock_quantity');
});

test('parses quotes, commas, blank lines, CRLF and BOM', () => {
  assert.deepEqual(parseCsv('﻿a,"b,c",""\r\n\r\nx,"y ""z""",\n'), [['a', 'b,c', ''], ['x', 'y "z"', '']]);
  assert.throws(() => parseCsv('a,"b'));
});

test('a valid file passes and is normalised', () => {
  const result = validateStockCsv(`${H}\r\n${good}\r\n"alv pharmacy",,Neozep,,,Tablet,prescription,Box of 10,10,5\r\n`, { pharmacyName: 'ALV Pharmacy' });
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].name, 'Biogesic 500 mg');
  assert.equal(result.rows[0].catalogId, 12);
  assert.equal(result.rows[1].catalogId, null);
  assert.equal(result.rows[1].category, 'Prescription');
});

test('a header that is not the template is rejected', () => {
  for (const bad of [H.replace('brand', 'name'), `${H},extra`, 'catalog_id,pharmacy,brand,generic_name,strength,form,category,selling_unit,price,stock_quantity', H.toUpperCase().replace('PHARMACY', 'pharmacy2')]) {
    const result = validateStockCsv(`${bad}\n${good}`, { pharmacyName: 'ALV Pharmacy' });
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].line, 1);
  }
  assert.equal(validateStockCsv(`${H.toUpperCase()}\n${good}`, { pharmacyName: 'ALV Pharmacy' }).errors.length, 0);
});

test('each bad value is reported with its line', () => {
  const rows = [
    ['Other', '', 'Biogesic', '', '', 'Tablet', 'Prescription', 'Tablet', '3', '1'],
    ['ALV Pharmacy', 'abc', 'B', '', '', 'T', 'Cosmetic', '-x', '0', '-1'],
    ['ALV Pharmacy', '', '=cmd', '', '', 'Tablet', 'Prescription', 'Tablet', '1.234', '0'],
    ['ALV Pharmacy', '5', 'Same', '', '', 'Tablet', 'Prescription', 'Tablet', '1', '0'],
    ['ALV Pharmacy', '5', 'Same2', '', '', 'Tablet', 'Prescription', 'Tablet', '1', '0'],
  ].map((cells) => Object.fromEntries(STOCK_HEADERS.map((name, i) => [name, cells[i]])));
  const { errors } = validateStockRows(rows, { pharmacyName: 'ALV Pharmacy' });
  const lines = new Set(errors.map((e) => e.line));
  assert.deepEqual([...lines].sort(), [2, 3, 4, 6]);
  assert.ok(errors.some((e) => /pharmacy must be exactly/.test(e.message)));
  assert.ok(errors.some((e) => /cannot start with/.test(e.message)));
  assert.ok(errors.some((e) => /already appears on line 5/.test(e.message)));
});

test('column count, empty and oversized files are rejected', () => {
  assert.equal(validateStockCsv(`${H}\nonly,two`, { pharmacyName: 'x' }).errors[0].line, 2);
  assert.equal(validateStockCsv('', { pharmacyName: 'x' }).errors.length, 1);
  assert.equal(validateStockCsv(H, { pharmacyName: 'x' }).errors.length, 1);
  assert.equal(validateStockRows(new Array(501).fill({}), { pharmacyName: 'x' }).errors.length, 1);
});
