import { randomUUID } from 'node:crypto';
import {
  STAGES,
  type Lead,
  type Stage,
  type History,
  type OutboxEvent,
  type Note,
} from '../src/domain.js';
import { settings, type DB } from './db.js';
import type { Config } from './config.js';
import { instant, nowISO } from './time.js';
import { matchingIdentifiers, metaId, sha256 } from './matching.js';
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
    public field?: string,
  ) {
    super(message);
  }
}
export interface LeadInput {
  source: Lead['source'];
  website_submission_key?: string;
  name: string;
  email?: string;
  phone?: string;
  meta_lead_id?: string;
  page_id?: string;
  form_id?: string;
  form_name?: string;
  ad_id?: string;
  adset_id?: string;
  campaign_id?: string;
  meta_submitted_at?: string;
  received_at?: string;
  is_demo?: boolean;
  is_test?: boolean;
  form_answers?: unknown[];
  follow_up_at?: string;
  appointment_at?: string;
  sale_minor?: number;
}
const firstOnly = new Set<Stage>(['New', 'Qualified', 'Appointment Booked', 'Won']);
export async function getLead(db: DB, id: string): Promise<Lead> {
  const lead = (await db.prepare('SELECT * FROM leads WHERE id=?').get(id)) as Lead | undefined;
  if (!lead) throw new AppError('This lead could not be found.', 404);
  return lead;
}
async function recordMilestone(
  db: DB,
  cfg: Config,
  lead: Lead,
  stage: Stage,
  occurred: string,
  actor: string,
  correction?: string,
) {
  const historyId = randomUUID(),
    recorded = nowISO();
  await db
    .prepare(
      'INSERT INTO stage_history (id,lead_id,previous_stage,new_stage,occurred_at,recorded_at,changed_by,correction_reason) VALUES (?,?,?,?,?,?,?,?)',
    )
    .run(
      historyId,
      lead.id,
      lead.stage || null,
      stage,
      occurred,
      recorded,
      actor,
      correction || null,
    );
  if (correction) return;
  const first =
    (
      await db
        .prepare('INSERT INTO milestones VALUES (?,?,?,?) ON CONFLICT DO NOTHING')
        .run(lead.id, stage, historyId, occurred)
    ).changes === 1;
  if (firstOnly.has(stage) && !first) return;
  if (lead.source === 'manual') return;
  const s = await settings(db, cfg),
    eventId = randomUUID(),
    eventTime = Math.floor(Date.parse(occurred) / 1000);
  const eligible =
    lead.source === 'meta_instant_form' &&
    !lead.is_demo &&
    !!lead.meta_lead_id &&
    !!lead.page_id &&
    !!lead.form_id;
  const suppressed = !eligible || s.mode === 'demo' || (lead.is_test && s.mode === 'live');
  const data: Record<string, unknown> = {
    event_source: 'crm',
    lead_event_source: s.application_name,
  };
  if (stage === 'Won' && lead.sale_minor !== null) {
    data.value = lead.sale_minor / 100;
    data.currency = lead.currency;
  }
  const payload = {
    event_name: s.event_names[stage],
    event_time: eventTime,
    event_id: eventId,
    action_source: 'system_generated',
    user_data: eligible ? matchingIdentifiers(lead.meta_lead_id!, lead.email, lead.phone) : {},
    custom_data: data,
  };
  const expired = eventTime < Math.floor(Date.now() / 1000) - 7 * 86400;
  const status = eligible && expired ? 'expired' : suppressed ? 'suppressed' : 'pending';
  await db
    .prepare(
      'INSERT INTO outbox (event_id,lead_id,history_id,event_name,event_time,payload,mode,dataset_id,test_event_code,status,next_attempt_at,last_error,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    )
    .run(
      eventId,
      lead.id,
      historyId,
      s.event_names[stage],
      eventTime,
      JSON.stringify(payload),
      s.mode,
      s.dataset_id,
      s.mode === 'test' ? cfg.testEventCode || null : null,
      status,
      recorded,
      status === 'expired'
        ? 'Outside Meta’s seven-day upload window. The occurrence time is unchanged.'
        : suppressed
          ? 'Not sent: demo, test-only, or ineligible origin.'
          : null,
      recorded,
    );
}
export async function createLead(
  db: DB,
  cfg: Config,
  input: LeadInput,
  actor: string,
  newAt?: string,
): Promise<{ lead: Lead; duplicate: boolean }> {
  return await db
    .transaction(async () => {
      if (!input.name?.trim()) throw new AppError('Enter the lead’s name.', 400, 'name');
      if (input.website_submission_key) {
        if (input.source !== 'manual' || !/^[0-9a-f-]{36}$/i.test(input.website_submission_key))
          throw new AppError('Invalid website submission identity.');
        if (
          await db
            .prepare('SELECT 1 FROM deleted_leads WHERE id_hash=?')
            .get(sha256('website:' + input.website_submission_key))
        )
          throw new AppError(
            'This website submission was deleted and will not be re-imported.',
            410,
          );
        const existing = (await db
          .prepare('SELECT * FROM leads WHERE website_submission_key=?')
          .get(input.website_submission_key)) as Lead | undefined;
        if (existing) return { lead: existing, duplicate: true };
      }
      if (input.meta_lead_id) {
        metaId(input.meta_lead_id);
        if (
          await db
            .prepare('SELECT 1 FROM deleted_leads WHERE id_hash=?')
            .get(sha256(input.meta_lead_id))
        )
          throw new AppError('This Meta submission was deleted and will not be re-imported.');
        const existing = (await db
          .prepare('SELECT * FROM leads WHERE meta_lead_id=?')
          .get(input.meta_lead_id)) as Lead | undefined;
        if (existing) return { lead: existing, duplicate: true };
      }
      if (
        input.source === 'meta_instant_form' &&
        (!input.meta_lead_id || !input.page_id || !input.form_id || !input.meta_submitted_at)
      )
        throw new AppError(
          'Meta origin requires the original lead ID, Page ID, form ID and submission time.',
        );
      for (const id of [
        input.page_id,
        input.form_id,
        input.ad_id,
        input.adset_id,
        input.campaign_id,
      ])
        if (id) metaId(id);
      const created = nowISO(),
        received = instant(input.received_at || created),
        initial = instant(newAt || received);
      if (initial < received)
        throw new AppError('The initial New milestone cannot precede CRM receipt.');
      const lead: Lead = {
        id: randomUUID(),
        website_submission_key: input.website_submission_key || null,
        source: input.source,
        meta_lead_id: input.meta_lead_id || null,
        page_id: input.page_id || null,
        form_id: input.form_id || null,
        form_name: input.form_name || '',
        ad_id: input.ad_id || null,
        adset_id: input.adset_id || null,
        campaign_id: input.campaign_id || null,
        name: input.name.trim(),
        email: input.email?.trim() || '',
        phone: input.phone?.trim() || '',
        meta_submitted_at: input.meta_submitted_at ? instant(input.meta_submitted_at) : null,
        received_at: received,
        stage: 'New',
        appointment_at: input.appointment_at ? instant(input.appointment_at, true) : null,
        follow_up_at: input.follow_up_at ? instant(input.follow_up_at, true) : null,
        sale_minor: input.sale_minor ?? null,
        currency: 'GBP',
        reason: '',
        form_answers: JSON.stringify(input.form_answers || []),
        qualification: '[]',
        is_demo: input.source === 'demo' || input.is_demo ? 1 : 0,
        is_test: input.is_test ? 1 : 0,
        created_at: created,
        updated_at: created,
        version: 1,
      };
      const keys = Object.keys(lead);
      await db
        .prepare(`INSERT INTO leads (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
        .run(...Object.values(lead));
      await recordMilestone(
        db,
        cfg,
        { ...lead, stage: null as unknown as Stage },
        'New',
        initial,
        actor,
      );
      return { lead, duplicate: false };
    })
    .immediate();
}
export interface StageInput {
  stage: Stage;
  occurred_at?: string;
  version: number;
  reason?: string;
  correction_reason?: string;
  appointment_at?: string;
  sale_minor?: number;
}
export async function changeStage(
  db: DB,
  cfg: Config,
  id: string,
  input: StageInput,
  actor: string,
) {
  return await db
    .transaction(async () => {
      const lead = await getLead(db, id);
      if (lead.version !== input.version)
        throw new AppError('This lead changed in another window. Refresh it before saving.', 409);
      if (!STAGES.includes(input.stage)) throw new AppError('Choose a valid stage.', 400, 'stage');
      if (lead.stage === input.stage) return { changed: false, lead };
      if (['Lost', 'Unqualified'].includes(input.stage) && !input.reason?.trim())
        throw new AppError('Record a reason for this outcome.', 400, 'reason');
      const occurred = instant(input.occurred_at || nowISO());
      const latest = (await db
        .prepare(
          'SELECT MAX(occurred_at) AS time FROM stage_history WHERE lead_id=? AND correction_reason IS NULL',
        )
        .get(id)) as { time: string };
      if (occurred < lead.received_at || (latest.time && occurred < latest.time))
        throw new AppError(
          'A stage change cannot precede receipt or the latest milestone. Use CSV import for historical sequences.',
          400,
          'occurred_at',
        );
      if (input.stage === 'Won' && !Number.isSafeInteger(input.sale_minor ?? lead.sale_minor))
        throw new AppError('Record a confirmed sale value in GBP.', 400, 'sale_minor');
      if (
        input.sale_minor !== undefined &&
        (!Number.isSafeInteger(input.sale_minor) || input.sale_minor < 0)
      )
        throw new AppError(
          'Sale value must be a non-negative amount in pennies.',
          400,
          'sale_minor',
        );
      const appointment = input.appointment_at
        ? instant(input.appointment_at, true)
        : lead.appointment_at;
      if (input.stage === 'Appointment Booked' && !appointment)
        throw new AppError('Record the appointment date and time.', 400, 'appointment_at');
      const updated = {
        ...lead,
        sale_minor: input.sale_minor ?? lead.sale_minor,
        appointment_at: appointment,
      };
      await recordMilestone(
        db,
        cfg,
        updated,
        input.stage,
        occurred,
        actor,
        input.correction_reason?.trim(),
      );
      await db
        .prepare(
          'UPDATE leads SET stage=?,sale_minor=?,appointment_at=?,reason=?,updated_at=?,version=version+1 WHERE id=?',
        )
        .run(
          input.stage,
          updated.sale_minor,
          appointment,
          input.reason?.trim() || '',
          nowISO(),
          id,
        );
      return { changed: true, lead: await getLead(db, id) };
    })
    .immediate();
}
export async function editLead(
  db: DB,
  id: string,
  patch: {
    version: number;
    name: string;
    email: string;
    phone: string;
    follow_up_at: string | null;
    appointment_at: string | null;
    qualification: string[];
    sale_minor: number | null;
  },
) {
  return await db
    .transaction(async () => {
      const lead = await getLead(db, id);
      if (patch.version !== lead.version)
        throw new AppError('This lead changed in another window. Refresh it before saving.', 409);
      if (lead.stage === 'Won' && patch.sale_minor === null)
        throw new AppError(
          'Keep a confirmed sale value for a Won lead, or correct its stage first.',
          400,
          'sale_minor',
        );
      await db
        .prepare(
          'UPDATE leads SET name=?,email=?,phone=?,follow_up_at=?,appointment_at=?,qualification=?,sale_minor=?,updated_at=?,version=version+1 WHERE id=?',
        )
        .run(
          patch.name.trim(),
          patch.email.trim(),
          patch.phone.trim(),
          patch.follow_up_at ? instant(patch.follow_up_at, true) : null,
          patch.appointment_at ? instant(patch.appointment_at, true) : null,
          JSON.stringify(patch.qualification),
          patch.sale_minor,
          nowISO(),
          id,
        );
      return await getLead(db, id);
    })
    .immediate();
}
export async function addNote(db: DB, id: string, text: string, author: string) {
  await getLead(db, id);
  if (!text.trim()) throw new AppError('Write a note first.', 400, 'text');
  const note = { id: randomUUID(), lead_id: id, text: text.trim(), author, created_at: nowISO() };
  await db.prepare('INSERT INTO notes VALUES (@id,@lead_id,@text,@author,@created_at)').run(note);
  return note;
}
export async function leadDetail(db: DB, id: string) {
  return {
    lead: await getLead(db, id),
    history: (await db
      .prepare('SELECT * FROM stage_history WHERE lead_id=? ORDER BY occurred_at,seq')
      .all(id)) as History[],
    notes: (await db
      .prepare('SELECT * FROM notes WHERE lead_id=? ORDER BY created_at DESC')
      .all(id)) as Note[],
    events: (
      (await db
        .prepare('SELECT * FROM outbox WHERE lead_id=? ORDER BY event_time,seq')
        .all(id)) as OutboxEvent[]
    ).map(publicEvent),
  };
}
export async function deleteLead(db: DB, id: string) {
  await db
    .transaction(async () => {
      const lead = await getLead(db, id);
      if (await db.prepare("SELECT 1 FROM outbox WHERE lead_id=? AND status='processing'").get(id))
        throw new AppError('An event is being sent. Wait a moment and retry deletion.', 409);
      if (lead.meta_lead_id) {
        await db
          .prepare('INSERT INTO deleted_leads VALUES (?,?) ON CONFLICT DO NOTHING')
          .run(sha256(lead.meta_lead_id), nowISO());
        await db.prepare('DELETE FROM inbox WHERE meta_lead_id=?').run(lead.meta_lead_id);
      }
      await db.prepare('DELETE FROM leads WHERE id=?').run(id);
      if (lead.website_submission_key)
        await db
          .prepare('INSERT INTO deleted_leads VALUES (?,?) ON CONFLICT DO NOTHING')
          .run(sha256('website:' + lead.website_submission_key), nowISO());
    })
    .immediate();
  await db.pragma('wal_checkpoint(TRUNCATE)');
}

export function publicEvent(event: OutboxEvent) {
  const { test_event_code, lease_token, ...safe } = event;
  return safe;
}
