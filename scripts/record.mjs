import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const url = process.env.GARAGE_URL ?? 'http://127.0.0.1:3000';
const output = resolve(process.argv[2] ?? 'recordings');
const size = { width: 1920, height: 1080 };
await mkdir(output, { recursive: true });
const browser = await chromium.launch();

function setupCursor() {
  let pointer;
  function draw(event) {
    if (!pointer) {
      pointer = document.createElement('div');
      Object.assign(pointer.style, {
        position: 'fixed', height: '23px', width: '23px', borderRadius: '50%', border: '3px solid #fff',
        background: '#ff854b', pointerEvents: 'none', zIndex: 2147483647, boxShadow: '0 1px 10px #000',
        transform: 'translate(-50%, -50%)'
      });
    }
    // A dialog is in the browser's top layer, so attach the indicator inside it while open.
    const layer = document.querySelector('dialog[open]') ?? document.body;
    if (pointer.parentNode !== layer) layer.append(pointer);
    pointer.style.left = event.clientX + 'px';
    pointer.style.top = event.clientY + 'px';
  }
  addEventListener('mousemove', draw, true);
  addEventListener('mousedown', () => { if (pointer) pointer.style.background = '#fff'; }, true);
  addEventListener('mouseup', () => { if (pointer) pointer.style.background = '#ff854b'; }, true);
}

async function move(page, target) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  assert.ok(box);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y, { steps: 30 });
  await page.waitForTimeout(360);
  return { x, y };
}

async function click(page, target) {
  const { x, y } = await move(page, target);
  await page.mouse.click(x, y, { delay: 145 });
  await page.waitForTimeout(420);
}

async function record(name, flow) {
  const context = await browser.newContext({ viewport: size, recordVideo: { dir: output, size } });
  await context.addInitScript(setupCursor);
  const page = await context.newPage();
  const video = page.video();
  try {
    await page.goto(url);
    await page.getByRole('heading', { name: 'My garage.' }).waitFor();
    await page.getByRole('link', { name: /2012 Toyota Corolla/ }).waitFor();
    await page.waitForTimeout(1450);
    await flow(page);
  } finally {
    await context.close();
  }
  await video.saveAs(resolve(output, name + '.webm'));
  await video.delete();
}

async function fill(page, label, value, type = false) {
  const target = page.getByLabel(label, { exact: label !== 'Notes' });
  await click(page, target);
  if (type) await target.pressSequentially(value, { delay: 68 });
  else await target.fill(value);
  await page.waitForTimeout(320);
}

try {
  await record('virtual-garage-dashboard', async page => {
    const cards = page.locator('.card');
    assert.equal(await cards.count(), 3);
    for (let index = 0; index < 3; index++) {
      await move(page, cards.nth(index));
      await page.waitForTimeout(900);
    }
    await page.evaluate(() => window.scrollBy({ top: 210, behavior: 'smooth' }));
    await page.waitForTimeout(1200);
    await click(page, page.getByRole('link', { name: /2009 Dodge Challenger SRT/ }));
    await page.getByRole('heading', { name: 'Challenger SRT', exact: true }).waitFor();
    await page.waitForTimeout(1700);
    await click(page, page.getByRole('button', { name: 'Edit vehicle' }));
    assert.equal(await page.getByLabel('Model').inputValue(), 'Challenger SRT');
    await page.waitForTimeout(2000);
    await click(page, page.getByRole('button', { name: 'Cancel' }));
    await click(page, page.getByRole('link', { name: 'All vehicles' }));
    await click(page, page.getByRole('button', { name: 'Add vehicle' }));
    await page.waitForTimeout(2000);
    await click(page, page.getByRole('button', { name: 'Cancel' }));
    await page.waitForTimeout(2500);
  });

  await record('virtual-garage-maintenance', async page => {
    await click(page, page.getByRole('link', { name: /2003 Chevrolet Corvette Z06/ }));
    await page.getByRole('heading', { name: 'Corvette Z06', exact: true }).waitFor();
    await page.waitForTimeout(1800);
    await page.locator('#profile-content').evaluate(section => section.scrollIntoView({ behavior: 'smooth', block: 'end' }));
    await page.waitForTimeout(1100);
    await click(page, page.getByRole('button', { name: 'Add maintenance' }));
    await fill(page, 'Service description', 'Demo oil and filter service', true);
    await fill(page, 'Date', '2025-01-15');
    await fill(page, 'Mileage (mi)', '12345', true);
    await fill(page, 'Cost (USD)', '74.50', true);
    await fill(page, 'Notes', 'Demonstration only. Sample values.', true);
    await page.waitForTimeout(2100);
    await click(page, page.getByRole('button', { name: 'Save record' }));
    const item = page.getByRole('article').filter({ hasText: 'Demo oil and filter service' });
    await item.waitFor();
    await item.scrollIntoViewIfNeeded();
    assert.match(await item.innerText(), /12,345 mi/);
    assert.match(await item.innerText(), /\$74\.50/);
    await page.waitForTimeout(3200);
    await page.reload();
    await item.waitFor();
    await page.waitForTimeout(1500);
  });

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const page = await mobile.newPage();
    await page.goto(url);
    await page.getByRole('link', { name: /2012 Toyota Corolla/ }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
    await page.getByRole('button', { name: 'Add vehicle' }).click();
    await page.getByLabel('Year').fill('2010');
    await page.getByLabel('Make').fill('Mazda');
    await page.getByLabel('Model').fill('MX-5 Demo');
    await page.getByRole('button', { name: 'Save vehicle' }).click();
    await page.getByRole('heading', { name: 'MX-5 Demo', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Edit vehicle' }).click();
    await page.getByLabel('Model').fill('MX-5 Demo Edition');
    await page.getByRole('button', { name: 'Save vehicle' }).click();
    await page.getByRole('heading', { name: 'MX-5 Demo Edition' }).waitFor();
    await page.getByRole('link', { name: 'All vehicles' }).click();
    await page.getByRole('link', { name: /2003 Chevrolet Corvette Z06/ }).click();
    // A fresh browser context must see the record stored by the development server.
    await page.getByRole('heading', { name: 'Demo oil and filter service' }).waitFor();
  } finally {
    await mobile.close();
  }
} finally {
  await browser.close();
}
