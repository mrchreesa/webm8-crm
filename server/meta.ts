import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import JSONbig from 'json-bigint';
import type { Config } from './config';
import { settings, type DB } from './db';
import { metaId, sha256 } from './matching';
import { createLead, AppError } from './leads';
import { nowISO } from './time';
// All numeric JSON tokens are parsed as strings; IDs never enter JavaScript Number.
export const losslessJSON = JSONbig({ storeAsString: true, alwaysParseAsBig: true, strict: true });
export function validSignature(raw: Buffer, signature: string | undefined, secret: string) {
  if (!secret || !signature || !/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(raw).digest();
  const supplied = Buffer.from(signature.slice(7), 'hex');
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
export async function persistWebhook(db: DB, cfg: Config, raw: Buffer) {
  const body = losslessJSON.parse(raw.toString('utf8'));
  if (body.object !== 'page' || !Array.isArray(body.entry))
    throw new AppError('Unsupported webhook payload.');
  return await db
    .transaction(async () => {
      let count = 0;
      for (const entry of body.entry) {
        for (const change of entry.changes || []) {
          if (change.field !== 'leadgen') continue;
          const v = change.value,
            id = metaId(v?.leadgen_id),
            page = metaId(v.page_id || entry.id);
          if (cfg.pageId && page !== cfg.pageId) throw new AppError('Unexpected Page ID.', 403);
          if (await db.prepare('SELECT 1 FROM deleted_leads WHERE id_hash=?').get(sha256(id)))
            continue;
          const notification = {
            leadgen_id: id,
            page_id: page,
            form_id: metaId(v.form_id),
            ad_id: v.ad_id ? metaId(v.ad_id) : null,
            adgroup_id: v.adgroup_id ? metaId(v.adgroup_id) : null,
            created_time: v.created_time || null,
            received_mode: (await settings(db, cfg)).mode,
          };
          count += (
            await db
              .prepare(
                'INSERT INTO inbox (meta_lead_id,notification,received_at,next_attempt_at) VALUES (?,?,?,?) ON CONFLICT DO NOTHING',
              )
              .run(id, JSON.stringify(notification), nowISO(), nowISO())
          ).changes;
        }
      }
      return count;
    })
    .immediate();
}
export class MetaError extends Error {
  constructor(
    public temporary: boolean,
    public safeMessage: string,
    public trace?: string,
  ) {
    super(safeMessage);
  }
}
export async function graphRequest(
  cfg: Config,
  path: string,
  token: string,
  init: RequestInit = {},
  fetcher: typeof fetch = fetch,
) {
  let response: Response;
  try {
    response = await fetcher(`https://graph.facebook.com/${cfg.graphVersion}/${path}`, {
      ...init,
      signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${token}`, ...init.headers },
    });
  } catch {
    throw new MetaError(true, 'Meta could not be reached. The worker will retry.');
  }
  let body: any;
  try {
    body = losslessJSON.parse(await response.text());
  } catch {
    throw new MetaError(true, 'Meta returned an unreadable response.');
  }
  if (!response.ok || body.error) {
    const code = Number(body.error?.code || 0),
      temporary =
        response.status === 429 ||
        response.status >= 500 ||
        body.error?.is_transient === true ||
        [1, 2, 4, 17, 32, 341, 613].includes(code);
    // Never persist remote error text: it can echo tokens or personal data.
    const message =
      [190, 102].includes(code) || response.status === 401
        ? 'Meta authentication failed. Replace the access token, then retry.'
        : [10, 200].includes(code) || response.status === 403
          ? 'Meta permission denied. Check Page lead access and dataset permissions, then retry.'
          : temporary
            ? `Meta temporarily rejected the request (HTTP ${response.status}, code ${code}). Retrying.`
            : `Meta rejected the request (HTTP ${response.status}, code ${code}, subcode ${Number(body.error?.error_subcode) || 'none'}). Check the dataset, event mapping and permissions, then retry.`;
    throw new MetaError(
      temporary,
      message,
      typeof body.error?.fbtrace_id === 'string' ? body.error.fbtrace_id.slice(0, 200) : undefined,
    );
  }
  return body;
}
interface Inbox {
  seq: number;
  meta_lead_id: string;
  notification: string;
  received_at: string;
  attempts: number;
  lease_token: string;
}
export async function claimInbox(db: DB, now = Date.now()): Promise<Inbox | undefined> {
  return await db
    .transaction(async () => {
      const iso = new Date(now).toISOString();
      await db
        .prepare(
          "UPDATE inbox SET status='pending',lease_token=NULL,lease_until=NULL WHERE status='processing' AND lease_until<=?",
        )
        .run(iso);
      const job = (await db
        .prepare(
          "SELECT * FROM inbox WHERE status='pending' AND next_attempt_at<=? ORDER BY seq LIMIT 1",
        )
        .get(iso)) as Inbox | undefined;
      if (!job) return;
      const token = randomUUID();
      await db
        .prepare(
          "UPDATE inbox SET status='processing', attempts=attempts+1,lease_token=?,lease_until=? WHERE seq=?",
        )
        .run(token, new Date(now + 60000).toISOString(), job.seq);
      return { ...job, attempts: job.attempts + 1, lease_token: token };
    })
    .immediate();
}
export const backoffMs = (attempts: number) =>
  Math.min(6 * 3600000, 30000 * 2 ** Math.min(attempts - 1, 12));
export async function retrieveOne(
  db: DB,
  cfg: Config,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const job = await claimInbox(db);
  if (!job) return false;
  try {
    if (!cfg.pageToken || !cfg.appSecret)
      throw new MetaError(
        false,
        'Lead retrieval is disconnected. Set the Page access token and app secret, restart both services, then retry.',
      );
    const proof = createHmac('sha256', cfg.appSecret).update(cfg.pageToken).digest('hex');
    const fields = 'id,created_time,field_data,form_id,ad_id,adset_id,campaign_id,is_organic';
    const data = await graphRequest(
      cfg,
      `${metaId(job.meta_lead_id)}?fields=${fields}&appsecret_proof=${proof}`,
      cfg.pageToken,
      {},
      fetcher,
    );
    if (metaId(data.id) !== job.meta_lead_id)
      throw new MetaError(false, 'Meta returned a different lead ID. Check the integration.');
    const n = JSON.parse(job.notification),
      answers = Array.isArray(data.field_data) ? data.field_data : [];
    const field = (name: string) =>
      String(answers.find((a: any) => a.name === name)?.values?.[0] || '');
    const name =
      field('full_name') ||
      [field('first_name'), field('last_name')].filter(Boolean).join(' ') ||
      'Unnamed Meta lead';
    await db
      .transaction(async () => {
        const stillOwned = await db
          .prepare("SELECT 1 FROM inbox WHERE seq=? AND lease_token=? AND status='processing'")
          .get(job.seq, job.lease_token);
        if (!stillOwned) return;
        const result = await createLead(
          db,
          cfg,
          {
            source: 'meta_instant_form',
            meta_lead_id: job.meta_lead_id,
            page_id: n.page_id,
            form_id: data.form_id || n.form_id,
            form_name: `Instant form ${data.form_id || n.form_id}`,
            ad_id: data.ad_id || n.ad_id || n.adgroup_id || undefined,
            adset_id: data.adset_id || undefined,
            campaign_id: data.campaign_id || undefined,
            name,
            email: field('email') || field('email_address'),
            phone: field('phone_number'),
            meta_submitted_at: data.created_time,
            received_at: nowISO(),
            form_answers: answers,
            is_test: n.received_mode === 'test' || (await settings(db, cfg)).mode === 'test',
          },
          'Meta webhook',
        );
        // Full contact data now lives only in the lead; the minimal inbox can be retried safely.
        await db
          .prepare(
            "UPDATE inbox SET status='done',lead_id=?,last_error=NULL,lease_token=NULL,lease_until=NULL WHERE seq=? AND lease_token=?",
          )
          .run(result.lead.id, job.seq, job.lease_token);
      })
      .immediate();
  } catch (error) {
    const e =
      error instanceof MetaError
        ? error
        : new MetaError(
            false,
            'Lead data could not be saved. Check the original IDs and submission timestamp, then retry retrieval.',
          );
    await db
      .prepare(
        'UPDATE inbox SET status=?,next_attempt_at=?,last_error=?,lease_until=NULL,lease_token=NULL WHERE seq=? AND lease_token=?',
      )
      .run(
        e.temporary ? 'pending' : 'failed',
        new Date(Date.now() + backoffMs(job.attempts)).toISOString(),
        e.safeMessage,
        job.seq,
        job.lease_token,
      );
  }
  return true;
}
