import { test } from '@playwright/test';

test('prod screenshots', async ({ page }) => {
  await page.goto('https://veritas-fhenix.vercel.app/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: '/tmp/prod-home.png', fullPage: true });

  await page.goto('https://veritas-fhenix.vercel.app/question/1', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: '/tmp/prod-question.png', fullPage: true });

  await page.goto('https://veritas-fhenix.vercel.app/agents', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: '/tmp/prod-agents.png', fullPage: true });
});
