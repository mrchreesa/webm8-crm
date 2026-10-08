import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { openTestDatabase } from './database-fixture';
import { getConfig } from '../server/config';
import { createApp } from '../server/app';
import { changeStage, deleteLead, getLead } from '../server/leads';

test('signed website intake saves once, keeps attribution, and never impersonates a Meta lead', async () => {
  const db = await openTestDatabase(':memory:');
  const cfg = getConfig({
    APP_URL: 'http://localhost:5999',
    WEBSITE_INTAKE_SECRET: 'test-intake-secret',
  });
  const app = createApp(db, cfg);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}/api/webhooks/website`;
  const data = {
    submissionKey: randomUUID(),
    name: 'Website test',
    business: 'Test business',
    email: 'test@example.com',
    phone: '07700900123',
    area: 'London',
    trade: 'cleaning',
    tradeOther: null,
    link: null,
    attribution: { utm_content: 'arena' },
    referrer: null,
    pagePath: '/free-demo/',
  };
  const body = JSON.stringify(data);
  const sign = (value: string) =>
    'sha256=' + createHmac('sha256', cfg.websiteIntakeSecret).update(value).digest('hex');
  const send = (value = body, signature = sign(value)) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-webm8-signature-256': signature },
      body: value,
    });
  try {
    assert.equal((await send(body, 'sha256=wrong')).status, 401);
    assert.equal((await send(body + ' ', sign(body))).status, 401);
    assert.equal((await send('{')).status, 400);
    assert.equal((await send(JSON.stringify({ ...data, email: 'invalid' }))).status, 400);
    const responses = await Promise.all([send(), send()]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 201]);
    const receipts = (await Promise.all(responses.map((r) => r.json()))) as {
      id: string;
      duplicate: boolean;
    }[];
    assert.equal(receipts[0].id, receipts[1].id);
    const lead = await getLead(db, receipts[0].id);
    assert.equal(lead.website_submission_key, data.submissionKey);
    assert.equal(lead.form_name, 'Website demo');
    assert.equal(lead.meta_lead_id, null);
    assert.match(lead.form_answers, /arena/);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM leads').get()).n, 1);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM stage_history').get()).n, 1);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM outbox').get()).n, 0);
    await changeStage(
      db,
      cfg,
      lead.id,
      { stage: 'Qualified', version: lead.version },
      'Test owner',
    );
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM outbox').get()).n, 0);
    const updated = await getLead(db, lead.id);
    await deleteLead(db, updated.id);
    assert.equal((await send()).status, 410);
    const withoutArea = { ...data, submissionKey: randomUUID(), area: undefined };
    assert.equal((await send(JSON.stringify(withoutArea))).status, 201);
    cfg.websiteIntakeSecret = '';
    assert.equal((await send()).status, 503);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.close();
  }
});
