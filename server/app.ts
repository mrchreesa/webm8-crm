import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { STAGES, type Settings } from '../src/domain.js';
import type { Config } from './config.js';
import { type DB, settings, saveSettings, safeInteger } from './db.js';
import {
  createSession,
  requireOwner,
  requireCSRF,
  requireSameOrigin,
  session,
  verifyPassword,
} from './auth.js';
import { persistWebhook, validSignature } from './meta.js';
import {
  createLead,
  changeStage,
  editLead,
  addNote,
  leadDetail,
  deleteLead,
  publicEvent,
  AppError,
} from './leads.js';
import { CSV_FIELDS, previewCSV, importCSV, exportCSVChunks, exportLeadBatches } from './csv.js';
import { once } from 'node:events';
import { expireEvents, retryEvent } from './outbox.js';
import { londonRange } from './time.js';
import { sha256 } from './matching.js';
import { LoginLimitStore } from './login-limits.js';
import { wakeQueue } from './jobs.js';
const text = z.string().max(500),
  date = z.string().max(60),
  email = z
    .string()
    .max(320)
    .refine((v) => !v || z.email().safeParse(v).success, 'Enter a valid email address.');
const stageSchema = z.object({
  stage: z.enum(STAGES),
  version: z.number().int().positive(),
  occurred_at: date.optional(),
  reason: text.optional(),
  correction_reason: text.optional(),
  appointment_at: date.optional(),
  sale_minor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
});
const editSchema = z.object({
  version: z.number().int().positive(),
  name: text.trim().min(1),
  email,
  phone: text,
  follow_up_at: date.nullable(),
  appointment_at: date.nullable(),
  qualification: z.array(text).max(12),
  sale_minor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
});
const csvSchema = z.object({
  csv: z.string().max(1024 * 1024),
  mapping: z.record(z.string(), z.string()),
  source: z.enum(['manual', 'meta_instant_form']),
});
const queryText = (v: unknown) => (typeof v === 'string' ? v : '');
const syncSQL = `CASE WHEN l.source='manual' THEN 'ineligible' WHEN l.is_demo=1 THEN 'demo'
  WHEN EXISTS(SELECT 1 FROM outbox e WHERE e.lead_id=l.id AND e.status='failed') THEN 'failed'
  WHEN EXISTS(SELECT 1 FROM outbox e WHERE e.lead_id=l.id AND e.status='expired') THEN 'expired'
  WHEN EXISTS(SELECT 1 FROM outbox e WHERE e.lead_id=l.id AND e.status IN ('pending','processing')) THEN 'pending'
  WHEN EXISTS(SELECT 1 FROM outbox e WHERE e.lead_id=l.id AND e.status='accepted') THEN 'accepted' ELSE 'suppressed' END`;
function pagination(query: Record<string, unknown>) {
  return {
    page: Math.max(1, Math.min(100000, parseInt(queryText(query.page) || '1') || 1)),
    size: 20,
  };
}
export function createApp(db: DB, cfg: Config) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', cfg.trustProxy);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          upgradeInsecureRequests: cfg.production ? [] : null,
        },
      },
      strictTransportSecurity: cfg.production ? undefined : false,
    }),
  );
  app.get('/api/health', async (_req, res) => {
    await db.prepare('SELECT 1').get();
    res.set('Cache-Control', 'no-store').json({ ok: true });
  });
  // Vercel sends CRON_SECRET as a bearer token. Recovery is independent of queue publication.
  app.get('/api/cron/recover', async (req, res) => {
    if (
      !cfg.hosted ||
      !cfg.cronSecret ||
      sha256(req.get('authorization') || '') !== sha256(`Bearer ${cfg.cronSecret}`)
    ) {
      res.status(401).json({ error: 'Unauthorized.' });
      return;
    }
    await db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(new Date().toISOString());
    await db.prepare('DELETE FROM login_limits WHERE expires_at<=?').run(new Date().toISOString());
    await expireEvents(db);
    await wakeQueue(db, cfg);
    res.set('Cache-Control', 'no-store').json({ queued: true });
  });
  app.get('/api/webhooks/meta', (req, res) => {
    if (!cfg.verifyToken) {
      res.status(503).send('Webhook verification is not configured.');
      return;
    }
    const token = queryText(req.query['hub.verify_token']);
    if (req.query['hub.mode'] === 'subscribe' && token && sha256(token) === sha256(cfg.verifyToken))
      res.status(200).type('text/plain').send(queryText(req.query['hub.challenge']));
    else res.status(403).send('Verification failed.');
  });
  app.post(
    '/api/webhooks/meta',
    express.raw({ type: 'application/json', limit: '1mb' }),
    async (req, res, next) => {
      if (!cfg.appSecret) {
        res.status(503).json({ error: 'Webhook app secret is not configured.' });
        return;
      }
      if (
        !Buffer.isBuffer(req.body) ||
        !validSignature(req.body, req.get('x-hub-signature-256'), cfg.appSecret)
      ) {
        res.status(401).json({ error: 'Invalid webhook signature.' });
        return;
      }
      try {
        await persistWebhook(db, cfg, req.body);
        // Persist first. A failed publish returns 503, so Meta can safely replay its notification.
        await wakeQueue(db, cfg);
        res.sendStatus(200);
      } catch (e) {
        next(e);
      }
    },
  );
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '2mb' }), cookieParser());
  app.use('/api', requireSameOrigin(cfg));
  app.post(
    '/api/auth/login',
    rateLimit({
      store: new LoginLimitStore(db),
      windowMs: 15 * 60000,
      limit: 10,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Too many sign-in attempts. Try again in 15 minutes.' },
    }),
    async (req, res) => {
      if (!cfg.passwordHash) {
        res
          .status(503)
          .json({ error: 'Owner access is not configured. Run npm run setup on the server.' });
        return;
      }
      const parsed = z
        .object({ email: z.string().max(320), password: z.string().max(1024) })
        .safeParse(req.body);
      if (
        !parsed.success ||
        parsed.data.email.toLowerCase() !== cfg.ownerEmail.toLowerCase() ||
        !verifyPassword(parsed.data.password, cfg.passwordHash)
      ) {
        res.status(401).json({ error: 'The email or password is incorrect.' });
        return;
      }
      res.json(await createSession(db, cfg, res));
    },
  );
  app.get('/api/auth/session', async (req, res) => {
    const s = await session(db, cfg, req);
    if (!s) {
      res
        .status(401)
        .json({ error: 'Sign in to access your CRM.', setup_required: !cfg.passwordHash });
      return;
    }
    res.json({ csrf_token: s.csrf_token, owner: { name: cfg.ownerName, email: cfg.ownerEmail } });
  });
  app.use('/api', requireOwner(db, cfg), requireCSRF);
  app.post('/api/auth/logout', async (req, res) => {
    if (req.cookies.crm_session)
      await db
        .prepare('DELETE FROM sessions WHERE token_hash=?')
        .run(sha256(req.cookies.crm_session));
    res.clearCookie('crm_session', {
      path: '/',
      httpOnly: true,
      secure: cfg.production,
      sameSite: 'strict',
    });
    res.json({ signed_out: true });
  });
  app.get('/api/overview', async (req, res) => {
    await expireEvents(db);
    const range = londonRange(queryText(req.query.from), queryText(req.query.to)),
      demo = queryText(req.query.data) === 'demo';
    const cohort = await db
      .prepare(
        `SELECT COUNT(*) AS n,
      COALESCE(SUM(CASE WHEN stage='Won' THEN COALESCE(sale_minor,0) ELSE 0 END),0) AS sales_minor
      FROM leads WHERE received_at>=? AND received_at<? AND is_demo=?`,
      )
      .get(range.from, range.to, demo ? 1 : 0);
    const reached = async (stage: string) =>
      (await db
        .prepare(
          `SELECT COUNT(*) AS n FROM milestones m JOIN leads l ON l.id=m.lead_id WHERE m.stage=? AND l.received_at>=? AND l.received_at<? AND l.is_demo=?`,
        )
        .get(stage, range.from, range.to, demo ? 1 : 0)) as { n: number };
    const counts = (await db
      .prepare(
        `SELECT e.status,COUNT(*) AS n FROM outbox e JOIN leads l ON l.id=e.lead_id WHERE l.received_at>=? AND l.received_at<? AND l.is_demo=? GROUP BY e.status`,
      )
      .all(range.from, range.to, demo ? 1 : 0)) as { status: string; n: number }[];
    const followups = await db
      .prepare(
        `SELECT l.*,${syncSQL} AS sync_status FROM leads l WHERE l.is_demo=? AND l.follow_up_at IS NOT NULL AND l.stage NOT IN ('Won','Lost','Unqualified') ORDER BY l.follow_up_at LIMIT 5`,
      )
      .all(demo ? 1 : 0);
    const recent = await db
      .prepare(
        `SELECT l.*,${syncSQL} AS sync_status FROM leads l WHERE l.received_at>=? AND l.received_at<? AND l.is_demo=? ORDER BY l.received_at DESC LIMIT 6`,
      )
      .all(range.from, range.to, demo ? 1 : 0);
    res.json({
      received: cohort.n,
      qualified: (await reached('Qualified')).n,
      appointments: (await reached('Appointment Booked')).n,
      won: (await reached('Won')).n,
      sales_minor: safeInteger(String(cohort.sales_minor)),
      events: Object.fromEntries(counts.map((c) => [c.status, c.n])),
      followups,
      recent,
    });
  });
  app.get('/api/leads', async (req, res) => {
    await expireEvents(db);
    const range = londonRange(queryText(req.query.from), queryText(req.query.to)),
      q = queryText(req.query.q).slice(0, 200),
      stage = queryText(req.query.stage),
      form = queryText(req.query.form),
      problems = queryText(req.query.problems) === 'true',
      demo = queryText(req.query.data) === 'demo';
    const where = ['l.received_at>=?', 'l.received_at<?', 'l.is_demo=?'],
      args: unknown[] = [range.from, range.to, demo ? 1 : 0];
    if (q) {
      where.push(
        "(l.name LIKE ? ESCAPE '\\' OR l.email LIKE ? ESCAPE '\\' OR l.phone LIKE ? ESCAPE '\\' OR l.meta_lead_id LIKE ? ESCAPE '\\')",
      );
      const escaped = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
      args.push(escaped, escaped, escaped, escaped);
    }
    if (stage) {
      where.push('l.stage=?');
      args.push(stage);
    }
    if (form) {
      where.push('l.form_id=?');
      args.push(form);
    }
    if (problems)
      where.push(
        "EXISTS(SELECT 1 FROM outbox e WHERE e.lead_id=l.id AND (e.status IN ('failed','expired') OR (e.status='pending' AND e.last_error IS NOT NULL)))",
      );
    const clause = where.join(' AND '),
      total = (
        (await db.prepare(`SELECT COUNT(*) AS n FROM leads l WHERE ${clause}`).get(...args)) as {
          n: number;
        }
      ).n;
    const p = pagination(req.query),
      page = Math.min(p.page, Math.max(1, Math.ceil(total / p.size)));
    const rows = await db
      .prepare(
        `SELECT l.*,${syncSQL} AS sync_status FROM leads l WHERE ${clause} ORDER BY l.received_at DESC,l.id LIMIT ? OFFSET ?`,
      )
      .all(...args, p.size, (page - 1) * p.size);
    const forms = await db
      .prepare(
        'SELECT DISTINCT form_id,form_name FROM leads WHERE form_id IS NOT NULL AND is_demo=? ORDER BY form_name',
      )
      .all(demo ? 1 : 0);
    res.json({ rows, total, page, page_size: p.size, forms });
  });
  app.get('/api/leads/export', async (req, res) => {
    const closed = new AbortController();
    res.once('close', () => closed.abort());
    const write = async (chunk: string) => {
      if (res.destroyed) throw new AppError('Export connection closed.');
      if (!res.write(chunk)) await once(res, 'drain', { signal: closed.signal });
    };
    if (req.query.format === 'json') {
      res
        .set('Content-Disposition', 'attachment; filename="webm8-leads.json"')
        .type('application/json');
      await write(`{"exported_at":${JSON.stringify(new Date().toISOString())},"leads":[`);
      let first = true;
      for await (const leads of exportLeadBatches(db))
        for (const lead of leads) {
          await write(`${first ? '' : ','}${JSON.stringify(await leadDetail(db, lead.id))}`);
          first = false;
        }
      res.end(']}');
      return;
    }
    res.set('Content-Disposition', 'attachment; filename="webm8-leads.csv"').type('text/csv');
    for await (const chunk of exportCSVChunks(db)) await write(chunk);
    res.end();
  });
  app.post('/api/leads', async (req, res) => {
    const data = z
      .object({
        name: text.trim().min(1),
        email: email.default(''),
        phone: text.default(''),
        follow_up_at: date.optional(),
      })
      .parse(req.body);
    res.status(201).json(await createLead(db, cfg, { ...data, source: 'manual' }, cfg.ownerName));
  });
  app.get('/api/leads/:id', async (req, res) =>
    res.json(await leadDetail(db, String(req.params.id))),
  );
  app.patch('/api/leads/:id', async (req, res) =>
    res.json(await editLead(db, String(req.params.id), editSchema.parse(req.body))),
  );
  app.post('/api/leads/:id/stage', async (req, res) => {
    const result = await changeStage(
      db,
      cfg,
      String(req.params.id),
      stageSchema.parse(req.body),
      cfg.ownerName,
    );
    await wakeQueue(db, cfg).catch(() => {});
    res.json(result);
  });
  app.post('/api/leads/:id/notes', async (req, res) => {
    const data = z.object({ text: z.string().trim().min(1).max(10000) }).parse(req.body);
    res.status(201).json(await addNote(db, String(req.params.id), data.text, cfg.ownerName));
  });
  app.delete('/api/leads/:id', async (req, res) => {
    await deleteLead(db, String(req.params.id));
    res.json({ deleted: true });
  });
  app.post('/api/import/preview', async (req, res) => {
    const d = csvSchema.parse(req.body);
    const preview = await previewCSV(db, cfg, d.csv, d.mapping, d.source);
    res.json({
      ...preview,
      rows: preview.rows.map(({ input, milestones, newAt, reason, ...row }) => row),
      fields: CSV_FIELDS,
    });
  });
  app.post('/api/import/commit', async (req, res) => {
    const d = csvSchema.parse(req.body);
    const result = await importCSV(db, cfg, d.csv, d.mapping, d.source, cfg.ownerName);
    await wakeQueue(db, cfg).catch(() => {});
    res.json(result);
  });
  app.get('/api/integration', async (_req, res) => {
    const s = await settings(db, cfg),
      credentials = {
        page_token: !!cfg.pageToken,
        capi_token: !!cfg.capiToken,
        app_secret: !!cfg.appSecret,
        verify_token: !!cfg.verifyToken,
        test_event_code: !!cfg.testEventCode,
        page_id: !!cfg.pageId,
      };
    const heartbeat = (await db
      .prepare('SELECT heartbeat_at FROM worker_health WHERE id=1')
      .get()) as { heartbeat_at: string } | undefined;
    const queueHealth = await db.prepare('SELECT * FROM queue_health WHERE id=1').get();
    res.json({
      settings: s,
      has_demo_data: !!(await db
        .prepare("SELECT 1 FROM leads WHERE is_demo=1 OR source='demo' LIMIT 1")
        .get()),
      credentials,
      graph_version: cfg.graphVersion,
      page_id: cfg.pageId,
      webhook_url: `${cfg.appUrl}/api/webhooks/meta`,
      connected:
        !!cfg.pageToken &&
        !!cfg.capiToken &&
        !!cfg.appSecret &&
        !!cfg.verifyToken &&
        !!cfg.pageId &&
        !!s.dataset_id,
      worker: {
        kind: cfg.hosted ? 'queue' : 'process',
        configured: cfg.hosted ? cfg.queueEnabled : true,
        last_seen: cfg.hosted
          ? queueHealth?.last_processed_at || null
          : heartbeat?.heartbeat_at || null,
        running: cfg.hosted
          ? false
          : !!heartbeat && Date.now() - Date.parse(heartbeat.heartbeat_at) < 90000,
        error: cfg.hosted ? queueHealth?.last_error || null : null,
      },
      live_allowed: cfg.allowLive,
      errors: await db
        .prepare(
          "SELECT 'delivery' AS kind,event_id AS id,last_error AS error,created_at FROM outbox WHERE last_error IS NOT NULL AND status IN ('failed','pending') UNION ALL SELECT 'retrieval' AS kind,CAST(seq AS TEXT) AS id,last_error AS error,received_at AS created_at FROM inbox WHERE last_error IS NOT NULL AND status IN ('pending','failed') ORDER BY created_at DESC LIMIT 10",
        )
        .all(),
      retrieval: await db
        .prepare(
          "SELECT seq,meta_lead_id,status,attempts,last_error,received_at FROM inbox WHERE status<>'done' ORDER BY seq DESC LIMIT 20",
        )
        .all(),
    });
  });
  app.put('/api/integration', async (req, res) => {
    const d = z
      .object({
        mode: z.enum(['demo', 'test', 'live']),
        dataset_id: z.string().regex(/^$|^[1-9]\d{4,39}$/),
        application_name: z.string().trim().min(1).max(100),
        event_names: z.record(z.enum(STAGES), z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,49}$/)),
        checklist: z.array(z.string().trim().min(1).max(150)).max(8),
        enable_live: z.literal(true).optional(),
      })
      .parse(req.body);
    if (new Set(Object.values(d.event_names)).size !== STAGES.length)
      throw new AppError('Use a different event name for each stage.');
    if (
      d.mode !== 'demo' &&
      (!cfg.capiToken ||
        !d.dataset_id ||
        !cfg.pageToken ||
        !cfg.pageId ||
        !cfg.appSecret ||
        !cfg.verifyToken)
    )
      throw new AppError(
        'Configure all Meta credentials, Page ID and dataset ID before enabling test or live mode.',
      );
    if (d.mode === 'test' && !cfg.testEventCode)
      throw new AppError('Set META_TEST_EVENT_CODE on the server before enabling test mode.');
    if (d.mode === 'live' && !cfg.allowLive)
      throw new AppError(
        'Live delivery is locked on this deployment. Finish hosted testing, then explicitly enable META_LIVE_ENABLED on the production server.',
      );
    if (d.mode === 'live' && (await settings(db, cfg)).mode !== 'live' && !d.enable_live)
      throw new AppError('Explicitly confirm live delivery before enabling it.');
    const { enable_live, ...value } = d;
    await saveSettings(db, value as Settings);
    await wakeQueue(db, cfg).catch(() => {});
    res.json({ saved: true });
  });
  app.post('/api/integration/retrieval/:id/retry', async (req, res) => {
    if (!cfg.pageToken || !cfg.appSecret)
      throw new AppError('Configure the Page token and app secret, then restart both services.');
    const result = await db
      .prepare(
        "UPDATE inbox SET status='pending',next_attempt_at=?,last_error=NULL WHERE seq=? AND status IN ('failed','pending')",
      )
      .run(new Date().toISOString(), String(req.params.id));
    if (!result.changes) throw new AppError('This retrieval cannot be retried.');
    await wakeQueue(db, cfg).catch(() => {});
    res.json({ queued: true });
  });
  app.get('/api/events', async (req, res) => {
    await expireEvents(db);
    const status = queryText(req.query.status),
      demo = queryText(req.query.data) === 'demo',
      where = ['l.is_demo=?'],
      args: unknown[] = [demo ? 1 : 0];
    if (status) {
      where.push('e.status=?');
      args.push(status);
    }
    const clause = where.join(' AND ');
    const total = (
      (await db
        .prepare(
          `SELECT COUNT(*) AS n FROM outbox e JOIN leads l ON l.id=e.lead_id WHERE ${clause}`,
        )
        .get(...args)) as { n: number }
    ).n;
    const p = pagination(req.query),
      page = Math.min(p.page, Math.max(1, Math.ceil(total / p.size)));
    res.json({
      rows: (
        await db
          .prepare(
            `SELECT e.*,l.name AS lead_name FROM outbox e JOIN leads l ON l.id=e.lead_id WHERE ${clause} ORDER BY e.seq DESC LIMIT ? OFFSET ?`,
          )
          .all(...args, p.size, (page - 1) * p.size)
      ).map((e) => publicEvent(e as any)),
      total,
      page,
      page_size: p.size,
    });
  });
  app.post('/api/events/:id/retry', async (req, res) => {
    const result = await retryEvent(db, cfg, String(req.params.id));
    await wakeQueue(db, cfg).catch(() => {});
    res.json(result);
  });
  app.post('/api/integration/queue/check', async (_req, res) => {
    if (!cfg.hosted || !cfg.queueEnabled) throw new AppError('Hosted queue is not configured.');
    await wakeQueue(db, cfg);
    res.json({ queued: true });
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'This API route does not exist.' }));
  if (!cfg.hosted && existsSync(resolve('dist/index.html'))) {
    app.use(express.static(resolve('dist'), { index: false }));
    app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')));
  }
  app.use(
    (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (error instanceof z.ZodError) {
        const fields = Object.fromEntries(error.issues.map((i) => [i.path.join('.'), i.message]));
        res.status(400).json({ error: 'Check the highlighted fields.', fields });
      } else if (error instanceof AppError)
        res.status(error.status).json({
          error: error.message,
          fields: error.field ? { [error.field]: error.message } : undefined,
        });
      else if (
        error instanceof Error &&
        (error.message.startsWith('Use an ISO') ||
          error.message.startsWith('Occurrence times') ||
          error.message.startsWith('Choose a valid received') ||
          error.message.startsWith('Meta IDs'))
      )
        res.status(400).json({ error: error.message });
      else if ((error as any)?.type === 'entity.too.large')
        res.status(413).json({ error: 'This file or request is too large.' });
      else if (error instanceof SyntaxError)
        res.status(400).json({ error: 'The request could not be read. Check its format.' });
      else {
        console.error('CRM request failed. Check server and database availability.');
        res.status(500).json({
          error: 'The change could not be saved. Try again or check server availability.',
        });
      }
    },
  );
  return app;
}
