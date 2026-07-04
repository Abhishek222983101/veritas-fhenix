import { test, expect } from '@playwright/test';

const FRONTEND = process.env.FRONTEND_URL || 'http://localhost:3002';

test.describe('VERITAS-FHENIX Frontend', () => {
  test('homepage loads and shows live backend status', async ({ page }) => {
    await page.goto(FRONTEND);
    await expect(page.locator('text=VERITAS.FHENIX')).toBeVisible();
    await expect(page.locator('text=The Encrypted Council')).toBeVisible();

    // Wait for health check to flip LIVE
    await expect(page.locator('text=LIVE')).toBeVisible({ timeout: 15000 });

    // Feed should populate with existing questions
    await expect(page.locator('text=Question Feed')).toBeVisible();
    await expect(page.locator('text=Will Bitcoin close above $200,000')).toBeVisible({ timeout: 10000 });
  });

  test('agents page renders 5 council members', async ({ page }) => {
    await page.goto(`${FRONTEND}/agents`);
    await expect(page.locator('text=The Council')).toBeVisible();
    for (const name of ['Oracle Alpha', 'Skeptic Beta', 'Signal Gamma', 'Risk Delta', 'Synthesis Epsilon']) {
      await expect(page.locator(`text=${name}`).first()).toBeVisible({ timeout: 10000 });
    }
  });

  test('question detail shows encrypted votes and resolution reveal', async ({ page }) => {
    await page.goto(`${FRONTEND}/question/1`);
    await expect(page.locator('text=Will Bitcoin close above $200,000')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=On-Chain Encrypted Votes')).toBeVisible();
    await expect(page.locator('text=Agent Deliberation')).toBeVisible();
    await expect(page.locator('text=Decrypted Aggregate Result')).toBeVisible();
    // Result badge in the reveal section
    await expect(
      page.locator('[class*="text-rose-500"]', { hasText: /^NO$/ }).first()
    ).toBeVisible();
    // Verify individual votes are shown
    await expect(page.locator('text=Skeptic Beta').first()).toBeVisible();
  });

  test('SSE event stream connects and receives events', async ({ page }) => {
    await page.goto(FRONTEND);
    await expect(page.locator('text=Waiting for events…')).toBeVisible();
    await page.waitForTimeout(2000);
    // After connecting, the header should show the event count
    await expect(page.locator('text=/\\d+ events/')).toBeVisible();
  });
});
