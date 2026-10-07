import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { settings, saveSettings, type DB } from '../server/db';
import { openTestDatabase as openDatabase } from './database-fixture';
import { getConfig, type Config } from '../server/config';
import {
  createLead,
  changeStage,
  editLead,
  addNote,
  getLead,
  deleteLead,
  leadDetail,
} from '../server/leads';
import {
  matchingIdentifiers,
  normalizeEmail,
  normalizePhone,
  sha256,
  metaId,
} from '../server/matching';
import { validSignature, persistWebhook, retrieveOne, losslessJSON } from '../server/meta';
import { deliverOne, claimEvent, expireEvents, retryEvent } from '../server/outbox';
import { exportCSV, importCSV, previewCSV } from '../server/csv';
import { createApp } from '../server/app';
import { hashPassword, createSession, session } from '../server/auth';
import type { Request, Response } from 'express';
import { londonRange } from '../server/time';
import { toUTC } from '../src/format';
import type { Lead, OutboxEvent } from '../src/domain';
const roots: string[] = [],
  dbs: DB[] = [];
after(async () => {
  for (const db of dbs) if (db.open) await db.close();
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});
async function fixture(mode: 'demo' | 'test' | 'live' = 'live') {
  const root = mkdtempSync(join(tmpdir(), 'webm8-crm-'));
  roots.push(root);
  const cfg = getConfig({
    DATABASE_PATH: join(root, 'crm.sqlite'),
    APP_URL: 'http://localhost:5999',
    OWNER_PASSWORD_HASH: hashPassword('a-test-password-123'),
    META_PAGE_ACCESS_TOKEN: 'page-token-placeholder',
    META_CAPI_ACCESS_TOKEN: 'capi-token-placeholder',
    META_APP_SECRET: 'app-secret-placeholder',
    META_VERIFY_TOKEN: 'verify-placeholder',
    META_PAGE_ID: '12345678901234567',
    META_DATASET_ID: '23456789012345678',
    META_TEST_EVENT_CODE: 'TEST-placeholder',
  });
  const db = await openDatabase(cfg.databasePath);
  dbs.push(db);
  await saveSettings(db, { ...(await settings(db, cfg)), mode });
  return { db, cfg };
}
const prior = (days = 0) => new Date(Date.now() - days * 86400000 - 60000).toISOString();
async function metaLead(db: DB, cfg: Config, id = '98765432109876543', received = prior()) {
  return (
    await createLead(
      db,
      cfg,
      {
        source: 'meta_instant_form',
        meta_lead_id: id,
        page_id: '12345678901234567',
        form_id: '34567890123456789',
        ad_id: '45678901234567890',
        name: 'Test Person',
        email: '  OWNER@Example.COM ',
        phone: '07700 900123',
        meta_submitted_at: received,
        received_at: received,
      },
      'Test owner',
    )
  ).lead;
}
const events = async (db: DB, id?: string) =>
  (await db
    .prepare(`SELECT * FROM outbox ${id ? 'WHERE lead_id=?' : ''} ORDER BY event_time,seq`)
    .all(...(id ? [id] : []))) as OutboxEvent[];
const okFetch = (capture?: string[]) =>
  (async (_url: any, init: any) => {
    if (capture) capture.push(init.body);
    return new Response(JSON.stringify({ events_received: 1, fbtrace_id: 'trace123' }), {
      status: 200,
    });
  }) as typeof fetch;

test('lead persists across closing and reopening the SQL database', async () => {
  const { db, cfg } = await fixture();
  const l = await metaLead(db, cfg);
  await db.close();
  const reopened = await openDatabase(cfg.databasePath);
  dbs.push(reopened);
  assert.equal((await getLead(reopened, l.id)).meta_lead_id, '98765432109876543');
  assert.equal((await leadDetail(reopened, l.id)).history.length, 1);
});
test('duplicate webhook notifications and retrieval preserve 17-digit IDs and create one New milestone', async () => {
  const { db, cfg } = await fixture();
  const raw = Buffer.from(
    '{"object":"page","entry":[{"id":12345678901234567,"changes":[{"field":"leadgen","value":{"leadgen_id":98765432109876543,"page_id":12345678901234567,"form_id":34567890123456789,"created_time":1700000000}}]}]}',
  );
  const sig = 'sha256=' + createHmac('sha256', cfg.appSecret).update(raw).digest('hex');
  assert.equal(validSignature(raw, sig, cfg.appSecret), true);
  assert.equal(await persistWebhook(db, cfg, raw), 1);
  assert.equal(await persistWebhook(db, cfg, raw), 0);
  const full = `{"id":98765432109876543,"form_id":34567890123456789,"created_time":"${prior()}","field_data":[{"name":"full_name","values":["Test Person"]},{"name":"email","values":["a@example.com"]}]}`;
  await retrieveOne(db, cfg, (async () => new Response(full)) as typeof fetch);
  assert.equal(await persistWebhook(db, cfg, raw), 0);
  assert.equal(((await db.prepare('SELECT COUNT(*) AS n FROM leads').get()) as any).n, 1);
  assert.equal(((await db.prepare('SELECT COUNT(*) AS n FROM stage_history').get()) as any).n, 1);
  assert.equal((await events(db)).length, 1);
  const l = (await db.prepare('SELECT * FROM leads').get()) as Lead;
  assert.equal(l.meta_lead_id, '98765432109876543');
  assert.equal(l.page_id, '12345678901234567');
  assert.equal(l.form_id, '34567890123456789');
  assert.equal(JSON.parse((await events(db))[0].payload).user_data.lead_id, l.meta_lead_id);
  assert.equal(
    (parse(await exportCSV(db), { columns: true, cast: false }) as any[])[0].meta_lead_id,
    l.meta_lead_id,
  );
});
test('Meta email_address contact fields survive retrieval and are hashed in the queued event', async () => {
  const { db, cfg } = await fixture('test');
  await persistWebhook(
    db,
    cfg,
    Buffer.from(
      JSON.stringify({
        object: 'page',
        entry: [
          {
            id: cfg.pageId,
            changes: [
              {
                field: 'leadgen',
                value: {
                  leadgen_id: '98765432109876543',
                  page_id: cfg.pageId,
                  form_id: '34567890123456789',
                },
              },
            ],
          },
        ],
      }),
    ),
  );
  await retrieveOne(
    db,
    cfg,
    (async () =>
      new Response(
        JSON.stringify({
          id: '98765432109876543',
          form_id: '34567890123456789',
          created_time: prior(),
          field_data: [
            { name: 'full_name', values: ['Alias contact'] },
            { name: 'email_address', values: [' OWNER@Example.COM '] },
            { name: 'phone_number', values: ['020 7946 0018'] },
          ],
        }),
      )) as typeof fetch,
  );
  const lead = (await db.prepare('SELECT * FROM leads').get()) as Lead;
  assert.equal(lead.email, 'OWNER@Example.COM');
  assert.equal(lead.is_test, 1);
  assert.equal((await events(db)).length, 1);
  const payload = JSON.parse((await events(db))[0].payload);
  assert.deepEqual(payload.user_data.em, [sha256('owner@example.com')]);
  assert.deepEqual(payload.user_data.ph, [sha256('442079460018')]);
  assert.equal((await events(db))[0].mode, 'test');
});
test('same email never merges different Meta submissions', async () => {
  const { db, cfg } = await fixture();
  const a = await metaLead(db, cfg),
    b = await metaLead(db, cfg, '98765432109876544');
  assert.notEqual(a.id, b.id);
  assert.equal(a.email, b.email);
});
test('genuine stage change queues correct event, skipping intermediate milestones', async () => {
  const { db, cfg } = await fixture();
  const l = await metaLead(db, cfg);
  await changeStage(db, cfg, l.id, { stage: 'Qualified', version: l.version }, 'Owner');
  const detail = await leadDetail(db, l.id);
  assert.equal(detail.history.length, 2);
  assert.equal(detail.history[1].changed_by, 'Owner');
  assert.equal((await events(db))[1].event_name, 'CRM_Qualified');
  assert.equal(
    (
      (await db
        .prepare("SELECT COUNT(*) AS n FROM milestones WHERE stage='Contacted'")
        .get()) as any
    ).n,
    0,
  );
});
test('same-stage saves, notes and contact edits never create conversions', async () => {
  const { db, cfg } = await fixture();
  const l = await metaLead(db, cfg);
  await changeStage(db, cfg, l.id, { stage: 'New', version: l.version }, 'Owner');
  await addNote(db, l.id, 'Private note', 'Owner');
  await editLead(db, l.id, {
    version: l.version,
    name: l.name,
    email: 'new@example.com',
    phone: '020 7946 0018',
    follow_up_at: null,
    appointment_at: null,
    sale_minor: null,
    qualification: [],
  });
  assert.equal((await events(db)).length, 1);
  assert.equal((await leadDetail(db, l.id)).history.length, 1);
  assert.equal((await leadDetail(db, l.id)).notes.length, 1);
  assert.equal(
    JSON.parse((await events(db))[0].payload).user_data.em[0],
    sha256('owner@example.com'),
  );
});
test('positive milestones dispatch once while repeated changes stay in history', async () => {
  const { db, cfg } = await fixture();
  let l = await metaLead(db, cfg);
  for (const stage of ['Qualified', 'Contacted', 'Qualified'] as const)
    l = (await changeStage(db, cfg, l.id, { stage, version: l.version }, 'Owner')).lead;
  assert.equal((await leadDetail(db, l.id)).history.length, 4);
  assert.equal((await events(db)).filter((e) => e.event_name === 'CRM_Qualified').length, 1);
  assert.equal(
    (
      (await db
        .prepare("SELECT COUNT(*) AS n FROM milestones WHERE stage='Qualified'")
        .get()) as any
    ).n,
    1,
  );
});
test('correction is audited without sending or retracting an accepted event', async () => {
  const { db, cfg } = await fixture();
  let l = await metaLead(db, cfg);
  l = (await changeStage(db, cfg, l.id, { stage: 'Qualified', version: l.version }, 'Owner')).lead;
  await deliverOne(db, cfg, okFetch());
  await deliverOne(db, cfg, okFetch());
  l = (
    await changeStage(
      db,
      cfg,
      l.id,
      { stage: 'Contacted', version: l.version, correction_reason: 'Selected the wrong stage' },
      'Owner',
    )
  ).lead;
  assert.equal((await events(db)).length, 2);
  assert.equal((await events(db))[1].status, 'accepted');
  assert.equal(
    (await leadDetail(db, l.id)).history.at(-1)?.correction_reason,
    'Selected the wrong stage',
  );
});
test('email/phone normalization and single SHA-256 hashing are correct', () => {
  assert.equal(normalizeEmail(' TEST@Example.COM  '), 'test@example.com');
  assert.equal(normalizeEmail('not-an-email'), null);
  assert.equal(normalizePhone('020 7946 0018'), '442079460018');
  assert.equal(normalizePhone('+44 (20) 7946-0018'), '442079460018');
  assert.equal(normalizePhone('0044 20 7946 0018'), '442079460018');
  assert.equal(normalizePhone('442079460018'), '442079460018');
  assert.equal(normalizePhone('+1 650-253-0000'), '16502530000');
  assert.equal(normalizePhone('16502530000'), '16502530000');
  assert.equal(normalizePhone('123'), null);
  const u = matchingIdentifiers('98765432109876543', ' TEST@Example.COM ', '020 7946 0018');
  assert.deepEqual(u, {
    lead_id: '98765432109876543',
    em: [sha256('test@example.com')],
    ph: [sha256('442079460018')],
  });
  assert.notEqual(u.em?.[0], sha256(sha256('test@example.com')));
  assert.deepEqual(matchingIdentifiers('98765432109876543', '', ''), {
    lead_id: '98765432109876543',
  });
  assert.throws(() => metaId(98765432109876543));
  assert.throws(() => metaId('9.876e16'));
});
test('retry sends the same event ID, timestamp and payload after transient failure', async () => {
  const { db, cfg } = await fixture();
  await metaLead(db, cfg);
  const captured: string[] = [];
  await deliverOne(db, cfg, (async (_u, init) => {
    captured.push(String(init?.body));
    return new Response('{"error":{"code":2,"is_transient":true}}', { status: 503 });
  }) as typeof fetch);
  const failed = (await events(db))[0];
  assert.equal(failed.status, 'pending');
  assert.equal(failed.attempts, 1);
  assert.ok(failed.last_error);
  await db.prepare('UPDATE outbox SET next_attempt_at=?').run(prior());
  await deliverOne(db, cfg, okFetch(captured));
  assert.equal(captured[0], captured[1]);
  assert.equal((await events(db))[0].status, 'accepted');
  assert.equal((await events(db))[0].event_id, failed.event_id);
  assert.equal((await events(db))[0].event_time, failed.event_time);
  assert.equal((await events(db))[0].attempts, 2);
});
test('authentication failure is visible, safe, recoverable and blocks only that lead', async () => {
  const { db, cfg } = await fixture();
  let l = await metaLead(db, cfg);
  l = (await changeStage(db, cfg, l.id, { stage: 'Qualified', version: l.version }, 'Owner')).lead;
  await metaLead(db, cfg, '98765432109876544');
  await deliverOne(
    db,
    cfg,
    (async () =>
      new Response('{"error":{"code":190,"message":"secret-token-placeholder"}}', {
        status: 400,
      })) as typeof fetch,
  );
  assert.equal((await events(db, l.id))[0].status, 'failed');
  assert.ok(!(await events(db, l.id))[0].last_error?.includes('secret-token'));
  const next = await claimEvent(db, cfg);
  assert.notEqual(next?.lead_id, l.id);
  await db
    .prepare(
      "UPDATE outbox SET status='pending',lease_until=NULL,lease_token=NULL WHERE event_id=?",
    )
    .run(next!.event_id);
  await retryEvent(db, cfg, (await events(db, l.id))[0].event_id);
  await deliverOne(db, cfg, okFetch());
  assert.equal((await events(db, l.id))[0].status, 'accepted');
});
test('per-lead milestone ordering survives retries and stale leases', async () => {
  const { db, cfg } = await fixture();
  let l = await metaLead(db, cfg);
  l = (await changeStage(db, cfg, l.id, { stage: 'Qualified', version: l.version }, 'Owner')).lead;
  const first = (await claimEvent(db, cfg))!;
  assert.equal(first.event_name, 'CRM_NewLead');
  assert.equal(await claimEvent(db, cfg), undefined);
  await db.prepare('UPDATE outbox SET lease_until=? WHERE event_id=?').run(prior(), first.event_id);
  const again = (await claimEvent(db, cfg))!;
  assert.equal(again.event_id, first.event_id);
  assert.notEqual(again.lease_token, first.lease_token);
  await db.prepare("UPDATE outbox SET status='accepted' WHERE event_id=?").run(first.event_id);
  assert.equal((await claimEvent(db, cfg))?.event_name, 'CRM_Qualified');
});
test('demo/manual/test-only leads cannot dispatch live and paused test events are never promoted', async () => {
  const { db, cfg } = await fixture();
  await createLead(db, cfg, { source: 'demo', name: 'Demo' }, 'Owner');
  await createLead(db, cfg, { source: 'manual', name: 'Manual' }, 'Owner');
  await createLead(
    db,
    cfg,
    {
      source: 'meta_instant_form',
      name: 'Test only',
      meta_lead_id: '98765432109876543',
      page_id: cfg.pageId,
      form_id: '34567890123456789',
      meta_submitted_at: prior(),
      is_test: true,
    },
    'Owner',
  );
  let calls = 0;
  await deliverOne(db, cfg, (async () => {
    calls++;
    return new Response('{}');
  }) as typeof fetch);
  assert.equal(calls, 0);
  assert.ok((await events(db)).every((e) => e.status === 'suppressed'));
  const f = await fixture('test');
  await metaLead(f.db, f.cfg);
  await saveSettings(f.db, { ...(await settings(f.db, f.cfg)), mode: 'live' });
  assert.equal(await deliverOne(f.db, f.cfg, okFetch()), false);
  assert.equal((await events(f.db))[0].mode, 'test');
});
test('test mode includes test_event_code, preserves exact string lead_id, excludes arbitrary data', async () => {
  const { db, cfg } = await fixture('test');
  await metaLead(db, cfg);
  const captured: string[] = [];
  await deliverOne(db, cfg, okFetch(captured));
  const body = JSON.parse(captured[0]);
  assert.equal(body.test_event_code, cfg.testEventCode);
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].user_data.lead_id, '98765432109876543');
  assert.equal(body.data[0].action_source, 'system_generated');
  assert.equal(body.data[0].custom_data.event_source, 'crm');
  assert.equal(body.data[0].custom_data.lead_event_source, 'WebM8 CRM');
  assert.equal(body.data[0].user_data.fbp, undefined);
  assert.equal(
    (await leadDetail(db, (await events(db))[0].lead_id)).events[0].hasOwnProperty(
      'test_event_code',
    ),
    false,
  );
});
test('old events expire without changing the timestamp and cannot be retried', async () => {
  const { db, cfg } = await fixture();
  await metaLead(db, cfg, '98765432109876543', prior(8));
  const before = (await events(db))[0];
  assert.equal(before.status, 'expired');
  assert.equal(await deliverOne(db, cfg, okFetch()), false);
  await assert.rejects(async () => await retryEvent(db, cfg, before.event_id), /Expired/);
  assert.equal((await events(db))[0].event_time, before.event_time);
});
test('queued events age into expiry; actual later stages remain eligible', async () => {
  const { db, cfg } = await fixture();
  let l = await metaLead(db, cfg);
  l = (await changeStage(db, cfg, l.id, { stage: 'Qualified', version: l.version }, 'Owner')).lead;
  const first = (await events(db))[0];
  await expireEvents(db, Date.now() + 8 * 86400000);
  assert.equal((await events(db))[0].status, 'expired');
  assert.equal((await events(db))[0].event_time, first.event_time);
});
test('retrieval outage is persisted and retried after restart with exact ID', async () => {
  const { db, cfg } = await fixture();
  await persistWebhook(
    db,
    cfg,
    Buffer.from(
      JSON.stringify({
        object: 'page',
        entry: [
          {
            id: cfg.pageId,
            changes: [
              {
                field: 'leadgen',
                value: { leadgen_id: '98765432109876543', form_id: '34567890123456789' },
              },
            ],
          },
        ],
      }),
    ),
  );
  await retrieveOne(db, cfg, (async () => {
    throw new Error('network');
  }) as typeof fetch);
  assert.equal(((await db.prepare('SELECT status FROM inbox').get()) as any).status, 'pending');
  await db.prepare('UPDATE inbox SET next_attempt_at=?').run(prior());
  await db.close();
  const again = await openDatabase(cfg.databasePath);
  dbs.push(again);
  await retrieveOne(
    again,
    cfg,
    (async () =>
      new Response(
        JSON.stringify({
          id: '98765432109876543',
          created_time: prior(),
          field_data: [{ name: 'full_name', values: ['Recovered lead'] }],
        }),
      )) as typeof fetch,
  );
  assert.equal(((await again.prepare('SELECT status FROM inbox').get()) as any).status, 'done');
  assert.equal(
    ((await again.prepare('SELECT name FROM leads').get()) as any).name,
    'Recovered lead',
  );
});
test('historical CSV preserves dates, exact IDs, skipped stages, preview validation and idempotent summary', async () => {
  const { db, cfg } = await fixture(),
    old = prior(9),
    won = prior(8),
    csv = `name,email,meta_lead_id,page_id,form_id,meta_submitted_at,received_at,current_stage,won_at,sale_gbp\nHistorical lead,h@example.com,98765432109876543,12345678901234567,34567890123456789,${old},${old},Won,${won},1234.56\nDuplicate,h@example.com,98765432109876543,12345678901234567,34567890123456789,${old},${old},Won,${won},1234.56\nBroken,,,,,,,,,\n`;
  const mapping = Object.fromEntries(
    csv
      .split('\n')[0]
      .split(',')
      .map((k) => [k, k]),
  );
  const p = await previewCSV(db, cfg, csv, mapping, 'meta_instant_form');
  assert.equal(p.valid, 1);
  assert.equal(p.duplicates, 1);
  assert.equal(p.invalid, 1);
  const summary = await importCSV(db, cfg, csv, mapping, 'meta_instant_form', 'Importer');
  assert.equal(summary.created, 1);
  assert.equal(
    (await importCSV(db, cfg, csv, mapping, 'meta_instant_form', 'Importer')).already_imported,
    true,
  );
  assert.equal((await events(db)).length, 2);
  assert.equal((await events(db))[1].event_time, Math.floor(Date.parse(won) / 1000));
  assert.equal((await events(db))[1].status, 'expired');
  const l = (await db.prepare('SELECT * FROM leads').get()) as Lead;
  assert.equal(l.sale_minor, 123456);
  assert.equal(l.meta_lead_id, '98765432109876543');
  assert.equal(l.stage, 'Won');
  assert.equal((await leadDetail(db, l.id)).history.length, 2);
});
test('CSV rejects scientific IDs and unknown historical stage times', async () => {
  const { db, cfg } = await fixture();
  const csv = 'name,received_at,current_stage\nOld,2020-01-01T00:00:00Z,Qualified\n';
  assert.equal(
    (
      await previewCSV(
        db,
        cfg,
        csv,
        { name: 'name', received_at: 'received_at', current_stage: 'current_stage' },
        'manual',
      )
    ).invalid,
    1,
  );
  assert.equal(losslessJSON.parse('{"id":98765432109876543}').id, '98765432109876543');
});
test('deletion cascades personal data and prevents duplicate re-import', async () => {
  const { db, cfg } = await fixture();
  const l = await metaLead(db, cfg);
  await addNote(db, l.id, 'Private', 'Owner');
  await deleteLead(db, l.id);
  for (const table of ['leads', 'notes', 'stage_history', 'milestones', 'outbox'])
    assert.equal(((await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()) as any).n, 0);
  await assert.rejects(async () => await metaLead(db, cfg), /deleted/);
  assert.equal(
    ((await db.prepare('SELECT id_hash FROM deleted_leads').get()) as any).id_hash,
    sha256(l.meta_lead_id!),
  );
});
test('stale edits conflict instead of overwriting a newer owner edit', async () => {
  const { db, cfg } = await fixture();
  const l = await metaLead(db, cfg);
  await changeStage(db, cfg, l.id, { stage: 'Contacted', version: l.version }, 'Owner');
  await assert.rejects(
    async () =>
      await changeStage(db, cfg, l.id, { stage: 'Qualified', version: l.version }, 'Other window'),
    /another window/,
  );
  assert.equal((await events(db)).length, 2);
});
test('London calendar ranges and UTC conversion respect DST', () => {
  const summer = londonRange('2026-07-01', '2026-07-01');
  assert.equal(summer.from, '2026-06-30T23:00:00.000Z');
  assert.equal(summer.to, '2026-07-01T23:00:00.000Z');
  assert.equal(toUTC('2026-07-01T10:00'), '2026-07-01T09:00:00.000Z');
  assert.equal(toUTC('2026-01-01T10:00'), '2026-01-01T10:00:00.000Z');
  assert.throws(() => toUTC('2026-03-29T01:30'), /daylight/);
});
test('HTTP access, CSRF, signed webhook, cohort metrics, disconnected state and secret redaction', async () => {
  const { db, cfg } = await fixture();
  let l = await metaLead(db, cfg);
  l = (await changeStage(db, cfg, l.id, { stage: 'Qualified', version: l.version }, 'Owner')).lead;
  await db.prepare('UPDATE outbox SET attempts=9').run();
  const app = createApp(db, cfg),
    server = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  const address = server.address() as { port: number },
    base = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(base + '/api/leads')).status, 401);
    assert.equal((await fetch(base + '/api/leads/export')).status, 401);
    assert.equal((await fetch(base + '/api/events')).status, 401);
    assert.equal(
      (
        await fetch(base + '/api/webhooks/meta', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-hub-signature-256': 'sha256=' + '0'.repeat(64),
          },
          body: '{}',
        })
      ).status,
      401,
    );
    const verify = await fetch(
      base +
        '/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=verify-placeholder&hub.challenge=123',
    );
    assert.equal(await verify.text(), '123');
    const response = await fetch(base + '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: cfg.appUrl },
      body: JSON.stringify({ email: cfg.ownerEmail, password: 'a-test-password-123' }),
    });
    assert.equal(response.status, 200);
    const auth = (await response.json()) as any,
      cookie = response.headers.get('set-cookie')!.split(';')[0];
    const overview = (await (
      await fetch(base + '/api/overview?data=business', { headers: { cookie } })
    ).json()) as any;
    assert.equal(overview.received, 1);
    assert.equal(overview.qualified, 1);
    assert.equal(overview.appointments, 0);
    assert.equal(overview.events.pending, 2);
    assert.equal(
      (
        await fetch(base + `/api/leads/${l.id}/notes`, {
          method: 'POST',
          headers: { cookie, origin: cfg.appUrl, 'content-type': 'application/json' },
          body: '{"text":"hello"}',
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(base + `/api/leads/${l.id}/notes`, {
          method: 'POST',
          headers: {
            cookie,
            origin: cfg.appUrl,
            'content-type': 'application/json',
            'x-csrf-token': auth.csrf_token,
          },
          body: '{"text":"hello"}',
        })
      ).status,
      201,
    );
    const config = (await (
      await fetch(base + '/api/integration', { headers: { cookie } })
    ).json()) as any;
    assert.equal(config.connected, true);
    assert.equal(JSON.stringify(config).includes('page-token-placeholder'), false);
    assert.equal(JSON.stringify(config).includes('capi-token-placeholder'), false);
    const exportData = (await (
      await fetch(base + '/api/leads/export?format=json', { headers: { cookie } })
    ).json()) as any;
    assert.equal(exportData.leads[0].lead.meta_lead_id, '98765432109876543');
    assert.equal(exportData.leads[0].events[0].test_event_code, undefined);
    const noSecrets = {
      ...cfg,
      pageToken: '',
      capiToken: '',
      appSecret: '',
      verifyToken: '',
      pageId: '',
    };
    const missingApp = createApp(db, noSecrets),
      missing = missingApp.listen(0, '127.0.0.1');
    await new Promise<void>((r) => missing.once('listening', r));
    try {
      const origin = `http://127.0.0.1:${(missing.address() as any).port}`;
      const result = (await (
        await fetch(origin + '/api/integration', { headers: { cookie } })
      ).json()) as any;
      assert.equal(result.connected, false);
      assert.equal(result.credentials.capi_token, false);
    } finally {
      await new Promise<void>((r) => missing.close(() => r()));
    }
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
test('runtime design tokens mirror the durable design contract', () => {
  const css = readFileSync('src/styles.css', 'utf8'),
    design = readFileSync('DESIGN.md', 'utf8');
  for (const hex of [
    '#173c35',
    '#f3f6f7',
    '#ffffff',
    '#172f2c',
    '#465b57',
    '#dce5e3',
    '#25634a',
    '#8b570c',
    '#a83240',
    '#f0be9b',
  ]) {
    assert.ok(design.includes(hex));
    assert.ok(css.includes(hex));
  }
});
test('an outbox write failure rolls back both the stage and its history', async () => {
  const { db, cfg } = await fixture(),
    lead = await metaLead(db, cfg);
  await db.exec(
    db.dialect === 'postgres'
      ? "CREATE FUNCTION reject_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated disk write failure'; END $$; CREATE TRIGGER reject_event BEFORE INSERT ON outbox FOR EACH ROW EXECUTE FUNCTION reject_event();"
      : "CREATE TEMP TRIGGER reject_event BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT, 'simulated disk write failure'); END",
  );
  await assert.rejects(
    async () =>
      await changeStage(db, cfg, lead.id, { stage: 'Qualified', version: lead.version }, 'Owner'),
    /simulated/,
  );
  assert.equal((await getLead(db, lead.id)).stage, 'New');
  assert.equal((await leadDetail(db, lead.id)).history.length, 1);
  assert.equal((await events(db)).length, 1);
});
test('a notification captured in test mode remains test-only after a delayed retrieval in live mode', async () => {
  const { db, cfg } = await fixture('test');
  await persistWebhook(
    db,
    cfg,
    Buffer.from(
      JSON.stringify({
        object: 'page',
        entry: [
          {
            id: cfg.pageId,
            changes: [
              {
                field: 'leadgen',
                value: { leadgen_id: '98765432109876543', form_id: '34567890123456789' },
              },
            ],
          },
        ],
      }),
    ),
  );
  await saveSettings(db, { ...(await settings(db, cfg)), mode: 'live' });
  await retrieveOne(
    db,
    cfg,
    (async () =>
      new Response(
        JSON.stringify({
          id: '98765432109876543',
          created_time: prior(),
          field_data: [{ name: 'full_name', values: ['Delayed test lead'] }],
        }),
      )) as typeof fetch,
  );
  const lead = (await db.prepare('SELECT * FROM leads').get()) as Lead;
  assert.equal(lead.is_test, 1);
  assert.equal((await events(db))[0].status, 'suppressed');
  assert.equal(await deliverOne(db, cfg, okFetch()), false);
});
test('old genuine events expire even in demo mode; synthetic demo records remain suppressed', async () => {
  const { db, cfg } = await fixture('demo');
  await metaLead(db, cfg, '98765432109876543', prior(8));
  await createLead(
    db,
    cfg,
    { source: 'demo', name: 'Old synthetic', received_at: prior(8) },
    'Demo',
  );
  assert.equal((await events(db))[0].status, 'expired');
  assert.equal((await events(db))[1].status, 'suppressed');
});
test('test code can be repaired without changing event identity or mode', async () => {
  const { db, cfg } = await fixture('test');
  await metaLead(db, cfg);
  const before = (await events(db))[0];
  await db.prepare("UPDATE outbox SET status='failed'").run();
  await retryEvent(db, { ...cfg, testEventCode: 'TEST-repaired' }, before.event_id);
  const after = (await events(db))[0];
  assert.equal(after.test_event_code, 'TEST-repaired');
  assert.equal(after.payload, before.payload);
  assert.equal(after.event_id, before.event_id);
  assert.equal(after.event_time, before.event_time);
  assert.equal(after.mode, 'test');
});
test('rotating owner access invalidates persisted sessions without relying on local deletion', async () => {
  const { db, cfg } = await fixture();
  let token = '';
  const res = {
    cookie: (_name: string, value: string) => {
      token = value;
    },
  } as unknown as Response;
  await createSession(db, cfg, res);
  const req = { cookies: { crm_session: token } } as unknown as Request;
  assert.ok(await session(db, cfg, req));
  assert.equal(
    await session(db, { ...cfg, passwordHash: hashPassword('rotated-test-password') }, req),
    undefined,
  );
  assert.equal(await session(db, { ...cfg, ownerEmail: 'different@example.com' }, req), undefined);
});

test('concurrent duplicate imports and stale stage edits remain atomic', async () => {
  const { db, cfg } = await fixture('test');
  const imported = await Promise.all([metaLead(db, cfg), metaLead(db, cfg)]);
  assert.equal(imported[0].id, imported[1].id);
  assert.equal((await events(db)).length, 1);
  const outcomes = await Promise.allSettled(
    imported.map((l) =>
      changeStage(db, cfg, l.id, { stage: 'Qualified', version: l.version }, 'Owner'),
    ),
  );
  assert.equal(outcomes.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter((x) => x.status === 'rejected').length, 1);
  assert.equal((await leadDetail(db, imported[0].id)).history.length, 2);
  assert.equal((await events(db)).length, 2);
});
test('concurrent workers claim different leads without skipping a predecessor', async () => {
  const { db, cfg } = await fixture('test');
  const first = await metaLead(db, cfg);
  await changeStage(db, cfg, first.id, { stage: 'Qualified', version: first.version }, 'Owner');
  await metaLead(db, cfg, '98765432109876544');
  const claimed = await Promise.all([
    claimEvent(db, cfg),
    claimEvent(db, cfg),
    claimEvent(db, cfg),
  ]);
  const jobs = claimed.filter(Boolean) as OutboxEvent[];
  assert.equal(jobs.length, 2);
  assert.equal(new Set(jobs.map((j) => j.event_id)).size, 2);
  assert.ok(jobs.every((j) => j.event_name === 'CRM_NewLead'));
});
test('login throttling is shared across instances and stores only a hashed client key', async () => {
  const { LoginLimitStore } = await import('../server/login-limits');
  const { db } = await fixture();
  const a = new LoginLimitStore(db),
    b = new LoginLimitStore(db);
  const hits = await Promise.all(
    Array.from({ length: 12 }, (_, i) => (i % 2 ? a : b).increment('192.0.2.1')),
  );
  assert.deepEqual(
    hits.map((x) => x.totalHits).sort((x, y) => x - y),
    Array.from({ length: 12 }, (_, i) => i + 1),
  );
  const stored = await db.prepare('SELECT * FROM login_limits').all();
  assert.equal(stored.length, 1);
  assert.equal(stored[0].key_hash, sha256('192.0.2.1'));
  await a.resetKey('192.0.2.1');
  assert.equal((await b.increment('192.0.2.1')).totalHits, 1);
});
