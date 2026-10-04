import { QueueClient } from '@vercel/queue';
import type { Config } from './config.js';
import { settings, type DB } from './db.js';
import { retrieveOne } from './meta.js';
import { deliverOne, expireEvents } from './outbox.js';

export const JOB_TOPIC = 'crm-work';
// Queue messages are wakeups only. Personal data and event identity remain in SQL.
export const queue = new QueueClient({ region: 'lhr1' });
export type Publisher = (delaySeconds: number) => Promise<unknown>;
const publish: Publisher = (delaySeconds) =>
  queue.send(JOB_TOPIC, { version: 1 }, { delaySeconds, retentionSeconds: 604800 });

export async function wakeQueue(db: DB, cfg: Config, publisher: Publisher = publish, delay = 0) {
  if (!cfg.queueEnabled) return;
  try {
    await publisher(Math.max(0, Math.min(21600, Math.ceil(delay))));
    await db
      .prepare(
        `INSERT INTO queue_health (id,last_enqueued_at,last_error) VALUES (1,?,NULL)
      ON CONFLICT(id) DO UPDATE SET last_enqueued_at=excluded.last_enqueued_at,last_error=NULL`,
      )
      .run(new Date().toISOString());
  } catch {
    await db
      .prepare(
        `INSERT INTO queue_health (id,last_error) VALUES (1,?)
      ON CONFLICT(id) DO UPDATE SET last_error=excluded.last_error`,
      )
      .run(
        'Hosted queue could not be reached. Work is saved in SQL. Check Vercel Queues and retry; the daily recovery check also reschedules it.',
      );
    throw new Error('Hosted queue unavailable. Saved work will be recovered.');
  }
}

export async function nextWorkAt(db: DB, cfg: Config): Promise<string | null> {
  const s = await settings(db, cfg);
  const inbox = await db
    .prepare(
      `SELECT MIN(CASE WHEN status='processing' THEN lease_until ELSE next_attempt_at END) AS due
    FROM inbox WHERE status IN ('pending','processing')`,
    )
    .get();
  const event =
    s.mode === 'demo' || (s.mode === 'live' && !cfg.allowLive)
      ? undefined
      : await db
          .prepare(
            `SELECT MIN(CASE WHEN o.status='processing' THEN o.lease_until ELSE o.next_attempt_at END) AS due
      FROM outbox o JOIN leads l ON l.id=o.lead_id
      WHERE o.status IN ('pending','processing') AND o.mode=? AND l.source='meta_instant_form'
      AND l.is_demo=0 AND (o.mode='test' OR l.is_test=0)
      AND NOT EXISTS (SELECT 1 FROM outbox p WHERE p.lead_id=o.lead_id
        AND (p.event_time<o.event_time OR (p.event_time=o.event_time AND p.seq<o.seq))
        AND p.status IN ('pending','processing','failed'))`,
          )
          .get(s.mode);
  return (
    [inbox?.due, event?.due].filter((v): v is string => typeof v === 'string').sort()[0] || null
  );
}

// Bounded work fits a serverless invocation; the SQL leases also protect against duplicates.
export async function runHostedCycle(
  db: DB,
  cfg: Config,
  publisher: Publisher = publish,
  fetcher: typeof fetch = fetch,
) {
  if (!cfg.hosted || cfg.deployment !== 'production' || !cfg.queueEnabled)
    throw new Error('Hosted delivery is only enabled in the production deployment.');
  await expireEvents(db);
  await retrieveOne(db, cfg, fetcher);
  await deliverOne(db, cfg, fetcher);
  await db
    .prepare(
      `INSERT INTO queue_health (id,last_processed_at,last_error) VALUES (1,?,NULL)
    ON CONFLICT(id) DO UPDATE SET last_processed_at=excluded.last_processed_at,last_error=NULL`,
    )
    .run(new Date().toISOString());
  const due = await nextWorkAt(db, cfg);
  if (due) await wakeQueue(db, cfg, publisher, Math.max(1, (Date.parse(due) - Date.now()) / 1000));
}
