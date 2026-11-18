// The stock template every partner pharmacy follows, for CSV uploads and for single adds alike.
export const STOCK_HEADERS = Object.freeze(['pharmacy', 'catalog_id', 'brand', 'generic_name', 'strength', 'form', 'category', 'selling_unit', 'price', 'stock_quantity']);
export const MAX_STOCK_ROWS = 500;
export const STOCK_CATEGORIES = Object.freeze(['Non-prescription', 'Prescription', 'Non-medicine']);

const UNIT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ().,-]{0,47}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const FORMULA_START = /^[=+\-@]/;

/** Parses RFC 4180 style CSV (quotes, doubled quotes, CRLF/LF, BOM). Returns an array of string arrays. */
export function parseCsv(text) {
  const source = String(text ?? '').replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  let touched = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false;
      } else cell += char;
    } else if (char === '"' && cell === '') { quoted = true; touched = true; }
    else if (char === ',') { row.push(cell); cell = ''; touched = true; }
    else if (char === '\r' || char === '\n') {
      if (char === '\r' && source[i + 1] === '\n') i += 1;
      if (touched || cell !== '') { row.push(cell); rows.push(row); }
      row = []; cell = ''; touched = false;
    } else { cell += char; touched = true; }
  }
  if (quoted) throw new Error('The file has an unclosed quotation mark.');
  if (touched || cell !== '') { row.push(cell); rows.push(row); }
  return rows;
}

function textField(value, { label, min = 0, max, line, errors, allowFormula = false }) {
  const text = String(value ?? '').trim();
  if (CONTROL.test(text)) errors.push({ line, message: `${label} contains characters that are not allowed.` });
  else if (text.length < min || (min > 0 && !text)) errors.push({ line, message: `${label} is required.` });
  else if (text.length > max) errors.push({ line, message: `${label} must be ${max} characters or fewer.` });
  else if (text && !allowFormula && FORMULA_START.test(text)) errors.push({ line, message: `${label} cannot start with =, +, - or @.` });
  return text;
}

/**
 * Validates template rows (objects keyed by STOCK_HEADERS) for one pharmacy. `line` numbers match the file
 * (header is line 1). Returns { rows, errors }; rows are only meaningful when errors is empty.
 */
export function validateStockRows(rawRows, { pharmacyName, firstLine = 2 } = {}) {
  const errors = [];
  const rows = [];
  if (!Array.isArray(rawRows) || rawRows.length < 1) return { rows, errors: [{ line: 0, message: 'The file has no stock rows.' }] };
  if (rawRows.length > MAX_STOCK_ROWS) return { rows, errors: [{ line: 0, message: `Upload at most ${MAX_STOCK_ROWS} rows at a time.` }] };
  const seenCatalog = new Map();
  const seenNew = new Map();
  rawRows.forEach((raw, index) => {
    const line = firstLine + index;
    const before = errors.length;
    const pharmacy = String(raw.pharmacy ?? '').trim();
    if (!pharmacy || pharmacy.toLowerCase() !== String(pharmacyName ?? '').trim().toLowerCase()) {
      errors.push({ line, message: `pharmacy must be exactly "${pharmacyName}".` });
    }
    const catalogText = String(raw.catalog_id ?? '').trim();
    let catalogId = null;
    if (catalogText) {
      if (!/^\d{1,9}$/.test(catalogText) || Number(catalogText) < 1) errors.push({ line, message: 'catalog_id must be a whole number, or blank for a new medicine.' });
      else catalogId = Number(catalogText);
    }
    const brand = textField(raw.brand, { label: 'brand', min: 2, max: 100, line, errors });
    const genericName = textField(raw.generic_name, { label: 'generic_name', max: 100, line, errors });
    const strength = textField(raw.strength, { label: 'strength', max: 40, line, errors, allowFormula: true });
    const form = textField(raw.form, { label: 'form', min: 2, max: 50, line, errors });
    const categoryText = String(raw.category ?? '').trim();
    const category = STOCK_CATEGORIES.find((item) => item.toLowerCase() === categoryText.toLowerCase());
    if (!category) errors.push({ line, message: `category must be one of ${STOCK_CATEGORIES.join(', ')}.` });
    const sellingUnit = String(raw.selling_unit ?? '').trim();
    if (!UNIT_PATTERN.test(sellingUnit)) errors.push({ line, message: 'selling_unit must be one unit such as Tablet or Box of 10.' });
    const priceText = String(raw.price ?? '').trim();
    if (!/^\d{1,10}(\.\d{1,2})?$/.test(priceText) || Number(priceText) <= 0) errors.push({ line, message: 'price must be above zero with at most 2 decimals, for example 12.50.' });
    const stockText = String(raw.stock_quantity ?? '').trim();
    if (!/^\d{1,10}$/.test(stockText) || Number(stockText) > 2147483647) errors.push({ line, message: 'stock_quantity must be a whole number from 0.' });
    else if (!catalogId && Number(stockText) < 1) errors.push({ line, message: 'a new medicine needs stock_quantity of 1 or more.' });
    const fullName = `${brand} ${strength}`.trim();
    if (fullName.length > 100) errors.push({ line, message: 'brand and strength together must be 100 characters or fewer.' });
    if (catalogId) {
      if (seenCatalog.has(catalogId)) errors.push({ line, message: `catalog_id ${catalogId} already appears on line ${seenCatalog.get(catalogId)}.` });
      else seenCatalog.set(catalogId, line);
    } else {
      const key = `${fullName}|${form}`.toLowerCase();
      if (seenNew.has(key)) errors.push({ line, message: `${fullName} (${form}) already appears on line ${seenNew.get(key)}.` });
      else seenNew.set(key, line);
    }
    if (errors.length === before) {
      rows.push({
        line, catalogId, brand, genericName: genericName || null, strength: strength || null, name: fullName, form, category,
        sellingUnit, price: priceText, stock: Number(stockText),
      });
    }
  });
  return { rows, errors };
}

/** Turns CSV text into validated rows. Header must match the template exactly (names and order). */
export function validateStockCsv(csvText, { pharmacyName } = {}) {
  let table;
  try { table = parseCsv(csvText); } catch (error) { return { rows: [], errors: [{ line: 1, message: error.message }] }; }
  if (table.length === 0) return { rows: [], errors: [{ line: 1, message: 'The file is empty.' }] };
  const header = table[0].map((cell) => cell.trim().toLowerCase());
  if (header.length !== STOCK_HEADERS.length || header.some((cell, index) => cell !== STOCK_HEADERS[index])) {
    return { rows: [], errors: [{ line: 1, message: `The first line must be exactly: ${STOCK_HEADERS.join(',')}` }] };
  }
  const objects = [];
  for (let i = 1; i < table.length; i += 1) {
    if (table[i].length !== STOCK_HEADERS.length) {
      return { rows: [], errors: [{ line: i + 1, message: `Expected ${STOCK_HEADERS.length} columns but found ${table[i].length}.` }] };
    }
    objects.push(Object.fromEntries(STOCK_HEADERS.map((name, column) => [name, table[i][column]])));
  }
  return validateStockRows(objects, { pharmacyName, firstLine: 2 });
}
