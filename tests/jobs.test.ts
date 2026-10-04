import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getConfig } from '../server/config';
import { settings, saveSettings } from '../server/db';
import { createLead, changeStage } from '../server/leads';
import { retryEvent } from '../server/outbox';
import { runHostedCycle, nextWorkAt, wakeQueue } from '../server/jobs';
import { openTestPostgres } from './database-fixture';

const cfg = getConfig({
  VERCEL: '1',
  VERCEL_ENV: 'production',
  CRM_QUEUE_ENABLED: 'true',
  APP_URL: 'https://example.com',
  META_INITIAL_MODE: 'test',
  META_DATASET_ID: '23456789012345678',
  META_CAPI_ACCESS_TOKEN: 'synthetic-token',
  META_TEST_EVENT_CODE: 'TEST-synthetic',
});
const accepted: typeof fetch = async () =>
  new Response(JSON.stringify({ events_received: 1 }), { status: 200 });
async function fixture() {
  const db = await openTestPostgres();
  await saveSettings(db, await settings(db, cfg));
  const lead = (
    await createLead(
      db,
      cfg,
      {
        source: 'meta_instant_form',
        name: 'Synthetic queue test',
        meta_lead_id: '98765432109876543',
        page_id: '12345678901234567',
        form_id: '34567890123456789',
        meta_submitted_at: new Date().toISOString(),
        is_test: true,
      },
      'Tester',
    )
  ).lead;
  return { db, lead };
}
test('hosted queue redelivery preserves SQL identity and per-lead order', async () => {
  const { db, lead } = await fixture();
  try {
    await changeStage(db, cfg, lead.id, { stage: 'Qualified', version: lead.version }, 'Tester');
    const before = await db
      .prepare('SELECT event_id,event_time,payload FROM outbox ORDER BY seq')
      .all();
    const delays: number[] = [],
      publish = async (delay: number) => {
        delays.push(delay);
      };
    await runHostedCycle(db, cfg, publish, accepted);
    assert.equal(
      (await db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE status='accepted'").get()).n,
      1,
    );
    assert.equal(delays.length, 1);
    await runHostedCycle(db, cfg, publish, accepted);
    await runHostedCycle(db, cfg, publish, accepted);
    assert.deepEqual(
      await db.prepare('SELECT event_id,event_time,payload FROM outbox ORDER BY seq').all(),
      before,
    );
    assert.deepEqual(
      (await db.prepare('SELECT attempts FROM outbox ORDER BY seq').all()).map((r) => r.attempts),
      [1, 1],
    );
    assert.equal(await nextWorkAt(db, cfg), null);
  } finally {
    await db.close();
  }
});
test('failed publication preserves work and a later recovery wakeup delivers it', async () => {
  const { db } = await fixture();
  try {
    await assert.rejects(
      () =>
        wakeQueue(db, cfg, async () => {
          throw new Error('private vendor error');
        }),
      /Saved work/,
    );
    assert.ok(
      (await db.prepare('SELECT last_error FROM queue_health').get()).last_error.includes(
        'saved in SQL',
      ),
    );
    assert.ok(await nextWorkAt(db, cfg));
    await runHostedCycle(db, cfg, async () => {}, accepted);
    assert.equal((await db.prepare('SELECT status FROM outbox').get()).status, 'accepted');
  } finally {
    await db.close();
  }
});
test('temporary failures schedule backoff, recoverable errors wait for owner retry, and live stays locked', async () => {
  const { db } = await fixture();
  try {
    const delays: number[] = [],
      publisher = async (delay: number) => {
        delays.push(delay);
      };
    await runHostedCycle(db, cfg, publisher, async () => new Response('{}', { status: 503 }));
    assert.ok(delays[0] >= 29 && delays[0] <= 30);
    const original = await db.prepare('SELECT * FROM outbox').get();
    await db.prepare('UPDATE outbox SET next_attempt_at=?').run(new Date(0).toISOString());
    await runHostedCycle(
      db,
      cfg,
      publisher,
      async () => new Response(JSON.stringify({ error: { code: 190 } }), { status: 401 }),
    );
    assert.equal((await db.prepare('SELECT status FROM outbox').get()).status, 'failed');
    assert.equal(await nextWorkAt(db, cfg), null);
    await retryEvent(db, cfg, original.event_id);
    await runHostedCycle(db, cfg, publisher, accepted);
    const final = await db.prepare('SELECT * FROM outbox').get();
    assert.equal(final.event_id, original.event_id);
    assert.equal(final.event_time, original.event_time);
    assert.equal(final.status, 'accepted');
    await saveSettings(db, { ...(await settings(db, cfg)), mode: 'live' });
    assert.equal(await nextWorkAt(db, cfg), null);
    await assert.rejects(
      () => runHostedCycle(db, { ...cfg, deployment: 'preview' }, publisher, accepted),
      /production/,
    );
  } finally {
    await db.close();
  }
});
