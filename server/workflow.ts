import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { DB } from './db.js';
import { AppError, getLead } from './leads.js';
import { instant, nowISO } from './time.js';
import { sha256 } from './matching.js';
import type { Lead } from '../src/domain.js';
import {
  ACTIVITY_KINDS,
  TASK_KINDS,
  isClosed,
  type FollowUp,
  type WorkflowDetail,
} from '../src/workflow.js';

const operation = { id: z.uuid(), version: z.number().int().positive() };
export const activitySchema = z
  .object({
    ...operation,
    kind: z.enum(ACTIVITY_KINDS),
    note: z.string().trim().max(5000).default(''),
    occurred_at: z.string().max(60),
    scheduled_for: z.string().max(60).optional(),
    complete_task_id: z.string().max(120).optional(),
    follow_up_at: z.string().min(1, 'Enter the follow-up date.').max(60).optional(),
    follow_up_title: z.string().trim().max(200).optional(),
    follow_up_kind: z.enum(TASK_KINDS).optional(),
  })
  .strict();
export const taskSchema = z
  .object({
    ...operation,
    action: z.enum(['schedule', 'reschedule', 'complete', 'cancel']),
    task_id: z.string().max(120).optional(),
    title: z.string().trim().max(200).optional(),
    kind: z.enum(TASK_KINDS).optional(),
    due_at: z.string().max(60).optional(),
  })
  .strict();
export const correctionSchema = z
  .object({ ...operation, reason: z.string().trim().min(1).max(500) })
  .strict();
export const CALL_KINDS_SQL =
  "'call_attempt','no_answer','voicemail','connected','wrong_number','first_call_completed'";
export const CONTACT_KINDS_SQL =
  "'connected','first_call_completed','demo_held','proposal_accepted'";
export const ACTIVITY_KINDS_SQL = ACTIVITY_KINDS.map((kind) => `'${kind}'`).join(',');
export const workflowSelect = `
  (SELECT id FROM lead_tasks t WHERE t.lead_id=l.id AND t.status='open') AS next_task_id,
  (SELECT title FROM lead_tasks t WHERE t.lead_id=l.id AND t.status='open') AS next_task_title,
  (SELECT MAX(a.occurred_at) FROM lead_activities a WHERE a.lead_id=l.id AND a.voided_at IS NULL AND a.kind IN (${ACTIVITY_KINDS_SQL})) AS last_activity_at,
  (SELECT a.kind FROM lead_activities a WHERE a.lead_id=l.id AND a.voided_at IS NULL AND a.kind IN (${ACTIVITY_KINDS_SQL}) ORDER BY a.occurred_at DESC,a.recorded_at DESC,a.id LIMIT 1) AS last_activity_kind,
  (SELECT MAX(a.occurred_at) FROM lead_activities a WHERE a.lead_id=l.id AND a.voided_at IS NULL AND a.kind IN (${CONTACT_KINDS_SQL})) AS last_contact_at,
  COALESCE((SELECT h.occurred_at FROM stage_history h WHERE h.lead_id=l.id ORDER BY h.seq DESC LIMIT 1),l.received_at) AS stage_entered_at`;

function timestamp(value: string, field: string, future = false) {
  try {
    return instant(value, future);
  } catch (e) {
    throw new AppError((e as Error).message, 400, field);
  }
}
export async function openTask(db: DB, leadId: string): Promise<FollowUp | null> {
  return (
    (await db.prepare("SELECT * FROM lead_tasks WHERE lead_id=? AND status='open'").get(leadId)) ||
    null
  );
}
async function activity(
  db: DB,
  data: {
    id?: string;
    lead_id: string;
    kind: string;
    note?: string;
    occurred_at?: string;
    actor: string;
    scheduled_for?: string | null;
    previous_due_at?: string | null;
    task_id?: string | null;
    request_hash?: string | null;
  },
) {
  const row = {
    id: data.id || randomUUID(),
    lead_id: data.lead_id,
    kind: data.kind,
    note: data.note || '',
    occurred_at: data.occurred_at || nowISO(),
    recorded_at: nowISO(),
    actor: data.actor,
    scheduled_for: data.scheduled_for || null,
    previous_due_at: data.previous_due_at || null,
    task_id: data.task_id || null,
    request_hash: data.request_hash || null,
  };
  await db
    .prepare(
      `INSERT INTO lead_activities (${Object.keys(row).join(',')}) VALUES (${Object.keys(row)
        .map(() => '?')
        .join(',')})`,
    )
    .run(...Object.values(row));
  return row;
}
async function checkMutation(
  db: DB,
  leadId: string,
  input: { id: string; version: number },
  action: string,
) {
  const hash = sha256(JSON.stringify({ action, ...input }));
  const prior = await db
    .prepare('SELECT lead_id,request_hash FROM lead_activities WHERE id=?')
    .get(input.id);
  if (prior) {
    if (prior.lead_id !== leadId || prior.request_hash !== hash)
      throw new AppError(
        'This save identifier was already used. Reopen the form and try again.',
        409,
      );
    return { duplicate: true, hash, lead: await getLead(db, leadId) };
  }
  const lead = await getLead(db, leadId);
  if (lead.version !== input.version)
    throw new AppError(
      'This lead changed in another window. Close this form and refresh before saving.',
      409,
    );
  return { duplicate: false, hash, lead };
}
async function touch(db: DB, leadId: string) {
  const task = await openTask(db, leadId);
  await db
    .prepare('UPDATE leads SET follow_up_at=?,updated_at=?,version=version+1 WHERE id=?')
    .run(task?.due_at || null, nowISO(), leadId);
}
async function setTask(
  db: DB,
  lead: Lead,
  input: { title: string; kind: FollowUp['kind']; due_at: string },
  actor: string,
  event?: { id: string; request_hash: string },
) {
  if (isClosed(lead))
    throw new AppError('Reopen this lead before scheduling sales follow-up.', 400);
  if (!input.title.trim()) throw new AppError('Describe the next action.', 400, 'title');
  const due = timestamp(input.due_at, 'due_at', true),
    current = await openTask(db, lead.id),
    now = nowISO();
  const taskId = current?.id || randomUUID();
  if (current)
    await db
      .prepare('UPDATE lead_tasks SET title=?,kind=?,due_at=?,updated_at=? WHERE id=?')
      .run(input.title.trim(), input.kind, due, now, taskId);
  else
    await db
      .prepare(
        "INSERT INTO lead_tasks (id,lead_id,title,kind,due_at,status,created_at,updated_at) VALUES (?,?,?,?,?,'open',?,?)",
      )
      .run(taskId, lead.id, input.title.trim(), input.kind, due, now, now);
  await activity(db, {
    ...event,
    lead_id: lead.id,
    kind: current ? 'follow_up_rescheduled' : 'follow_up_scheduled',
    actor,
    note: input.title.trim(),
    scheduled_for: due,
    previous_due_at: current?.due_at,
    task_id: taskId,
  });
}
async function closeTask(
  db: DB,
  leadId: string,
  taskId: string,
  status: 'completed' | 'cancelled',
  actor: string,
  event?: { id: string; request_hash: string },
  note?: string,
) {
  const current = await openTask(db, leadId);
  if (!current || current.id !== taskId)
    throw new AppError('This follow-up has already changed. Refresh the lead.', 409);
  const now = nowISO(),
    column = status === 'completed' ? 'completed_at' : 'cancelled_at';
  await db
    .prepare(`UPDATE lead_tasks SET status=?,${column}=?,updated_at=? WHERE id=?`)
    .run(status, now, now, taskId);
  await activity(db, {
    ...event,
    lead_id: leadId,
    kind: `follow_up_${status}`,
    actor,
    note: note || current.title,
    scheduled_for: current.due_at,
    task_id: taskId,
  });
}
export async function recordActivity(db: DB, leadId: string, raw: unknown, actor: string) {
  const input = activitySchema.parse(raw);
  return db
    .transaction(async () => {
      const checked = await checkMutation(db, leadId, input, 'activity');
      if (checked.duplicate) return checked;
      const occurred = timestamp(input.occurred_at, 'occurred_at');
      if (occurred < checked.lead.received_at)
        throw new AppError('An activity cannot precede this lead’s receipt.', 400, 'occurred_at');
      const scheduled =
        input.kind === 'demo_booked'
          ? timestamp(input.scheduled_for || '', 'scheduled_for', true)
          : null;
      if (scheduled && scheduled < occurred)
        throw new AppError('The demo must be scheduled after it was booked.', 400, 'scheduled_for');
      if (input.complete_task_id)
        await closeTask(db, leadId, input.complete_task_id, 'completed', actor);
      if (input.follow_up_at) {
        if (!input.follow_up_title?.trim())
          throw new AppError('Describe the next action.', 400, 'follow_up_title');
        // Validate here so the existing form can focus its own follow-up field.
        const due = timestamp(input.follow_up_at, 'follow_up_at', true);
        await setTask(
          db,
          checked.lead,
          { title: input.follow_up_title, kind: input.follow_up_kind || 'call', due_at: due },
          actor,
        );
      }
      await activity(db, {
        id: input.id,
        lead_id: leadId,
        kind: input.kind,
        note: input.note,
        occurred_at: occurred,
        actor,
        scheduled_for: scheduled,
        request_hash: checked.hash,
      });
      await touch(db, leadId);
      return { duplicate: false, lead: await getLead(db, leadId) };
    })
    .immediate();
}
export async function manageTask(db: DB, leadId: string, raw: unknown, actor: string) {
  const input = taskSchema.parse(raw);
  return db
    .transaction(async () => {
      const checked = await checkMutation(db, leadId, input, 'task');
      if (checked.duplicate) return checked;
      const current = await openTask(db, leadId),
        event = { id: input.id, request_hash: checked.hash };
      if (input.action === 'schedule' || input.action === 'reschedule') {
        if (
          (input.action === 'schedule' && current) ||
          (input.action === 'reschedule' && (!current || current.id !== input.task_id))
        )
          throw new AppError('The next follow-up changed. Refresh the lead.', 409);
        await setTask(
          db,
          checked.lead,
          { title: input.title || '', kind: input.kind || 'call', due_at: input.due_at || '' },
          actor,
          event,
        );
      } else
        await closeTask(
          db,
          leadId,
          input.task_id || '',
          input.action === 'complete' ? 'completed' : 'cancelled',
          actor,
          event,
        );
      await touch(db, leadId);
      return { duplicate: false, lead: await getLead(db, leadId) };
    })
    .immediate();
}
export async function correctActivity(
  db: DB,
  leadId: string,
  activityId: string,
  raw: unknown,
  actor: string,
) {
  const input = correctionSchema.parse(raw);
  return db
    .transaction(async () => {
      const checked = await checkMutation(db, leadId, input, `correct:${activityId}`);
      if (checked.duplicate) return checked;
      const entry = await db
        .prepare('SELECT * FROM lead_activities WHERE id=? AND lead_id=?')
        .get(activityId, leadId);
      if (!entry || !ACTIVITY_KINDS.includes(entry.kind) || entry.voided_at)
        throw new AppError('This activity cannot be corrected. Refresh the lead.', 409);
      await db
        .prepare('UPDATE lead_activities SET voided_at=?,void_reason=? WHERE id=?')
        .run(nowISO(), input.reason, activityId);
      await activity(db, {
        id: input.id,
        lead_id: leadId,
        kind: 'activity_corrected',
        actor,
        note: input.reason,
        request_hash: checked.hash,
      });
      await touch(db, leadId);
      return { duplicate: false, lead: await getLead(db, leadId) };
    })
    .immediate();
}
// All old intake/edit/import paths still write the same follow-up lifecycle.
// Called inside the lead transaction; the caller owns the version increment.
export async function syncLegacyFollowUp(db: DB, lead: Lead, dueAt: string | null, actor: string) {
  const current = await openTask(db, lead.id);
  if (current?.due_at === dueAt || (!current && !dueAt)) return;
  if (dueAt && !isClosed(lead))
    await setTask(
      db,
      lead,
      { title: current?.title || 'Follow up', kind: current?.kind || 'call', due_at: dueAt },
      actor,
    );
  else if (current) await closeTask(db, lead.id, current.id, 'cancelled', actor);
}
export async function closeSalesFollowUp(db: DB, leadId: string, actor: string) {
  const current = await openTask(db, leadId);
  if (current)
    await closeTask(
      db,
      leadId,
      current.id,
      'cancelled',
      actor,
      undefined,
      `Sales follow-up cancelled when the lead was closed: ${current.title}`,
    );
  await db.prepare('UPDATE leads SET follow_up_at=NULL WHERE id=?').run(leadId);
}
export async function workflowDetail(
  db: DB,
  leadId: string,
  requestedPage = 1,
): Promise<WorkflowDetail> {
  const union = `SELECT id,'activity' AS category,kind,occurred_at,recorded_at,actor,note,scheduled_for,previous_due_at,voided_at,void_reason,NULL AS previous_stage,NULL AS correction_reason FROM lead_activities WHERE lead_id=?
    UNION ALL SELECT id,'note','note',created_at,created_at,author,text,NULL,NULL,NULL,NULL,NULL,NULL FROM notes WHERE lead_id=?
    UNION ALL SELECT id,'stage',new_stage,occurred_at,recorded_at,changed_by,'',NULL,NULL,NULL,NULL,previous_stage,correction_reason FROM stage_history WHERE lead_id=?`;
  const total = (
    await db.prepare(`SELECT COUNT(*) AS n FROM (${union}) entries`).get(leadId, leadId, leadId)
  ).n;
  const page = Math.min(
    Math.max(1, Math.floor(requestedPage) || 1),
    Math.max(1, Math.ceil(total / 30)),
  );
  const timeline = await db
    .prepare(
      `SELECT * FROM (${union}) entries ORDER BY occurred_at DESC,recorded_at DESC,id DESC LIMIT 30 OFFSET ?`,
    )
    .all(leadId, leadId, leadId, (page - 1) * 30);
  const milestones = await db
    .prepare(
      `SELECT a.kind,a.occurred_at,a.scheduled_for FROM lead_activities a WHERE a.lead_id=? AND a.voided_at IS NULL AND a.kind IN ('first_call_completed','demo_booked','demo_held','proposal_sent','proposal_accepted') AND NOT EXISTS (SELECT 1 FROM lead_activities newer WHERE newer.lead_id=a.lead_id AND newer.kind=a.kind AND newer.voided_at IS NULL AND (newer.occurred_at>a.occurred_at OR (newer.occurred_at=a.occurred_at AND newer.recorded_at>a.recorded_at) OR (newer.occurred_at=a.occurred_at AND newer.recorded_at=a.recorded_at AND newer.id>a.id)))`,
    )
    .all(leadId);
  const hasActivity = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM lead_activities WHERE lead_id=? AND voided_at IS NULL AND kind IN (${ACTIVITY_KINDS_SQL})`,
    )
    .get(leadId);
  const contact = await db
    .prepare(
      `SELECT MAX(occurred_at) AS time FROM lead_activities WHERE lead_id=? AND voided_at IS NULL AND kind IN (${CONTACT_KINDS_SQL})`,
    )
    .get(leadId);
  return {
    task: await openTask(db, leadId),
    milestones,
    timeline,
    total,
    page,
    page_size: 30,
    last_contact_at: contact.time,
    has_activity: hasActivity.n > 0,
  };
}
