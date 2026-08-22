import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseHeader, parseCsv, parseCsvRecords } from './csv.js';

test('parses a plain grid', () => {
  assert.deepEqual(parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
});

test('a quoted field may contain commas', () => {
  // Splitting on commas would turn this into three fields and shift every
  // column after it — a wrong revenue number, not a crash.
  assert.deepEqual(parseCsv('city,amount\n"Montreal, QC",120.50'), [
    ['city', 'amount'],
    ['Montreal, QC', '120.50'],
  ]);
});

test('a quoted field may contain escaped quotes and newlines', () => {
  assert.deepEqual(parseCsv('a\n"He said ""hi""\nsecond line"'), [['a'], ['He said "hi"\nsecond line']]);
});

test('handles CRLF line endings', () => {
  assert.deepEqual(parseCsv('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
});

test('strips a UTF-8 BOM so the first header is not corrupted', () => {
  const rows = parseCsv('﻿conversion_id,subid\n1,x');
  assert.equal(rows[0][0], 'conversion_id');
});

test('ignores blank trailing lines', () => {
  assert.deepEqual(parseCsv('a,b\n1,2\n\n'), [['a', 'b'], ['1', '2']]);
});

test('preserves whitespace inside quotes but trims bare fields', () => {
  assert.deepEqual(parseCsv('a,b\n  x  ," y "'), [['a', 'b'], ['x', ' y ']]);
});

test('an empty quoted field stays empty rather than becoming a quote', () => {
  assert.deepEqual(parseCsv('a,b\n"",2'), [['a', 'b'], ['', '2']]);
});

test('normaliseHeader folds case and separators', () => {
  assert.equal(normaliseHeader('  Conversion ID '), 'conversion_id');
  assert.equal(normaliseHeader('Sale-Amount'), 'sale_amount');
});

test('parseCsvRecords keys rows by normalised header', () => {
  const records = parseCsvRecords('Conversion ID,Sale Amount\nABC,120.50');
  assert.deepEqual(records, [{ conversion_id: 'ABC', sale_amount: '120.50' }]);
});

test('a short row yields empty strings, not undefined', () => {
  const records = parseCsvRecords('a,b,c\n1,2');
  assert.deepEqual(records[0], { a: '1', b: '2', c: '' });
});
