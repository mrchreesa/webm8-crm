import { randomUUID } from 'node:crypto';
import type { OutboxEvent } from '../src/domain.js';
import type { DB } from './db.js';
import { settings } from './db.js';
import type { Config } from './config.js';
import { backoffMs, graphRequest, MetaError } from './meta.js';
import { AppError } from './leads.js';
export async function expireEvents(db: DB, now = Date.now()) {
  await db
    .prepare(
      "UPDATE outbox SET status='expired',lease_until=NULL,lease_token=NULL,last_error='Outside Meta’s seven-day upload window. The occurrence time is unchanged.' WHERE status IN ('pending','failed','suppressed') AND lead_id IN (SELECT id FROM leads WHERE source='meta_instant_form' AND is_demo=0) AND event_time<?",
    )
    .run(Math.floor(now / 1000) - 7 * 86400);
}
export async function claimEvent(
  db: DB,
  cfg: Config,
  now = Date.now(),
): Promise<OutboxEvent | undefined> {
  return await db
    .transaction(async () => {
      const iso = new Date(now).toISOString(),
        mode = (await settings(db, cfg)).mode;
      await db
        .prepare(
          "UPDATE outbox SET status='pending',lease_until=NULL,lease_token=NULL WHERE status='processing' AND lease_until<=?",
        )
        .run(iso);
      await expireEvents(db, now);
      if (mode === 'demo' || (mode === 'live' && !cfg.allowLive)) return;
      const event = (await db
        .prepare(
          `SELECT o.* FROM outbox o JOIN leads l ON l.id=o.lead_id
      WHERE o.status='pending' AND o.next_attempt_at<=? AND o.mode=?
      AND l.source='meta_instant_form' AND l.is_demo=0 AND (o.mode='test' OR l.is_test=0)
      AND NOT EXISTS (SELECT 1 FROM outbox p WHERE p.lead_id=o.lead_id
        AND (p.event_time<o.event_time OR (p.event_time=o.event_time AND p.seq<o.seq))
        AND p.status IN ('pending','processing','failed'))
      ORDER BY o.event_time,o.seq LIMIT 1`,
        )
        .get(iso, mode)) as OutboxEvent | undefined;
      if (!event) return;
      const token = randomUUID();
      await db
        .prepare(
          "UPDATE outbox SET status='processing',attempts=attempts+1,lease_until=?,lease_token=? WHERE event_id=?",
        )
        .run(new Date(now + 60000).toISOString(), token, event.event_id);
      return { ...event, attempts: event.attempts + 1, lease_token: token };
    })
    .immediate();
}
export async function deliverOne(
  db: DB,
  cfg: Config,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const event = await claimEvent(db, cfg);
  if (!event) return false;
  try {
    if (!cfg.capiToken || !event.dataset_id)
      throw new MetaError(
        false,
        'CAPI is disconnected. Configure the dataset ID and CAPI token, restart both services, then retry.',
      );
    if (event.mode === 'test' && !event.test_event_code)
      throw new MetaError(
        false,
        'Meta test mode needs META_TEST_EVENT_CODE. Set it, restart both services, then retry.',
      );
    const body: Record<string, unknown> = { data: [JSON.parse(event.payload)] };
    if (event.mode === 'test') body.test_event_code = event.test_event_code;
    const result = await graphRequest(
      cfg,
      `${event.dataset_id}/events`,
      cfg.capiToken,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      fetcher,
    );
    if (Number(result.events_received) !== 1)
      throw new MetaError(
        true,
        'Meta did not confirm acceptance of this event. Retrying with the same event ID.',
      );
    await db
      .prepare(
        "UPDATE outbox SET status='accepted',accepted_at=?,response_trace_id=?,response_messages=?,last_error=NULL,lease_token=NULL,lease_until=NULL WHERE event_id=? AND lease_token=?",
      )
      .run(
        new Date().toISOString(),
        typeof result.fbtrace_id === 'string' ? result.fbtrace_id.slice(0, 200) : null,
        Array.isArray(result.messages)
          ? `${result.messages.length} API message(s); inspect Events Manager for diagnostics.`
          : null,
        event.event_id,
        event.lease_token,
      );
  } catch (error) {
    const e =
      error instanceof MetaError
        ? error
        : new MetaError(false, 'Saved event could not be read. Inspect the sync log.');
    await db
      .prepare(
        'UPDATE outbox SET status=?,next_attempt_at=?,last_error=?,response_trace_id=?,lease_token=NULL,lease_until=NULL WHERE event_id=? AND lease_token=?',
      )
      .run(
        e.temporary ? 'pending' : 'failed',
        new Date(Date.now() + backoffMs(event.attempts)).toISOString(),
        e.safeMessage,
        e.trace || null,
        event.event_id,
        event.lease_token,
      );
    await expireEvents(db);
  }
  return true;
}
export async function retryEvent(db: DB, cfg: Config, id: string) {
  return await db
    .transaction(async () => {
      await expireEvents(db);
      const event = (await db.prepare('SELECT * FROM outbox WHERE event_id=?').get(id)) as
        OutboxEvent | undefined;
      if (!event) throw new AppError('Event not found.', 404);
      if (!['failed', 'pending'].includes(event.status))
        throw new AppError(
          'Only pending or failed events can be retried. Expired events retain their real occurrence time.',
        );
      const s = await settings(db, cfg);
      if (event.mode !== s.mode)
        throw new AppError(
          `Switch back to ${event.mode} mode to retry this event. Its mode cannot be changed.`,
        );
      if (!s.dataset_id || !cfg.capiToken)
        throw new AppError('Configure the dataset and CAPI token before retrying.');
      if (event.mode === 'test' && !cfg.testEventCode)
        throw new AppError('Configure the test event code before retrying.');
      if (event.dataset_id && event.dataset_id !== s.dataset_id)
        throw new AppError(
          'This event belongs to a different dataset. Restore its original dataset before retrying.',
        );
      await db
        .prepare(
          "UPDATE outbox SET status='pending',next_attempt_at=?,last_error=NULL,dataset_id=?,test_event_code=? WHERE event_id=?",
        )
        .run(
          new Date().toISOString(),
          event.dataset_id || s.dataset_id,
          event.mode === 'test' ? cfg.testEventCode : null,
          id,
        );
      return { queued: true };
    })
    .immediate();
}
