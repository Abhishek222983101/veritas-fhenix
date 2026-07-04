import { test, expect } from '@playwright/test';

const PROD = 'https://veritas-fhenix.vercel.app';

test('prod homepage shows LIVE and questions', async ({ page }) => {
  await page.goto(PROD, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('text=VERITAS.FHENIX').first()).toBeVisible();
  await expect(page.locator('text=LIVE').first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator('text=Question Feed')).toBeVisible();
}, 60000);

test('prod agents page loads council', async ({ page }) => {
  await page.goto(`${PROD}/agents`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('text=The Council').first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator('text=Oracle Alpha').first()).toBeVisible({ timeout: 30000 });
}, 60000);

test('prod question detail loads', async ({ page }) => {
  await page.goto(`${PROD}/question/1`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('text=Will Bitcoin close').first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator('text=Encrypted Votes').first()).toBeVisible({ timeout: 15000 });
}, 60000);
