import { DateTime } from 'luxon';
import type { DB } from './db.js';
import { londonRange, nowISO } from './time.js';
import { CALL_KINDS_SQL, workflowSelect } from './workflow.js';
import { OPEN_STAGES, WORK_VIEWS } from '../src/workflow.js';
import { STAGES } from '../src/domain.js';
const text = (v: unknown) => (typeof v === 'string' ? v : '');
const open = "stage NOT IN ('Won','Lost','Unqualified')";
export async function listWorkflowLeads(db: DB, query: Record<string, unknown>, syncSQL: string) {
  const range = londonRange(text(query.from), text(query.to)),
    demo = text(query.data) === 'demo',
    q = text(query.q).slice(0, 200),
    stage = text(query.stage),
    form = text(query.form),
    work = WORK_VIEWS.some(([key]) => key === text(query.work)) ? text(query.work) : 'all';
  const where = ['l.received_at>=?', 'l.received_at<?', 'l.is_demo=?'],
    args: unknown[] = [range.from, range.to, demo ? 1 : 0];
  if (q) {
    where.push(
      "(l.name LIKE ? ESCAPE '\\' OR l.email LIKE ? ESCAPE '\\' OR l.phone LIKE ? ESCAPE '\\' OR l.meta_lead_id LIKE ? ESCAPE '\\')",
    );
    const escaped = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    args.push(escaped, escaped, escaped, escaped);
  }
  if (form) {
    where.push('l.form_id=?');
    args.push(form);
  }
  if (text(query.problems) === 'true')
    where.push(
      "EXISTS(SELECT 1 FROM outbox e WHERE e.lead_id=l.id AND (e.status IN ('failed','expired') OR (e.status='pending' AND e.last_error IS NOT NULL)))",
    );
  const prefix = `WITH scoped AS (SELECT l.*,${syncSQL} AS sync_status,${workflowSelect} FROM leads l WHERE ${where.join(' AND ')})`;
  const now = nowISO(),
    start = DateTime.now().setZone('Europe/London').startOf('day'),
    end = start.plus({ days: 1 });
  const filters: Record<string, { sql: string; args: unknown[] }> = {
    all: { sql: '1=1', args: [] },
    new: { sql: "stage='New' AND last_activity_at IS NULL", args: [] },
    overdue: { sql: `${open} AND next_task_id IS NOT NULL AND follow_up_at<?`, args: [now] },
    today: {
      sql: `${open} AND next_task_id IS NOT NULL AND follow_up_at>=? AND follow_up_at<?`,
      args: [start.toUTC().toISO(), end.toUTC().toISO()],
    },
    missing: { sql: `${open} AND next_task_id IS NULL`, args: [] },
  };
  const counts: Record<string, number> = {};
  for (const [key, filter] of Object.entries(filters)) {
    counts[key] = (
      await db
        .prepare(
          `${prefix} SELECT COUNT(*) AS n FROM scoped WHERE ${filter.sql}${stage ? ' AND stage=?' : ''}`,
        )
        .get(...args, ...filter.args, ...(stage ? [stage] : []))
    ).n;
  }
  const filter = filters[work || 'all'];
  const stageRows = await db
    .prepare(`${prefix} SELECT stage,COUNT(*) AS n FROM scoped WHERE ${filter.sql} GROUP BY stage`)
    .all(...args, ...filter.args);
  const stageCounts = Object.fromEntries(
    STAGES.map((s) => [s, stageRows.find((x) => x.stage === s)?.n || 0]),
  );
  const order =
    text(query.sort) === 'stale'
      ? 'COALESCE(last_contact_at,received_at),id'
      : text(query.sort) === 'priority'
        ? `CASE WHEN NOT (${open}) THEN 5 WHEN next_task_id IS NOT NULL AND follow_up_at<'${now}' THEN 0 WHEN stage='New' AND last_activity_at IS NULL THEN 1 WHEN next_task_id IS NULL THEN 2 ELSE 3 END,follow_up_at,received_at,id`
        : 'received_at DESC,id';
  const clause = `${filter.sql}${stage ? ' AND stage=?' : ''}`,
    fullArgs = [...args, ...filter.args, ...(stage ? [stage] : [])];
  const total = counts[work || 'all'],
    requestedPage = Math.max(1, Math.min(100000, parseInt(text(query.page)) || 1)),
    page = Math.min(requestedPage, Math.max(1, Math.ceil(total / 20)));
  const rows =
    text(query.view) === 'pipeline'
      ? []
      : await db
          .prepare(
            `${prefix} SELECT * FROM scoped WHERE ${clause} ORDER BY ${order} LIMIT 20 OFFSET ?`,
          )
          .all(...fullArgs, (page - 1) * 20);
  const columns = [];
  if (text(query.view) === 'pipeline') {
    for (const column of stage ? STAGES.filter((s) => s === stage) : OPEN_STAGES) {
      const leads = await db
        .prepare(
          `${prefix} SELECT * FROM scoped WHERE ${filter.sql} AND stage=? ORDER BY ${order} LIMIT 8`,
        )
        .all(...args, ...filter.args, column);
      columns.push({ stage: column, total: stageCounts[column], rows: leads });
    }
  }
  const forms = await db
    .prepare(
      'SELECT DISTINCT form_id,form_name FROM leads WHERE form_id IS NOT NULL AND is_demo=? ORDER BY form_name',
    )
    .all(demo ? 1 : 0);
  return {
    rows,
    columns,
    stage_counts: stageCounts,
    work_counts: counts,
    total,
    page,
    page_size: 20,
    forms,
  };
}
export async function workflowReport(db: DB, demo: boolean, range: { from: string; to: string }) {
  const filter = 'l.is_demo=? AND l.received_at>=? AND l.received_at<?',
    args = [demo ? 1 : 0, range.from, range.to];
  const prefix = `WITH cohort AS (SELECT l.*,
    (SELECT MIN(a.occurred_at) FROM lead_activities a WHERE a.lead_id=l.id AND a.voided_at IS NULL AND a.kind IN (${CALL_KINDS_SQL})) AS first_attempt,
    (SELECT COUNT(*) FROM lead_tasks t WHERE t.lead_id=l.id AND t.status='open') AS tasks
    FROM leads l WHERE ${filter})`;
  const counts = await db
    .prepare(
      `${prefix} SELECT COUNT(*) AS leads,
    COALESCE(SUM(CASE WHEN first_attempt IS NOT NULL THEN 1 ELSE 0 END),0) AS attempted,
    COALESCE(SUM(CASE WHEN ${open} AND tasks=0 THEN 1 ELSE 0 END),0) AS missing,
    COALESCE(SUM(CASE WHEN ${open} AND tasks>0 AND follow_up_at<? THEN 1 ELSE 0 END),0) AS overdue FROM cohort`,
    )
    .get(...args, nowISO());
  const seconds =
    db.dialect === 'postgres'
      ? 'EXTRACT(EPOCH FROM (first_attempt::timestamptz-received_at::timestamptz))'
      : '(julianday(first_attempt)-julianday(received_at))*86400';
  const median = await db
    .prepare(
      `${prefix}, durations AS (SELECT ${seconds} AS seconds FROM cohort WHERE first_attempt IS NOT NULL AND first_attempt>=received_at),
    ranked AS (SELECT seconds,ROW_NUMBER() OVER(ORDER BY seconds) AS position,COUNT(*) OVER() AS size FROM durations)
    SELECT AVG(seconds) AS seconds FROM ranked WHERE position IN ((size+1)/2,(size+2)/2)`,
    )
    .get(...args);
  return {
    attempted: Number(counts.attempted),
    missing: Number(counts.missing),
    overdue: Number(counts.overdue),
    median_first_attempt_seconds: median.seconds === null ? null : Number(median.seconds),
  };
}
