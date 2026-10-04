import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, settings } from '../server/db';
import { getConfig } from '../server/config';
import { createLead, changeStage, addNote, leadDetail } from '../server/leads';
import { transferSqliteToPostgres } from '../server/database-transfer';
import { openTestPostgres } from './database-fixture';

test('SQLite transfer preserves personal data, exact IDs, history, test mode and accepted event identity', async () => {
  const source = await openDatabase(':memory:'),
    target = await openTestPostgres();
  const cfg = getConfig({ META_INITIAL_MODE: 'test' });
  try {
    let lead = (
      await createLead(
        source,
        cfg,
        {
          source: 'meta_instant_form',
          name: 'Synthetic migration test',
          email: 'migration@example.com',
          meta_lead_id: '98765432109876543',
          page_id: '12345678901234567',
          form_id: '34567890123456789',
          meta_submitted_at: new Date().toISOString(),
          is_test: true,
        },
        'Tester',
      )
    ).lead;
    lead = (
      await changeStage(
        source,
        cfg,
        lead.id,
        { stage: 'Qualified', version: lead.version },
        'Tester',
      )
    ).lead;
    await addNote(source, lead.id, 'Synthetic transfer note', 'Tester');
    await source
      .prepare(
        "UPDATE outbox SET status='accepted',attempts=2,accepted_at=?,response_trace_id='migration-trace'",
      )
      .run(new Date().toISOString());
    await source
      .prepare("INSERT INTO settings VALUES ('integration',?)")
      .run(JSON.stringify(await settings(source, cfg)));
    const before = await leadDetail(source, lead.id);
    const copied = await transferSqliteToPostgres(source, target);
    assert.equal(copied.counts.leads, 1);
    assert.deepEqual(await leadDetail(target, lead.id), before);
    assert.equal((await settings(target, cfg)).mode, 'test');
    assert.equal((await transferSqliteToPostgres(source, target)).already_migrated, true);
    const next = (
      await createLead(target, cfg, { source: 'manual', name: 'Synthetic next lead' }, 'Tester')
    ).lead;
    assert.ok((await leadDetail(target, next.id)).history[0].seq > before.history.at(-1)!.seq);
    assert.equal((await leadDetail(target, lead.id)).lead.meta_lead_id, '98765432109876543');
  } finally {
    await source.close();
    await target.close();
  }
});
test('transfer refuses a non-empty destination and rolls back all copied source data', async () => {
  const source = await openDatabase(':memory:'),
    target = await openTestPostgres();
  const cfg = getConfig({});
  try {
    await createLead(source, cfg, { source: 'manual', name: 'Synthetic source' }, 'Tester');
    const existing = (
      await createLead(target, cfg, { source: 'manual', name: 'Synthetic destination' }, 'Tester')
    ).lead;
    await assert.rejects(() => transferSqliteToPostgres(source, target), /empty/);
    assert.equal((await target.prepare('SELECT COUNT(*) AS n FROM leads').get()).n, 1);
    assert.equal((await leadDetail(target, existing.id)).lead.name, 'Synthetic destination');
    assert.equal((await source.prepare('SELECT COUNT(*) AS n FROM leads').get()).n, 1);
  } finally {
    await source.close();
    await target.close();
  }
});
