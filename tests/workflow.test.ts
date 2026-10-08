import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase, migrateDatabase, type DB } from '../server/db';
import { openTestPostgres } from './database-fixture';
import { getConfig } from '../server/config';
import { createLead, getLead, editLead, changeStage, deleteLead, addNote } from '../server/leads';
import {
  recordActivity,
  manageTask,
  correctActivity,
  workflowDetail,
  openTask,
} from '../server/workflow';
import { listWorkflowLeads, workflowReport } from '../server/lead-queries';
const cfg = getConfig({ META_INITIAL_MODE: 'demo' });
const past = (hours: number) => new Date(Date.now() - hours * 3600000).toISOString();
const future = () => new Date(Date.now() + 86400000).toISOString();
async function lead(db: DB, name = 'Workflow lead', demo = false) {
  return (
    await createLead(
      db,
      cfg,
      { source: demo ? 'demo' : 'manual', name, is_demo: demo, received_at: past(48) },
      'Tester',
    )
  ).lead;
}
for (const [engine, open] of [
  ['SQLite', () => openDatabase(':memory:')],
  ['PostgreSQL', () => openTestPostgres()],
] as const) {
  test(`${engine}: result and next follow-up save atomically, retries are idempotent and corrections preserve evidence`, async () => {
    const db = await open();
    try {
      let l = await lead(db);
      const scheduled = await manageTask(
        db,
        l.id,
        {
          id: randomUUID(),
          version: l.version,
          action: 'schedule',
          title: 'Call back',
          due_at: past(1),
          kind: 'call',
        },
        'Tester',
      );
      l = scheduled.lead;
      const task = (await openTask(db, l.id))!;
      const input = {
        id: randomUUID(),
        version: l.version,
        kind: 'first_call_completed',
        occurred_at: past(2),
        note: 'Owner confirmed requirements',
        complete_task_id: task.id,
        follow_up_at: future(),
        follow_up_title: 'Show the demo',
        follow_up_kind: 'demo',
      };
      const invalid = { ...input, follow_up_title: '' };
      await assert.rejects(async () => recordActivity(db, l.id, invalid, 'Tester'), /next action/);
      assert.equal((await openTask(db, l.id))!.id, task.id);
      assert.equal((await getLead(db, l.id)).version, l.version);
      const saved = await recordActivity(db, l.id, input, 'Tester');
      const result = await recordActivity(db, l.id, input, 'Tester');
      assert.equal(result.duplicate, true);
      assert.equal(result.lead.version, saved.lead.version);
      assert.equal(
        (await db.prepare('SELECT COUNT(*) AS n FROM lead_activities WHERE id=?').get(input.id)).n,
        1,
      );
      assert.equal(
        (await db.prepare('SELECT status FROM lead_tasks WHERE id=?').get(task.id)).status,
        'completed',
      );
      assert.equal((await openTask(db, l.id))!.title, 'Show the demo');
      assert.equal((await getLead(db, l.id)).stage, 'New');
      assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM outbox').get()).n, 0);
      await assert.rejects(
        async () => recordActivity(db, l.id, { ...input, note: 'Changed retry' }, 'Tester'),
        /already used/,
      );
      await assert.rejects(
        async () =>
          manageTask(
            db,
            l.id,
            {
              id: randomUUID(),
              version: l.version,
              action: 'cancel',
              task_id: (await openTask(db, l.id))!.id,
            },
            'Tester',
          ),
        /another window/,
      );
      let detail = await workflowDetail(db, l.id);
      assert.equal(detail.milestones[0].kind, 'first_call_completed');
      l = (
        await correctActivity(
          db,
          l.id,
          input.id,
          {
            id: randomUUID(),
            version: saved.lead.version,
            reason: 'This was only an introductory connection',
          },
          'Tester',
        )
      ).lead;
      detail = await workflowDetail(db, l.id);
      assert.equal(detail.milestones.length, 0);
      assert.equal(detail.last_contact_at, null);
      assert.ok(detail.timeline.find((x) => x.id === input.id)?.voided_at);
      assert.equal((await openTask(db, l.id))!.title, 'Show the demo');
      await assert.rejects(
        async () =>
          recordActivity(
            db,
            l.id,
            { id: randomUUID(), version: l.version, kind: 'demo_booked', occurred_at: past(1) },
            'Tester',
          ),
        /ISO/,
      );
      await assert.rejects(async () =>
        recordActivity(
          db,
          l.id,
          {
            id: randomUUID(),
            version: l.version,
            kind: 'no_answer',
            occurred_at: past(1),
            follow_up_at: '',
          },
          'Tester',
        ),
      );
    } finally {
      await db.close();
    }
  });
  test(`${engine}: follow-up completion, rescheduling and closed outcomes do not invent contact or leave reminders active`, async () => {
    const db = await open();
    try {
      let l = await lead(db);
      l = await editLead(
        db,
        l.id,
        {
          version: l.version,
          name: l.name,
          email: '',
          phone: '',
          follow_up_at: future(),
          appointment_at: null,
          qualification: [],
          sale_minor: null,
        },
        'Tester',
      );
      let task = (await openTask(db, l.id))!;
      l = (
        await manageTask(
          db,
          l.id,
          {
            id: randomUUID(),
            version: l.version,
            action: 'reschedule',
            task_id: task.id,
            title: 'Send the agreed proposal',
            kind: 'proposal',
            due_at: future(),
          },
          'Tester',
        )
      ).lead;
      let detail = await workflowDetail(db, l.id);
      assert.equal(detail.timeline.filter((e) => e.kind === 'follow_up_rescheduled').length, 1);
      l = (
        await manageTask(
          db,
          l.id,
          { id: randomUUID(), version: l.version, action: 'complete', task_id: task.id },
          'Tester',
        )
      ).lead;
      assert.equal(l.follow_up_at, null);
      assert.equal((await workflowDetail(db, l.id)).last_contact_at, null);
      l = (
        await manageTask(
          db,
          l.id,
          {
            id: randomUUID(),
            version: l.version,
            action: 'schedule',
            title: 'Check proposal',
            kind: 'call',
            due_at: future(),
          },
          'Tester',
        )
      ).lead;
      task = (await openTask(db, l.id))!;
      l = (
        await changeStage(
          db,
          cfg,
          l.id,
          { version: l.version, stage: 'Lost', reason: 'No budget' },
          'Tester',
        )
      ).lead;
      assert.equal(l.follow_up_at, null);
      assert.equal(await openTask(db, l.id), null);
      assert.equal(
        (await db.prepare('SELECT status FROM lead_tasks WHERE id=?').get(task.id)).status,
        'cancelled',
      );
      await assert.rejects(
        async () =>
          manageTask(
            db,
            l.id,
            {
              id: randomUUID(),
              version: l.version,
              action: 'schedule',
              title: 'Call',
              due_at: future(),
            },
            'Tester',
          ),
        /Reopen/,
      );
      await assert.rejects(
        () =>
          editLead(
            db,
            l.id,
            {
              version: l.version,
              name: l.name,
              email: '',
              phone: '',
              follow_up_at: future(),
              appointment_at: null,
              qualification: [],
              sale_minor: null,
            },
            'Tester',
          ),
        /Reopen/,
      );
      await deleteLead(db, l.id);
      assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM lead_tasks').get()).n, 0);
      assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM lead_activities').get()).n, 0);
    } finally {
      await db.close();
    }
  });
  test(`${engine}: pipeline counts include every match, lists paginate, overdue work crosses receipt dates and reports use actual calls`, async () => {
    const db = await open();
    try {
      for (let i = 0; i < 22; i++) await lead(db, `Queue ${String(i).padStart(2, '0')}`);
      const synthetic = await lead(db, 'Synthetic hidden', true);
      let overdue = await lead(db, 'Old overdue');
      await db.prepare('UPDATE leads SET received_at=? WHERE id=?').run(past(24 * 90), overdue.id);
      overdue = (
        await manageTask(
          db,
          overdue.id,
          {
            id: randomUUID(),
            version: overdue.version,
            action: 'schedule',
            title: 'Agreed callback',
            kind: 'call',
            due_at: past(2),
          },
          'Tester',
        )
      ).lead;
      await addNote(db, overdue.id, 'An admin note is not contact', 'Tester');
      const board = await listWorkflowLeads(
        db,
        { view: 'pipeline', sort: 'priority' },
        "'ineligible'",
      );
      assert.equal(board.total, 23);
      assert.equal(board.columns[0].rows.length, 8);
      assert.equal(board.columns[0].total, 23);
      assert.equal(board.columns[0].rows[0].id, overdue.id);
      assert.ok(!board.columns[0].rows.some((x) => x.id === synthetic.id));
      const filtered = await listWorkflowLeads(db, { work: 'overdue' }, "'ineligible'");
      assert.equal(filtered.total, 1);
      assert.equal(filtered.rows[0].id, overdue.id);
      const last = await listWorkflowLeads(db, { page: '999' }, "'ineligible'");
      assert.equal(last.page, 2);
      assert.equal(last.rows.length, 3);
      assert.equal((await listWorkflowLeads(db, { work: 'missing' }, "'ineligible'")).total, 22);
      assert.equal((await listWorkflowLeads(db, { q: '%_' }, "'ineligible'")).total, 0);
      await recordActivity(
        db,
        overdue.id,
        { id: randomUUID(), version: overdue.version, kind: 'no_answer', occurred_at: past(1) },
        'Tester',
      );
      const report = await workflowReport(db, false, { from: '0000', to: '9999' });
      assert.equal(report.attempted, 1);
      assert.equal(report.overdue, 1);
      assert.equal(report.missing, 22);
      assert.ok(report.median_first_attempt_seconds! > 80 * 86400);
      const updated = await listWorkflowLeads(db, { q: 'Old overdue' }, "'ineligible'");
      assert.equal(updated.rows[0].last_activity_kind, 'no_answer');
      assert.equal(updated.rows[0].last_contact_at, null);
    } finally {
      await db.close();
    }
  });
  test(`${engine}: rescheduled demo uses the latest booking and correction restores the prior evidence`, async () => {
    const db = await open();
    try {
      let l = await lead(db);
      const laterDate = new Date(Date.now() + 3 * 86400000).toISOString(),
        earlierDate = future();
      l = (
        await recordActivity(
          db,
          l.id,
          {
            id: randomUUID(),
            version: l.version,
            kind: 'demo_booked',
            occurred_at: past(2),
            scheduled_for: laterDate,
          },
          'Tester',
        )
      ).lead;
      const revised = randomUUID();
      l = (
        await recordActivity(
          db,
          l.id,
          {
            id: revised,
            version: l.version,
            kind: 'demo_booked',
            occurred_at: past(1),
            scheduled_for: earlierDate,
          },
          'Tester',
        )
      ).lead;
      assert.equal((await workflowDetail(db, l.id)).milestones[0].scheduled_for, earlierDate);
      await correctActivity(
        db,
        l.id,
        revised,
        { id: randomUUID(), version: l.version, reason: 'Wrong proposed date' },
        'Tester',
      );
      assert.equal((await workflowDetail(db, l.id)).milestones[0].scheduled_for, laterDate);
    } finally {
      await db.close();
    }
  });
  test(`${engine}: activity history pages correctly and does not leak another lead's tasks`, async () => {
    const db = await open();
    try {
      const a = await lead(db, 'A'),
        b = await lead(db, 'B');
      await manageTask(
        db,
        b.id,
        {
          id: randomUUID(),
          version: b.version,
          action: 'schedule',
          title: 'Private B task',
          due_at: future(),
        },
        'Tester',
      );
      await assert.rejects(
        async () =>
          recordActivity(
            db,
            a.id,
            {
              id: randomUUID(),
              version: a.version,
              kind: 'connected',
              occurred_at: past(1),
              complete_task_id: (await openTask(db, b.id))!.id,
            },
            'Tester',
          ),
        /already changed/,
      );
      for (let i = 0; i < 35; i++) await addNote(db, a.id, `History ${i}`, 'Tester');
      const first = await workflowDetail(db, a.id),
        second = await workflowDetail(db, a.id, 2);
      assert.equal(first.total, 36);
      assert.equal(first.timeline.length, 30);
      assert.equal(second.timeline.length, 6);
      assert.equal(new Set([...first.timeline, ...second.timeline].map((x) => x.id)).size, 36);
      assert.ok(!first.timeline.some((x) => x.note.includes('Private')));
    } finally {
      await db.close();
    }
  });
  test(`${engine}: upgrade preserves legacy follow-up dates with explicit migration provenance`, async () => {
    const db = await open();
    try {
      const l = await lead(db);
      const closed = await lead(db, 'Closed legacy lead');
      const due = past(4);
      await db.exec('DROP TABLE lead_activities; DROP TABLE lead_tasks;');
      await db.prepare("DELETE FROM migrations WHERE name='009_lead_workflow.sql'").run();
      await db.prepare('UPDATE leads SET follow_up_at=? WHERE id=?').run(due, l.id);
      await db
        .prepare("UPDATE leads SET stage='Lost',follow_up_at=? WHERE id=?")
        .run(due, closed.id);
      await migrateDatabase(db);
      await migrateDatabase(db);
      const task = await openTask(db, l.id);
      assert.equal(task?.due_at, due);
      const detail = await workflowDetail(db, l.id);
      assert.ok(
        detail.timeline.some((x) => x.actor === 'Migration' && x.note.includes('not recorded')),
      );
      assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM lead_tasks').get()).n, 2);
      assert.equal(await openTask(db, closed.id), null);
      assert.equal((await getLead(db, closed.id)).follow_up_at, null);
      assert.equal(
        (await db.prepare('SELECT due_at FROM lead_tasks WHERE lead_id=?').get(closed.id)).due_at,
        due,
      );
    } finally {
      await db.close();
    }
  });
}
