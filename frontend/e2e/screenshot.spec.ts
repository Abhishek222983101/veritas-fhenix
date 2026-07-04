import { test } from '@playwright/test';

const FRONTEND = process.env.FRONTEND_URL || 'http://localhost:3002';

test('capture screenshots', async ({ page }) => {
  await page.goto(FRONTEND);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: '/tmp/veritas-home.png', fullPage: true });

  await page.goto(`${FRONTEND}/question/1`);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: '/tmp/veritas-question-1.png', fullPage: true });

  await page.goto(`${FRONTEND}/question/2`);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: '/tmp/veritas-question-2.png', fullPage: true });

  await page.goto(`${FRONTEND}/agents`);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/veritas-agents.png', fullPage: true });
});
