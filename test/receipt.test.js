import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractReceiptFields } from '../src/public/receipt-fields.js';
import { handleReceiptAsset } from '../src/receipt-assets.js';

test('detects tagged dates, line items, parts, labor, and grand total without counting tenders', () => {
  const fields = extractReceiptFields(`NORTHSIDE AUTO
Invoice #223
Invoice Date: 11/04/2026
Return by 12/04/2026
Oil Filter 12.95
Parts Total 12.95
Labor Total 35.00
Subtotal 47.95
Tax 2.05
Grand Total $50.00
Cash Tendered 60.00
Change 10.00`);
  assert.equal(fields.retailer, 'NORTHSIDE AUTO');
  assert.equal(fields.date, '2026-11-04');
  assert.equal(fields.total, 5000);
  assert.equal(fields.parts, 1295);
  assert.equal(fields.labor, 3500);
  assert.deepEqual(fields.items, ['Oil Filter 12.95']);
});

test('avoids impossible dates and amounts on tax, non-total, or refund-only lines', () => {
  assert.equal(extractReceiptFields('Invoice Date: 02/30/2026\nSubtotal 10.00\nCash 20.00').date, '');
  assert.equal(extractReceiptFields('Tax Total 5.00\nRefund Total 20.00').total, null);
  assert.equal(extractReceiptFields('Total -$20.00').total, null);
});

test('the dependency route rejects arbitrary names and fails closed on a hash mismatch', async () => {
  const route = 'https://garage.test/receipt-assets/v1/';
  let upstream;
  const env = { RECEIPT_ASSET_FETCH: async url => { upstream = url; return new Response('unexpected'); } };
  const unknown = new Request(route + 'unknown.js');
  assert.equal((await handleReceiptAsset(unknown, env, new URL(unknown.url).pathname, {})).status, 404);
  assert.equal(upstream, undefined);
  const request = new Request(route + 'tesseract.min.js');
  assert.equal((await handleReceiptAsset(request, env, new URL(request.url).pathname, {})).status, 502);
  assert.equal(upstream, 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js');
});
