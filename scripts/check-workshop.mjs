import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
try {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:3000/');
  await page.getByRole('link', { name: /2003 Chevrolet Corvette Z06/ }).click();
  await page.getByRole('button', { name: 'Add Log Entry' }).click();
  await page.getByLabel('Title', { exact: true }).fill('Demo brake diagnosis');
  await page.getByLabel('Log type').selectOption('inspection');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const entry = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Demo brake diagnosis' }) });
  await entry.waitFor();
  await entry.getByText('DIY / Work Instructions', { exact: true }).click();
  await entry.getByRole('button', { name: 'Add step' }).click();
  await page.getByLabel('Short title').fill('Inspect the pads');
  await page.getByLabel('Instructions', { exact: true }).fill('Demo instructions only.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await entry.getByText('DIY / Work Instructions · Draft', { exact: true }).click();
  const step = entry.getByRole('article').filter({ has: page.getByRole('heading', { name: /Inspect the pads/ }) });
  const photo = { name: 'test.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==', 'base64') };
  await step.getByLabel('Upload photos', { exact: true }).setInputFiles(photo);
  await page.getByText('Upload complete.', { exact: true }).waitFor();
  await page.reload();
  await entry.getByText('DIY / Work Instructions · Draft', { exact: true }).click();
  const preview = step.getByRole('img', { name: 'test.png' });
  await preview.waitFor();
  const response = await page.request.get(await preview.getAttribute('src'));
  assert.equal(response.status(), 200);
  assert.deepEqual(await response.body(), photo.buffer);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
