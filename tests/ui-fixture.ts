import { createHash } from 'node:crypto';
import { test as base } from '@playwright/test';

// The isolated Vite test proxy is one trusted hop. Give each synthetic browser
// its own test-network address so an expanded suite does not share one login
// quota. Production throttling remains unchanged and has its own server tests.
export const test = base.extend({
  page: async ({ page }, use, info) => {
    const id = createHash('sha256').update(info.testId).digest();
    await page.setExtraHTTPHeaders({ 'X-Forwarded-For': `198.18.${id[0]}.${id[1]}` });
    await use(page);
  },
});
export { expect, type Page } from '@playwright/test';
