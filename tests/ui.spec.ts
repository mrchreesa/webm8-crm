import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Owner email').fill('test@example.com');
  await page.getByLabel('Password', { exact: true }).fill('test-owner-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'The bigger picture.' })).toBeVisible();
});
test('owner can create, edit, record an outcome, note, export and permanently delete a manual lead', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Add lead', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill('Browser Lead');
  await dialog.getByLabel('Email', { exact: true }).fill('browser@example.com');
  await dialog.getByRole('button', { name: 'Add lead', exact: true }).click();
  await page.getByRole('link', { name: 'Browser Lead', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Browser Lead', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Change stage' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('New stage').selectOption('Qualified');
  await dialog.getByRole('button', { name: 'Save stage' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Qualified', { exact: true }).first()).toBeVisible();
  await page.getByLabel('Add a note').fill('Meaningful browser note');
  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  await expect(page.getByText('Meaningful browser note')).toBeVisible();
  await page.getByRole('button', { name: 'Edit details' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Phone', { exact: true }).fill('020 7946 0018');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('link', { name: '020 7946 0018' })).toBeVisible();
  const exportResult = await page.request.get('/api/leads/export?format=json');
  expect(exportResult.ok()).toBeTruthy();
  const body = await exportResult.json();
  const lead = body.leads.find((r: any) => r.lead.name === 'Browser Lead');
  expect(lead.history.length).toBe(2);
  expect(lead.events.length).toBe(0);
  await page.getByRole('button', { name: 'Delete lead', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Delete lead' }).click();
  await expect(page.getByRole('heading', { name: 'Every lead. One place.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Browser Lead', exact: true })).toHaveCount(0);
});
test('demo dashboard, integration and sync log are honest; keyboard, mobile and accessibility work', async ({
  page,
}) => {
  await expect(
    page.getByText('Synthetic leads for exploring your CRM.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByText('Demo Emma', { exact: true })).toBeVisible();
  await expect(page.getByText('Meta disconnected', { exact: true })).toBeVisible();
  let results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
  await page.screenshot({ path: 'test-results/overview-desktop.png', fullPage: true });
  await page.getByRole('link', { name: 'Meta integration', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Meta is disconnected' })).toBeVisible();
  await expect(page.getByText('Background worker is running')).toBeVisible();
  results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
  await page.getByRole('link', { name: 'Sync log', exact: true }).click();
  await expect(page.getByText('Not sent', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Inspect event' }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await page.screenshot({ path: 'test-results/overview-mobile.png', fullPage: true });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await page.getByRole('button', { name: 'Add lead', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Unsaved');
  await page.keyboard.press('Escape');
  await expect(page.getByText('You have unsaved changes. Discard them?')).toBeVisible();
  await page.getByRole('button', { name: 'Discard changes' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('search clear, no-results, validation recovery and failed reads remain usable', async ({
  page,
}) => {
  await page.getByRole('link', { name: 'Leads', exact: true }).click();
  await page.getByLabel('Search leads').fill('nonexistent');
  await expect(page.getByRole('heading', { name: 'No leads match these filters' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(page.getByRole('link', { name: 'Demo Emma', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add lead', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Add lead', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByLabel('Name', { exact: true })).toBeFocused();
  await dialog.getByLabel('Name', { exact: true }).fill('Recovery lead');
  await dialog.getByRole('button', { name: 'Add lead', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Recovery lead', exact: true })).toBeVisible();
  await page.route('**/api/events?**', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"error":"Test service unavailable"}',
    }),
  );
  await page.getByRole('link', { name: 'Sync log', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Could not load this view' })).toBeVisible();
  await page.unroute('**/api/events?**');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'Could not load this view' })).toHaveCount(0);
});
test('CSV mapping preview and import preserve historical timestamps and IDs', async ({ page }) => {
  await page.getByRole('link', { name: 'Leads', exact: true }).click();
  await page.getByRole('link', { name: 'Import CSV', exact: true }).click();
  const csv =
    'name,meta_lead_id,page_id,form_id,meta_submitted_at,received_at,current_stage,qualified_at\nCSV Lead,98765432109876543,12345678901234567,34567890123456789,2025-01-01T10:00:00Z,2025-01-01T10:01:00Z,Qualified,2025-01-02T10:00:00Z\n';
  await page
    .getByLabel('Choose CSV file')
    .setInputFiles({ name: 'leads.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByRole('button', { name: 'Preview and validate' }).click();
  await expect(page.getByText('1 ready')).toBeVisible();
  await expect(page.getByText('98765432109876543', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Import 1 valid leads' }).click();
  await expect(page.getByText('Import complete.')).toBeVisible();
  const body = await (await page.request.get('/api/leads/export?format=json')).json();
  const lead = body.leads.find((r: any) => r.lead.name === 'CSV Lead');
  expect(lead.lead.meta_lead_id).toBe('98765432109876543');
  expect(lead.history[1].occurred_at).toBe('2025-01-02T10:00:00.000Z');
  expect(lead.events.every((e: any) => e.status === 'expired')).toBeTruthy();
});
test('unsaved notes survive blocked navigation and session expiry; stale responses cannot replace search results', async ({
  page,
}) => {
  await page.getByRole('link', { name: 'Leads', exact: true }).click();
  await page.getByRole('link', { name: 'Demo Emma', exact: true }).click();
  await page.getByLabel('Add a note').fill('Keep this draft');
  await page.getByRole('link', { name: 'Sync log', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Discard unsaved changes?' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByLabel('Add a note')).toHaveValue('Keep this draft');
  await page.context().clearCookies();
  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  const auth = page.getByRole('dialog', { name: 'Sign in to continue' });
  await expect(auth).toBeVisible();
  await auth.getByLabel('Owner email').fill('test@example.com');
  await auth.getByLabel('Password', { exact: true }).fill('test-owner-password');
  await auth.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(auth).toHaveCount(0);
  await expect(page.getByLabel('Add a note')).toHaveValue('Keep this draft');
  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  await expect(page.getByText('Keep this draft', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Leads', exact: true }).click();
  await page.route('**/api/leads?**', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('q') === 'Emma') {
      await new Promise((r) => setTimeout(r, 650));
      await route.continue();
    } else await route.continue();
  });
  await page.getByLabel('Search leads').fill('Emma');
  await page.waitForTimeout(350);
  await page.getByLabel('Search leads').fill('James');
  await expect(page.getByRole('link', { name: 'Demo James', exact: true })).toBeVisible();
  await page.waitForTimeout(750);
  await expect(page.getByRole('link', { name: 'Demo Emma', exact: true })).toHaveCount(0);
});
test('received and stage filters restore after opening a lead; browser Back protects an unsaved note', async ({
  page,
}) => {
  await page.getByRole('link', { name: 'Leads', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Every lead. One place.' })).toBeVisible();
  await page.getByLabel('Received period').selectOption('all');
  await page.getByLabel('Stage filter').selectOption('New');
  await page.getByRole('link', { name: 'Demo Emma', exact: true }).click();
  await page.getByRole('link', { name: 'Back to leads' }).click();
  await expect(page.getByLabel('Received period')).toHaveValue('all');
  await expect(page.getByLabel('Stage filter')).toHaveValue('New');
  await page.getByRole('link', { name: 'Demo Emma', exact: true }).click();
  await page.getByLabel('Add a note').fill('Browser Back draft');
  await page.evaluate(() => history.back());
  await expect(page.getByRole('dialog', { name: 'Discard unsaved changes?' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByLabel('Add a note')).toHaveValue('Browser Back draft');
});
