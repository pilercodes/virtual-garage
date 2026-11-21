import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const url = process.env.GARAGE_URL ?? 'http://127.0.0.1:3001';
const browser = await chromium.launch();
try {
  const owner = await browser.newPage();
  const guest = await browser.newPage();
  async function register(page, email) {
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill('demo test password 123');
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.getByRole('button', { name: 'Add vehicle' }).waitFor();
  }
  await owner.goto(url);
  await register(owner, 'owner@example.test');
  await owner.getByRole('button', { name: 'Add vehicle' }).click();
  await owner.getByLabel('Year').fill('2012');
  await owner.getByLabel('Make').fill('Demo');
  await owner.getByLabel('Model').fill('Shared vehicle');
  await owner.getByRole('button', { name: 'Save vehicle' }).click();
  await owner.getByRole('heading', { name: 'Shared vehicle' }).waitFor();
  await owner.getByRole('button', { name: 'Sharing', exact: true }).click();
  await owner.getByRole('button', { name: 'Create invite link' }).click();
  const invite = owner.getByLabel('Copy this single-use link.', { exact: false });
  await invite.waitFor();
  await guest.goto(await invite.inputValue());
  await register(guest, 'guest@example.test');
  await guest.getByRole('button', { name: 'Join garage' }).click();
  await guest.locator('#vehicles').getByRole('link', { name: /Shared vehicle/ }).waitFor();
  await guest.getByLabel('Garage', { exact: true }).selectOption({ label: 'My garage' });
  await guest.getByText('0 vehicles', { exact: true }).waitFor();
  await guest.getByRole('button', { name: 'Sign out' }).click();
  await guest.getByRole('button', { name: 'Sign in' }).waitFor();
  assert.equal(await guest.getByRole('link', { name: /Shared vehicle/ }).count(), 0);
} finally {
  await browser.close();
}
