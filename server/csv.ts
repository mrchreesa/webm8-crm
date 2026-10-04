import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import type { DB } from './db.js';
import { settings } from './db.js';
import type { Config } from './config.js';
import { createLead, changeStage, AppError, type LeadInput } from './leads.js';
import { metaId, normalizeEmail, sha256 } from './matching.js';
import { instant, nowISO } from './time.js';
import { STAGES, type Stage, type Lead } from '../src/domain.js';
export const CSV_FIELDS = [
  'name',
  'email',
  'phone',
  'meta_lead_id',
  'page_id',
  'form_id',
  'form_name',
  'ad_id',
  'adset_id',
  'campaign_id',
  'meta_submitted_at',
  'received_at',
  'current_stage',
  'new_at',
  'contacted_at',
  'qualified_at',
  'appointment_booked_at',
  'won_at',
  'lost_at',
  'unqualified_at',
  'appointment_at',
  'follow_up_at',
  'sale_gbp',
  'reason',
] as const;
export type Mapping = Partial<Record<(typeof CSV_FIELDS)[number], string>>;
const stageDates: Record<Stage, string> = {
  New: 'new_at',
  Contacted: 'contacted_at',
  Qualified: 'qualified_at',
  'Appointment Booked': 'appointment_booked_at',
  Won: 'won_at',
  Lost: 'lost_at',
  Unqualified: 'unqualified_at',
};
export function pennies(value: string): number {
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(value.trim()))
    throw new AppError('Use a GBP amount with up to two decimal places.');
  const [whole, fraction = ''] = value.trim().split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(amount)) throw new AppError('Sale amount is too large.');
  return amount;
}
function readCSV(csv: string): { headers: string[]; rows: Record<string, string>[] } {
  if (Buffer.byteLength(csv, 'utf8') > 1024 * 1024)
    throw new AppError('CSV files must be 1 MB or smaller.');
  try {
    const arrays = parse(csv, {
      bom: true,
      skip_empty_lines: true,
      cast: false,
      relax_column_count: false,
      max_record_size: 64000,
    }) as string[][];
    if (arrays.length < 2) throw new AppError('Include a header and at least one lead.');
    if (arrays.length > 2001) throw new AppError('Import up to 2,000 leads at a time.');
    const headers = arrays[0].map((h) => h.trim());
    if (headers.some((h) => !h) || new Set(headers).size !== headers.length)
      throw new AppError('Column headers must be unique and non-empty.');
    return {
      headers,
      rows: arrays
        .slice(1)
        .map((values) => Object.fromEntries(headers.map((h, i) => [h, values[i]]))),
    };
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError('The CSV could not be read. Check quoting and column counts.');
  }
}
interface RowPreview {
  row: number;
  name: string;
  meta_lead_id: string;
  stage: string;
  received_at: string;
  status: 'valid' | 'duplicate' | 'invalid';
  errors: string[];
  input?: LeadInput;
  milestones?: { stage: Stage; at: string }[];
  reason?: string;
  newAt?: string;
}
export async function previewCSV(
  db: DB,
  cfg: Config,
  csv: string,
  mapping: Mapping,
  source: 'manual' | 'meta_instant_form',
) {
  const { headers, rows } = readCSV(csv);
  for (const [key, column] of Object.entries(mapping))
    if (!CSV_FIELDS.includes(key as any) || (column && !headers.includes(column)))
      throw new AppError('Choose existing columns for the mapping.');
  const seen = new Set<string>();
  const integration = await settings(db, cfg);
  const results: RowPreview[] = await Promise.all(
    rows.map(async (raw, index) => {
      const f = (key: string) => (raw[mapping[key as keyof Mapping] || ''] || '').trim();
      const row: RowPreview = {
        row: index + 2,
        name: f('name'),
        meta_lead_id: f('meta_lead_id'),
        stage: f('current_stage') || 'New',
        received_at: f('received_at'),
        status: 'valid',
        errors: [],
      };
      try {
        if (!row.name) throw new AppError('Name is required.');
        if (!f('received_at'))
          throw new AppError(
            'Map the actual CRM received time. Historical imports must not use today’s time.',
          );
        const received = instant(f('received_at')),
          initial = instant(f('new_at') || received);
        if (initial < received) throw new AppError('New milestone cannot precede CRM receipt.');
        if (f('email') && !normalizeEmail(f('email')))
          throw new AppError('Email format is invalid.');
        if (!STAGES.includes(row.stage as Stage))
          throw new AppError('Current stage is not recognised.');
        if (source === 'meta_instant_form') {
          for (const field of ['meta_lead_id', 'page_id', 'form_id']) metaId(f(field));
          if (!f('meta_submitted_at'))
            throw new AppError('Original Meta submission time is required.');
          if (instant(f('meta_submitted_at')) > received)
            throw new AppError('Meta submission cannot follow CRM receipt.');
        } else if (f('meta_lead_id'))
          throw new AppError('Use Meta Instant Form origin when importing a Meta lead ID.');
        const milestones = STAGES.filter((s) => s !== 'New' && f(stageDates[s]))
          .map((stage) => ({ stage, at: instant(f(stageDates[stage])) }))
          .sort(
            (a, b) => a.at.localeCompare(b.at) || STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage),
          );
        if (milestones.some((m) => m.at < initial))
          throw new AppError('Milestones cannot precede New.');
        if ((milestones.at(-1)?.stage || 'New') !== row.stage)
          throw new AppError(
            'The current stage needs its actual date and must be the latest mapped milestone.',
          );
        if (milestones.some((m) => ['Lost', 'Unqualified'].includes(m.stage)) && !f('reason'))
          throw new AppError('Lost and Unqualified require a reason.');
        if (milestones.some((m) => m.stage === 'Appointment Booked') && !f('appointment_at'))
          throw new AppError('Appointment Booked requires the appointment time.');
        if (milestones.some((m) => m.stage === 'Won') && !f('sale_gbp'))
          throw new AppError('Won requires the confirmed sale value.');
        const input: LeadInput = {
          source,
          name: row.name,
          email: f('email'),
          phone: f('phone'),
          received_at: received,
          is_test: integration.mode === 'test',
          sale_minor: f('sale_gbp') ? pennies(f('sale_gbp')) : undefined,
          appointment_at: f('appointment_at') ? instant(f('appointment_at'), true) : undefined,
          follow_up_at: f('follow_up_at') ? instant(f('follow_up_at'), true) : undefined,
        };
        for (const field of [
          'meta_lead_id',
          'page_id',
          'form_id',
          'form_name',
          'ad_id',
          'adset_id',
          'campaign_id',
          'meta_submitted_at',
        ] as const)
          if (f(field)) Object.assign(input, { [field]: f(field) });
        for (const id of [input.ad_id, input.adset_id, input.campaign_id]) if (id) metaId(id);
        if (row.meta_lead_id) {
          const duplicateWithinFile = seen.has(row.meta_lead_id);
          seen.add(row.meta_lead_id);
          if (
            await db
              .prepare('SELECT 1 FROM deleted_leads WHERE id_hash=?')
              .get(sha256(row.meta_lead_id))
          )
            throw new AppError('This submission was previously deleted.');
          if (
            duplicateWithinFile ||
            (await db.prepare('SELECT 1 FROM leads WHERE meta_lead_id=?').get(row.meta_lead_id))
          )
            row.status = 'duplicate';
          seen.add(row.meta_lead_id);
        }
        Object.assign(row, { input, milestones, reason: f('reason'), newAt: initial });
      } catch (e) {
        row.status = 'invalid';
        row.errors.push(e instanceof Error ? e.message : 'Invalid row.');
      }
      return row;
    }),
  );
  return {
    headers,
    rows: results,
    total: results.length,
    valid: results.filter((r) => r.status === 'valid').length,
    duplicates: results.filter((r) => r.status === 'duplicate').length,
    invalid: results.filter((r) => r.status === 'invalid').length,
  };
}
export async function importCSV(
  db: DB,
  cfg: Config,
  csv: string,
  mapping: Mapping,
  source: 'manual' | 'meta_instant_form',
  actor: string,
) {
  const fingerprint = sha256(JSON.stringify({ csv, mapping, source }));
  return await db
    .transaction(async () => {
      const previous = (await db
        .prepare('SELECT summary FROM imports WHERE fingerprint=?')
        .get(fingerprint)) as { summary: string } | undefined;
      if (previous) return { ...JSON.parse(previous.summary), already_imported: true };
      const preview = await previewCSV(db, cfg, csv, mapping, source),
        summary = {
          created: 0,
          duplicates: preview.duplicates,
          invalid: preview.invalid,
          total: preview.total,
          errors: preview.rows
            .filter((r) => r.status === 'invalid')
            .map((r) => ({ row: r.row, errors: r.errors })),
        };
      for (const row of preview.rows.filter((r) => r.status === 'valid')) {
        const result = await createLead(db, cfg, row.input!, actor, row.newAt);
        if (result.duplicate) {
          summary.duplicates++;
          continue;
        }
        let lead = result.lead;
        for (const m of row.milestones!)
          lead = (
            await changeStage(
              db,
              cfg,
              lead.id,
              {
                stage: m.stage,
                occurred_at: m.at,
                version: lead.version,
                reason: row.reason,
                sale_minor: lead.sale_minor ?? undefined,
                appointment_at: lead.appointment_at || undefined,
              },
              actor,
            )
          ).lead;
        summary.created++;
      }
      await db
        .prepare('INSERT INTO imports VALUES (?,?,?)')
        .run(fingerprint, JSON.stringify(summary), nowISO());
      return summary;
    })
    .immediate();
}
// Quoted CSV keeps IDs as exact text. Spreadsheet programs must import ID columns as Text.
// Formula-leading personal fields are neutralised to prevent spreadsheet formula injection.
const exportColumns = [
  'id',
  'source',
  'meta_lead_id',
  'page_id',
  'form_id',
  'form_name',
  'ad_id',
  'adset_id',
  'campaign_id',
  'name',
  'email',
  'phone',
  'meta_submitted_at',
  'received_at',
  'stage',
  'appointment_at',
  'follow_up_at',
  'sale_minor',
  'currency',
  'reason',
  'is_demo',
  'is_test',
  'created_at',
  'updated_at',
];
function csvChunk(rows: Lead[], header: boolean) {
  return stringify(
    rows.map((row) =>
      Object.fromEntries(
        exportColumns.map((c) => {
          const v = (row as any)[c];
          return [
            c,
            typeof v === 'string' && /^[=+@\t\r-]/.test(v) && !c.endsWith('_at') ? "'" + v : v,
          ];
        }),
      ),
    ),
    { header, columns: exportColumns, quoted: true },
  );
}
export async function* exportLeadBatches(db: DB) {
  const cutoff = nowISO();
  let cursor = '';
  while (true) {
    const rows = (await db
      .prepare('SELECT * FROM leads WHERE id>? AND created_at<=? ORDER BY id LIMIT 100')
      .all(cursor, cutoff)) as Lead[];
    if (!rows.length) return;
    yield rows;
    cursor = rows.at(-1)!.id;
  }
}
export async function* exportCSVChunks(db: DB) {
  yield csvChunk([], true);
  for await (const rows of exportLeadBatches(db)) yield csvChunk(rows, false);
}
export async function exportCSV(db: DB): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of exportCSVChunks(db)) chunks.push(chunk);
  return chunks.join('');
}
