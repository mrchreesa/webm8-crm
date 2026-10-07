import { test, expect } from './ui-fixture';
import AxeBuilder from '@axe-core/playwright';

test('CRM and Analytics tabs preserve drafts and reports, with keyboard and mobile access', async ({
  page,
}) => {
  let loads = 0;
  await page.route('https://webm8-platform.vercel.app/**', (route) => {
    loads++;
    return route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="en"><head><title>Test analytics</title></head><body><main><h1>Measured website activity</h1><label>Page filter<input id="filter"></label></main><script>addEventListener('message',e=>{if(e.data?.type==='webm8:embed:init')parent.postMessage({type:'webm8:embed:ready'},e.origin)})</script></body></html>`,
    });
  });
  await page.getByRole('link', { name: 'Leads', exact: true }).click();
  await page.getByRole('link', { name: 'Demo Emma', exact: true }).click();
  const leadUrl = page.url();
  await page.getByLabel('Add a note').fill('Keep my CRM draft');
  await page.getByRole('tab', { name: 'CRM', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Analytics', exact: true })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Analytics', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const report = page.frameLocator('iframe[title="WebM8 website analytics"]');
  await expect(report.getByRole('heading', { name: 'Measured website activity' })).toBeVisible();
  await report.getByLabel('Page filter').fill('/pricing');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByText('Synthetic leads for exploring your CRM.', { exact: false }),
  ).toBeHidden();
  await expect(page.getByLabel('Lead data')).toBeHidden();
  await expect(page).toHaveTitle('Analytics — WebM8');
  await page.getByRole('tab', { name: 'CRM', exact: true }).click();
  await expect(page.getByLabel('Add a note')).toHaveValue('Keep my CRM draft');
  expect(page.url()).toBe(leadUrl);
  await page.getByRole('tab', { name: 'Analytics', exact: true }).click();
  await expect(report.getByLabel('Page filter')).toHaveValue('/pricing');
  expect(loads).toBe(1);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'test-results/analytics-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/analytics-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Reload', exact: true }).click();
  await expect(report.getByLabel('Page filter')).toHaveValue('');
  expect(loads).toBe(2);
  await page.getByRole('tab', { name: 'CRM', exact: true }).click();
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Discard unsaved changes?' })).toBeVisible();
});

test('Analytics rejects a forged ready message and offers recovery for an unavailable embed', async ({
  page,
}) => {
  await page.route('https://webm8-platform.vercel.app/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<h1>Unavailable test service</h1>' }),
  );
  await page.clock.install();
  await page.getByRole('tab', { name: 'Analytics', exact: true }).click();
  await page.evaluate(() =>
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://webm8-platform.vercel.app',
        source: window,
        data: { type: 'webm8:embed:ready' },
      }),
    ),
  );
  await expect(page.getByText('Opening Analytics…')).toBeVisible();
  await page.clock.fastForward(16000);
  await expect(page.getByText('Analytics has not connected')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open separately' })).toHaveAttribute(
    'target',
    '_blank',
  );
  await page.getByRole('tab', { name: 'CRM', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Lead desk' })).toBeVisible();
});
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Owner email').fill('test@example.com');
  await page.getByLabel('Password', { exact: true }).fill('test-owner-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Lead desk' })).toBeVisible();
  await page.getByLabel('Lead data').selectOption('demo');
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
  await expect(
    page.locator('.desk-record > .page-heading').getByText('Qualified', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Browser Lead', exact: true })).toContainText(
    'Qualified',
  );
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
  await expect(page.getByRole('heading', { name: 'Lead desk' })).toBeVisible();
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
  await expect(page.getByRole('heading', { name: 'Lead desk' })).toBeVisible();
  await page.locator('.queue-filters > summary').click();
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

test('hosted queue status, live lock and background-check recovery stay usable on mobile', async ({
  page,
}) => {
  await page.route(/\/api\/integration(?:\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({
      json: {
        ...data,
        settings: { ...data.settings, mode: 'test' },
        live_allowed: false,
        worker: { kind: 'queue', configured: true, running: false, last_seen: null, error: null },
      },
    });
  });
  let fail = false;
  await page.route('**/api/integration/queue/check', (route) =>
    route.fulfill({
      status: fail ? 503 : 200,
      json: fail
        ? { error: 'Hosted queue unavailable. Saved work will be recovered.' }
        : { queued: true },
    }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('link', { name: 'Meta integration', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Hosted background queue configured' }),
  ).toBeVisible();
  await expect(
    page.getByText('Awaiting the first background check.', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Check background delivery' }).click();
  await expect(page.getByRole('status')).toContainText('Background check queued');
  fail = true;
  await page.getByRole('button', { name: 'Check background delivery' }).click();
  await expect(page.getByRole('status')).toContainText('Hosted queue unavailable');
  await page.getByLabel('Delivery mode', { exact: true }).selectOption('live');
  await expect(
    page.getByText('Live delivery is locked until hosted testing is complete', { exact: false }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
  await page.screenshot({ path: 'test-results/queue-mobile-test.png', fullPage: true });
});

test('malformed and legacy form answers do not hide the lead or its contact actions', async ({
  page,
}) => {
  let formAnswers = JSON.stringify([
    { name: 'legacy_answer', value: 'Preserved answer' },
    { name: 'optional_answer' },
    null,
  ]);
  await page.route('**/api/leads/*', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const data = await response.json();
    if (data.lead) data.lead.form_answers = formAnswers;
    await route.fulfill({ response, json: data });
  });
  await page.getByRole('link', { name: 'Leads', exact: true }).click();
  await page.getByRole('link', { name: 'Demo Emma', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Demo Emma', exact: true })).toBeVisible();
  await page.locator('.record-disclosure > summary').filter({ hasText: 'Original source' }).click();
  await expect(page.getByText('Preserved answer', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit details', exact: true })).toBeVisible();
  await expect(
    page.getByText('Some form answers could not be read.', { exact: false }),
  ).toBeVisible();
  formAnswers = '{broken json';
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Demo Emma', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit details', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/lead-recovery-mobile.png', fullPage: true });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
});

test('possible website visits show evidence, uncertainty and page history without losing the CRM draft', async ({
  page,
}) => {
  const sessionId = '10203040-1234-4123-8123-123456789abc';
  const now = new Date().toISOString();
  let failure = false,
    empty = false;
  await page.route('**/api/leads/*/website-activity?**', async (route) => {
    if (failure)
      return route.fulfill({
        status: 503,
        json: { error: 'Website activity is temporarily unavailable. Try again.' },
      });
    const detail = new URL(route.request().url()).searchParams.get('visit');
    return route.fulfill({
      json: {
        status: 'ready',
        checkedAt: now,
        basis: 'Meta submission',
        referenceAt: now,
        total: empty ? 0 : 1,
        page: 1,
        truncated: false,
        candidates: empty
          ? []
          : [
              {
                sessionId,
                visitorId: 'browser',
                firstReceivedAt: now,
                device: 'mobile',
                deltaMs: 24000,
                band: 'Ad and timing match',
                evidence: ['Ad ID matches the landing URL'],
                conflicts: [],
                rank: 30,
                competingLeads: 1,
              },
            ],
        selected: detail
          ? {
              sessionId,
              total: 1,
              page: 1,
              analyticsPath: '/app/webm8/websites',
              rows: [
                {
                  id: 'page',
                  path: '/demo',
                  created_at: now,
                  active_ms: 45000,
                  scroll_depth: 80,
                  clicks: { 'demo-deck / demo-card-1': 1 },
                  telemetry: {
                    journey: {
                      visibleMs: 60000,
                      clicks: [{ name: 'demo-deck / demo-card-1', at: Date.now() }],
                      clicksTruncated: false,
                    },
                  },
                },
              ],
            }
          : undefined,
      },
    });
  });
  await page.getByRole('link', { name: 'Leads', exact: true }).click();
  await page.getByRole('link', { name: 'Demo Emma', exact: true }).click();
  await page.getByLabel('Add a note').fill('Keep this while inspecting a possible visit');
  const panel = page.getByRole('region', { name: 'Website activity', exact: true });
  await expect(panel.getByText('Ad and timing match', { exact: true })).toBeVisible();
  await expect(panel.getByText(/Also fits 1 other lead/)).toBeVisible();
  await panel.getByRole('button', { name: 'Inspect this visit' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(panel.getByText('Clicked demo-deck / demo-card-1')).toBeVisible();
  await expect(panel.getByText('45s active · 1m 0s visible · 80% scroll reach')).toBeVisible();
  await expect(page.getByLabel('Add a note')).toHaveValue(
    'Keep this while inspecting a possible visit',
  );
  await expect(page).toHaveURL(/activityVisit=/);
  await panel.screenshot({ path: 'test-results/website-activity-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await panel.screenshot({ path: 'test-results/website-activity-mobile.png' });
  expect(
    (await new AxeBuilder({ page }).include('.website-activity').analyze()).violations,
  ).toEqual([]);
  failure = true;
  await panel.getByRole('button', { name: 'Refresh website activity' }).click();
  await expect(
    panel.getByText('Website activity is temporarily unavailable. Try again.'),
  ).toBeVisible();
  await expect(page.getByLabel('Add a note')).toHaveValue(
    'Keep this while inspecting a possible visit',
  );
  failure = false;
  empty = true;
  await panel.getByRole('button', { name: 'Try again' }).click();
  await expect(panel.getByText('No possible measured visit found')).toBeVisible();
});

test('Lead desk keeps search and selection, guards record changes and returns to the queue on mobile', async ({
  page,
}) => {
  await page.getByLabel('Search leads').fill('Demo');
  await expect(page.getByRole('link', { name: 'Demo Emma', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Demo Emma', exact: true }).click();
  await expect(page.getByLabel('Search leads')).toHaveValue('Demo');
  await expect(page.getByRole('link', { name: 'Demo Emma', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await page.getByLabel('Add a note').fill('Emma only');
  await page.getByRole('link', { name: 'Demo James', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Discard unsaved changes?' })).toBeVisible();
  await page.getByRole('button', { name: 'Discard changes' }).click();
  await expect(page.getByRole('heading', { name: 'Demo James', exact: true })).toBeVisible();
  await expect(page.getByLabel('Add a note')).toHaveValue('');
  await expect(page.getByLabel('Search leads')).toHaveValue('Demo');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'test-results/lead-desk-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('region', { name: 'Lead queue', exact: true })).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/lead-desk-mobile.png', fullPage: true });
  await page.getByRole('link', { name: 'Back to leads' }).click();
  await expect(page.getByLabel('Search leads')).toHaveValue('Demo');
  await expect(page.getByRole('link', { name: 'Demo James', exact: true })).toBeVisible();
});
