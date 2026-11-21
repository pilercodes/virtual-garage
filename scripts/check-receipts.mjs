import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const lines = ['NORTHSIDE AUTO', 'Invoice Date: 11/04/2026', 'Oil Filter 12.95', 'Parts Total 12.95', 'Labor Total 35.00', 'Grand Total 50.00'];

function textPdf() {
  const stream = 'BT /F1 16 Tf 35 350 Td 24 TL ' + lines.map(line => '(' + line + ') Tj T*').join(' ') + ' ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 460 400] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream'
  ];
  let text = '%PDF-1.4\n';
  const offsets = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(text.length);
    text += (index + 1) + ' 0 obj\n' + object + '\nendobj\n';
  }
  const xref = text.length;
  text += 'xref\n0 6\n0000000000 65535 f \n';
  for (const offset of offsets) text += String(offset).padStart(10, '0') + ' 00000 n \n';
  return Buffer.from(text + 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:3000/');
  await page.getByRole('link', { name: /2003 Chevrolet Corvette Z06/ }).click();
  await page.getByRole('button', { name: 'Add Log Entry' }).click();
  await page.getByLabel('Title', { exact: true }).fill('Keep my original title');
  await page.getByLabel('Other cost (USD)', { exact: true }).fill('8.20');
  await page.getByText('Scan or attach receipts', { exact: true }).click();
  await page.getByLabel('Choose receipt files', { exact: true }).setInputFiles({
    name: 'demo-invoice.pdf', mimeType: 'application/pdf', buffer: textPdf()
  });
  const pdf = page.locator('.receipt-suggestion').filter({ has: page.getByRole('heading', { name: 'demo-invoice.pdf' }) });
  await pdf.getByText('Review the detected details.').waitFor({ timeout: 65000 });
  assert.equal(await pdf.getByLabel('Retailer').inputValue(), 'NORTHSIDE AUTO');
  assert.equal(await pdf.getByLabel('Purchase date').inputValue(), '2026-11-04');
  assert.equal(await pdf.getByLabel('Receipt total (USD)').inputValue(), '50.00');
  await pdf.getByRole('button', { name: 'Apply suggestions to empty log fields' }).click();
  assert.equal(await page.getByLabel('Title', { exact: true }).inputValue(), 'Keep my original title');
  assert.equal(await page.getByLabel('Other cost (USD)', { exact: true }).inputValue(), '8.20');
  assert.equal(await page.getByLabel('Date', { exact: true }).inputValue(), '2026-11-04');

  const data = await page.evaluate(receipt => {
    const canvas = document.createElement('canvas');
    canvas.width = 850;
    canvas.height = 500;
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#000';
    context.font = '38px monospace';
    receipt.forEach((line, i) => context.fillText(line, 36, 64 + i * 61));
    return canvas.toDataURL('image/png').split(',')[1];
  }, lines);
  await page.getByLabel('Choose receipt files', { exact: true }).setInputFiles({
    name: 'demo-photo.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64')
  });
  const image = page.locator('.receipt-suggestion').filter({ has: page.getByRole('heading', { name: 'demo-photo.png' }) });
  await image.getByText('Review the detected details.').waitFor({ timeout: 65000 });
  assert.equal(await image.getByLabel('Receipt total (USD)').inputValue(), '50.00');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('heading', { name: 'Keep my original title' }).waitFor();
  await page.reload();
  const log = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Keep my original title' }) });
  await log.getByText('Photos and actions', { exact: true }).click();
  await log.getByRole('link', { name: 'demo-invoice.pdf' }).waitFor();
  await log.getByRole('link', { name: 'demo-photo.png' }).waitFor();
  assert.match(await log.innerText(), /\$8\.20/);
  assert.match(await log.innerText(), /NORTHSIDE AUTO/);
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
