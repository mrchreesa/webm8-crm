import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { DateTime } from 'luxon';
import {
  ArrowDownToLine,
  ArrowRight,
  Plus,
  UsersRound,
  BadgeCheck,
  CalendarDays,
  Trophy,
  PoundSterling,
  Search,
  X,
  Upload,
  RefreshCw,
  Clock3,
  ArrowUpRight,
  Filter,
} from 'lucide-react';
import { post } from './api';
import { STAGES, type Lead, type Stage } from './domain';
import { date, money, toUTC, today } from './format';
import {
  Button,
  Field,
  Form,
  Submit,
  useLoad,
  Loading,
  ErrorState,
  Empty,
  Pagination,
  StageBadge,
  SyncBadge,
  Modal,
  useToast,
  useGuard,
  ModalCancel,
} from './ui';
import { useWorkspace } from './App';
import { StageForm } from './detail';

export function PageHeading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="heading-actions">{children}</div>
    </div>
  );
}
export function receivedQuery(params: URLSearchParams): Record<string, string> {
  const period = params.get('period') || '30';
  if (period === 'all') return {};
  if (period === 'custom') return { from: params.get('from') || '', to: params.get('to') || '' };
  return {
    from: DateTime.now()
      .setZone('Europe/London')
      .minus({ days: Number(period) - 1 })
      .toISODate()!,
    to: today(),
  };
}
export function DateFilter() {
  const [params, setParams] = useSearchParams();
  const update = (key: string, value: string) => {
    const p = new URLSearchParams(params);
    p.set(key, value);
    p.delete('page');
    setParams(p);
  };
  return (
    <div className="date-filter">
      <CalendarDays size={16} />
      <label>
        <span className="sr-only">Received period</span>
        <select
          value={params.get('period') || '30'}
          onChange={(e) => update('period', e.target.value)}
        >
          <option value="30">Last 30 days</option>
          <option value="7">Last 7 days</option>
          <option value="all">All time</option>
          <option value="custom">Custom dates</option>
        </select>
      </label>
      {params.get('period') === 'custom' && (
        <>
          <label>
            <span className="sr-only">Received from</span>
            <input
              aria-label="Received from"
              type="date"
              value={params.get('from') || ''}
              onChange={(e) => update('from', e.target.value)}
            />
          </label>
          <span>to</span>
          <label>
            <span className="sr-only">Received to</span>
            <input
              aria-label="Received to"
              type="date"
              value={params.get('to') || ''}
              onChange={(e) => update('to', e.target.value)}
            />
          </label>
        </>
      )}
    </div>
  );
}
export function Overview() {
  const w = useWorkspace(),
    [params] = useSearchParams(),
    query = new URLSearchParams({ ...receivedQuery(params), data: w.scope }),
    state = useLoad(`/overview?${query}`, true),
    [add, setAdd] = useState(false);
  return (
    <>
      <PageHeading
        eyebrow="YOUR LEAD DESK"
        title="The bigger picture."
        description="See what came in, what moved forward, and what needs you."
      >
        <DateFilter />
        <Button onClick={() => setAdd(true)}>
          <Plus size={17} />
          Add lead
        </Button>
      </PageHeading>
      {state.loading && !state.data ? (
        <Loading />
      ) : state.error ? (
        <ErrorState error={state.error} retry={state.refresh} />
      ) : (
        state.data && <OverviewContent data={state.data} />
      )}
      {add && <NewLeadModal onClose={() => setAdd(false)} />}
    </>
  );
}
function OverviewContent({ data: d }: { data: any }) {
  const w = useWorkspace();
  const metrics = [
    {
      label: 'Leads received',
      value: d.received,
      icon: UsersRound,
      detail: 'In this received cohort',
    },
    {
      label: 'Reached Qualified',
      value: d.qualified,
      icon: BadgeCheck,
      detail: 'Quality confirmed by you',
    },
    {
      label: 'Appointment Booked',
      value: d.appointments,
      icon: CalendarDays,
      detail: 'Reached this milestone',
    },
    { label: 'Reached Won', value: d.won, icon: Trophy, detail: 'Reached this milestone' },
    {
      label: 'Confirmed sales',
      value: money(d.sales_minor),
      icon: PoundSterling,
      detail: 'Leads currently marked Won',
    },
  ];
  const milestones = [
    { name: 'Leads received', n: d.received, color: 'received' },
    { name: 'Qualified', n: d.qualified, color: 'qualified' },
    { name: 'Appointment Booked', n: d.appointments, color: 'appointment' },
    { name: 'Won', n: d.won, color: 'won' },
  ];
  return (
    <>
      <div className="metrics">
        {metrics.map((m) => (
          <section className="metric" key={m.label}>
            <div className="metric-label">
              {m.label}
              <m.icon size={17} />
            </div>
            <strong>{m.value}</strong>
            <small>{m.detail}</small>
          </section>
        ))}
      </div>
      <div className="overview-grid">
        <section className="panel outcome-panel">
          <div className="panel-heading">
            <div>
              <h2>From first hello to a win</h2>
              <p>Milestones reached by this received cohort</p>
            </div>
            <span className="small-label">LEAD OUTCOMES</span>
          </div>
          <div className="funnel">
            {milestones.map((m, i) => (
              <div className="funnel-row" key={m.name}>
                <div className="funnel-caption">
                  <span className={`funnel-symbol ${m.color}`}>
                    {i === 0 ? (
                      <UsersRound size={16} />
                    ) : i === 1 ? (
                      <BadgeCheck size={16} />
                    ) : i === 2 ? (
                      <CalendarDays size={16} />
                    ) : (
                      <Trophy size={16} />
                    )}
                  </span>
                  <span>{m.name}</span>
                  <strong>{m.n}</strong>
                  <small>{d.received ? Math.round((m.n / d.received) * 100) : 0}%</small>
                </div>
                <div className="funnel-track">
                  <div
                    className={`funnel-bar ${m.color}`}
                    style={{ width: `${d.received ? (m.n / d.received) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="panel-footnote">
            Each lead counts once per milestone. Skipped stages stay skipped.
          </div>
        </section>
        <section className="panel followup-panel">
          <div className="panel-heading">
            <div>
              <h2>Your next conversations</h2>
              <p>Open leads with a follow-up date</p>
            </div>
            <Clock3 size={19} />
          </div>
          <div className="followups">
            {d.followups.length ? (
              d.followups.map((l: Lead) => (
                <Link key={l.id} to={w.link(`/leads/${l.id}`)} className="followup">
                  <span className="avatar">{initials(l.name)}</span>
                  <div>
                    <strong>{l.name}</strong>
                    <small>{l.form_name || 'Manual lead'}</small>
                  </div>
                  <span
                    className={
                      l.follow_up_at && Date.parse(l.follow_up_at) < Date.now()
                        ? 'followup-date overdue'
                        : 'followup-date'
                    }
                  >
                    {date(l.follow_up_at, false)}
                    <small>
                      {l.follow_up_at && Date.parse(l.follow_up_at) < Date.now()
                        ? 'Overdue'
                        : DateTime.fromISO(l.follow_up_at!)
                            .setZone('Europe/London')
                            .toFormat('HH:mm')}
                    </small>
                  </span>
                </Link>
              ))
            ) : (
              <Empty title="Nothing scheduled">
                Set a follow-up date on a lead to keep the next conversation in view.
              </Empty>
            )}
          </div>
          <Link className="panel-link" to={w.link('/leads')}>
            View all leads <ArrowRight size={15} />
          </Link>
        </section>
      </div>
      <section className="panel delivery-panel">
        <div>
          <div className="section-icon">
            <RefreshCw size={19} />
          </div>
          <h2>The feedback loop</h2>
          <p>Meta events for leads in this cohort</p>
        </div>
        <div className="delivery-counts">
          {['pending', 'accepted', 'failed', 'expired'].map((s) => (
            <div key={s}>
              <SyncBadge status={s} />
              <strong>
                {s === 'pending'
                  ? (d.events.pending || 0) + (d.events.processing || 0)
                  : d.events[s] || 0}
              </strong>
            </div>
          ))}
        </div>
        <Link to={w.link('/sync')} className="text-link">
          Open sync log <ArrowUpRight size={15} />
        </Link>
        {d.events.suppressed > 0 && (
          <small className="suppressed-count">
            {d.events.suppressed} event(s) not sent: demo or ineligible origin.
          </small>
        )}
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Fresh in your inbox</h2>
            <p>Recently received leads in this cohort</p>
          </div>
          <Link className="text-link" to={w.link('/leads')}>
            View all leads <ArrowRight size={15} />
          </Link>
        </div>
        <LeadTable rows={d.recent} compact />
        {!d.recent.length && (
          <Empty title="Your next lead starts here">
            Connect Meta or add a lead to start tracking outcomes.
          </Empty>
        )}
      </section>
    </>
  );
}
const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase();
export function LeadTable({
  rows,
  compact = false,
  onStage,
}: {
  rows: Lead[];
  compact?: boolean;
  onStage?: (lead: Lead, stage: Stage) => void;
}) {
  const w = useWorkspace(),
    navigate = useNavigate(),
    guard = useGuard();
  return (
    <div className="table-scroll">
      <table aria-label="Leads">
        <thead>
          <tr>
            <th scope="col">Lead</th>
            {!compact && <th scope="col">Contact</th>}
            <th scope="col">Received</th>
            <th scope="col">Stage</th>
            <th scope="col">Source / form</th>
            {!compact && <th scope="col">Next follow-up</th>}
            <th scope="col">Meta sync</th>
            <th scope="col">
              <span className="sr-only">Open lead</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <tr
              key={l.id}
              onClick={(e) => {
                if ((e.target as Element).closest('a,button,select,input,label')) return;
                guard.go(() => navigate(w.link(`/leads/${l.id}`)));
              }}
            >
              <td>
                <div className="lead-name">
                  <span className="avatar">{initials(l.name)}</span>
                  <div>
                    <Link to={w.link(`/leads/${l.id}`)}>{l.name}</Link>
                    {compact && <small>{l.email || l.phone || 'No contact details'}</small>}
                    {l.is_demo === 1 && <small className="demo-text">Synthetic lead</small>}
                  </div>
                </div>
              </td>
              {!compact && (
                <td>
                  <span className="contact-line">{l.email || '—'}</span>
                  <small>{l.phone || '—'}</small>
                </td>
              )}
              <td>
                {date(l.received_at, false)}
                <small>
                  {DateTime.fromISO(l.received_at).setZone('Europe/London').toFormat('HH:mm')}
                </small>
              </td>
              <td>
                {onStage ? (
                  <select
                    className={`quick-stage stage-${l.stage.toLowerCase().replaceAll(' ', '-')}`}
                    aria-label={`Stage for ${l.name}`}
                    value={l.stage}
                    onChange={(e) => onStage(l, e.target.value as Stage)}
                  >
                    {STAGES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                ) : (
                  <StageBadge stage={l.stage} />
                )}
              </td>
              <td>{l.form_name || (l.source === 'manual' ? 'Manual lead' : 'Instant form')}</td>
              {!compact && <td>{date(l.follow_up_at, false)}</td>}
              <td>
                <SyncBadge status={l.sync_status || 'pending'} testOnly={l.is_test === 1} />
              </td>
              <td>
                <Link
                  className="icon-link"
                  to={w.link(`/leads/${l.id}`)}
                  aria-label={`Open ${l.name}`}
                >
                  <ArrowUpRight size={17} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function Leads() {
  const w = useWorkspace(),
    [params, setParams] = useSearchParams(),
    [search, setSearch] = useState(''),
    [committed, setCommitted] = useState(''),
    [composing, setComposing] = useState(false),
    searchRef = useRef<HTMLInputElement>(null),
    [add, setAdd] = useState(false),
    [stage, setStage] = useState<{ lead: Lead; stage: Stage } | null>(null);
  const toast = useToast();
  useEffect(() => {
    if (composing) return;
    const t = setTimeout(
      () => {
        setCommitted(search);
        if (params.has('page')) {
          const p = new URLSearchParams(params);
          p.delete('page');
          setParams(p, { replace: true });
        }
      },
      search ? 300 : 0,
    );
    return () => clearTimeout(t);
  }, [search, composing]);
  const query = new URLSearchParams({
      ...receivedQuery(params),
      data: w.scope,
      q: committed,
      stage: params.get('stage') || '',
      form: params.get('form') || '',
      problems: params.get('problems') || '',
      page: params.get('page') || '1',
    }),
    state = useLoad(`/leads?${query}`);
  const update = (key: string, value: string) => {
    const p = new URLSearchParams(params);
    if (value) p.set(key, value);
    else p.delete(key);
    p.delete('page');
    setParams(p);
  };
  return (
    <>
      <PageHeading
        eyebrow="PEOPLE, THEN PIPELINE"
        title="Every lead. One place."
        description="Keep the conversation moving and record what happens next."
      >
        <Link className="button outline" to={w.link('/import')}>
          <Upload size={16} />
          Import CSV
        </Link>
        <Button onClick={() => setAdd(true)}>
          <Plus size={17} />
          Add lead
        </Button>
      </PageHeading>
      <section className="panel">
        <div className="table-toolbar">
          <div className="search-box">
            <Search size={18} />
            <input
              ref={searchRef}
              aria-label="Search leads"
              placeholder="Search name, email, phone or Meta ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onCompositionStart={() => setComposing(true)}
              onCompositionEnd={() => setComposing(false)}
            />
            {search && (
              <button
                aria-label="Clear search"
                onClick={() => {
                  setSearch('');
                  setCommitted('');
                  searchRef.current?.focus();
                }}
              >
                <X size={17} />
              </button>
            )}
          </div>
          <Button variant="ghost" onClick={state.refresh} aria-label="Refresh leads">
            <RefreshCw size={17} />
          </Button>
          <a className="button ghost" href="/api/leads/export" download>
            <ArrowDownToLine size={16} />
            Export
          </a>
        </div>
        <div className="filter-bar">
          <Filter size={15} />
          <label>
            <span className="sr-only">Stage filter</span>
            <select
              aria-label="Stage filter"
              value={params.get('stage') || ''}
              onChange={(e) => update('stage', e.target.value)}
            >
              <option value="">All stages</option>
              {STAGES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <DateFilter />
          <label>
            <span className="sr-only">Form filter</span>
            <select
              aria-label="Form filter"
              value={params.get('form') || ''}
              onChange={(e) => update('form', e.target.value)}
            >
              <option value="">All forms</option>
              {state.data?.forms.map((f: any) => (
                <option key={f.form_id} value={f.form_id}>
                  {f.form_name || f.form_id}
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={params.get('problems') === 'true'}
              onChange={(e) => update('problems', e.target.checked ? 'true' : '')}
            />
            Sync problems
          </label>
        </div>
        <div className="table-frame">
          {state.loading ? (
            <Loading />
          ) : state.error ? (
            <ErrorState error={state.error} retry={state.refresh} />
          ) : state.data?.rows.length ? (
            <LeadTable
              rows={state.data.rows}
              onStage={(lead, stage) => setStage({ lead, stage })}
            />
          ) : (
            <Empty
              title={
                search || params.get('stage') || params.get('problems')
                  ? 'No leads match these filters'
                  : 'No leads received in this period'
              }
            >
              Try another date range, clear your filters, or add your first lead.
            </Empty>
          )}
        </div>
        {state.data && <Pagination page={state.data.page} total={state.data.total} />}
      </section>
      <p className="page-note">
        Manual leads stay in your CRM. Only eligible Meta Instant Form leads enter the feedback
        loop.
      </p>
      {add && <NewLeadModal onClose={() => setAdd(false)} />}
      {stage && (
        <Modal title={`Change stage · ${stage.lead.name}`} onClose={() => setStage(null)}>
          <StageForm
            lead={stage.lead}
            initialStage={stage.stage}
            onSuccess={() => {
              setStage(null);
              state.refresh();
              toast('Stage saved');
            }}
          />
        </Modal>
      )}
    </>
  );
}
export function NewLeadModal({ onClose }: { onClose: () => void }) {
  const toast = useToast(),
    navigate = useNavigate();
  return (
    <Modal title="Add a lead" onClose={onClose}>
      <p className="muted">A manual lead is yours to track. It won’t be sent to Meta.</p>
      <Form
        noValidate
        onSave={async (f) => {
          await post('/leads', {
            name: f.get('name'),
            email: f.get('email'),
            phone: f.get('phone'),
            follow_up_at: toUTC(String(f.get('follow_up_at') || '')) || undefined,
          });
        }}
        onSuccess={() => {
          toast('Lead added');
          onClose();
          navigate('/leads?data=business&period=all');
        }}
      >
        <Field label="Name" name="name" autoFocus required />
        <Field label="Email" name="email" type="email" />
        <Field label="Phone" name="phone" type="tel" placeholder="+44…" />
        <Field label="Next follow-up · London time" name="follow_up_at" type="datetime-local" />
        <div className="form-actions">
          <ModalCancel />
          <Submit>Add lead</Submit>
        </div>
      </Form>
    </Modal>
  );
}
const IMPORT_FIELDS = [
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
];
export function ImportPage() {
  const w = useWorkspace(),
    [csv, setCSV] = useState(''),
    [filename, setFilename] = useState(''),
    [headers, setHeaders] = useState<string[]>([]),
    [mapping, setMapping] = useState<Record<string, string>>({}),
    [source, setSource] = useState('meta_instant_form'),
    [preview, setPreview] = useState<any>(null),
    [summary, setSummary] = useState<any>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    setPreview(null);
    setSummary(null);
    if (file.size > 1024 * 1024) {
      setError('Choose a CSV file no larger than 1 MB.');
      return;
    }
    setBusy(true);
    try {
      const text = await file.text();
      const p = await post('/import/preview', { csv: text, mapping: {}, source });
      setCSV(text);
      setFilename(file.name);
      setHeaders(p.headers);
      setMapping(Object.fromEntries(IMPORT_FIELDS.map((f) => [f, p.headers.includes(f) ? f : ''])));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Link className="back-link" to={w.link('/leads')}>
        ← Back to leads
      </Link>
      <PageHeading
        eyebrow="BRING YOUR RECORDS"
        title="Import leads, faithfully."
        description="Map your columns, check the preview, then import. IDs stay exact and dates stay real."
      />
      <section className="panel import-panel">
        <div className="panel-heading">
          <div>
            <h2>Choose a CSV</h2>
            <p>Up to 1 MB / 2,000 rows. UTF-8 with a header row.</p>
          </div>
        </div>
        <div className="panel-content">
          <div className="alert info">
            Use original timestamps with UTC or an offset, for example 2026-10-01T09:30:00+01:00.
            Export Meta ID columns as text; scientific notation cannot recover lost digits.
          </div>
          <label className="upload-label">
            <Upload size={24} />
            <strong>{filename || 'Select your CSV file'}</strong>
            <input
              aria-label="Choose CSV file"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => upload(e.target.files?.[0])}
            />
          </label>
          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}
          {busy && <Loading />}
          {!!headers.length && (
            <>
              <Field
                name="source"
                label="Origin of these leads"
                options={[
                  {
                    value: 'meta_instant_form',
                    label: 'Meta Instant Form — original source IDs required',
                  },
                  { value: 'manual', label: 'Manual / other source — CRM only' },
                ]}
                value={source}
                onChange={(e) => {
                  setSource(e.target.value);
                  setPreview(null);
                }}
              />
              <details className="mapping-details" open>
                <summary>Column mapping</summary>
                <div className="mapping-grid">
                  {IMPORT_FIELDS.map((f) => (
                    <Field
                      key={f}
                      label={f.replaceAll('_', ' ')}
                      name={`map_${f}`}
                      options={[
                        { value: '', label: 'Not mapped' },
                        ...headers.map((h) => ({ value: h, label: h })),
                      ]}
                      value={mapping[f] || ''}
                      onChange={(e) => {
                        setMapping((m) => ({ ...m, [f]: e.target.value }));
                        setPreview(null);
                      }}
                    />
                  ))}
                </div>
              </details>
              <Button
                busy={busy}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    setPreview(await post('/import/preview', { csv, mapping, source }));
                    setSummary(null);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Preview and validate
              </Button>
            </>
          )}
          {preview && (
            <div className="import-preview">
              <h2>Check before importing</h2>
              <div className="import-summary">
                <strong>{preview.valid} ready</strong>
                <span>{preview.duplicates} duplicate Meta submissions</span>
                <span>{preview.invalid} invalid rows</span>
              </div>
              <div className="table-scroll">
                <table aria-label="CSV preview">
                  <thead>
                    <tr>
                      <th scope="col">CSV row</th>
                      <th scope="col">Name / Meta ID</th>
                      <th scope="col">Received</th>
                      <th scope="col">Stage</th>
                      <th scope="col">Validation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, 20).map((r: any) => (
                      <tr key={r.row}>
                        <td>{r.row}</td>
                        <td>
                          {r.name}
                          <small className="mono">{r.meta_lead_id || 'CRM only'}</small>
                        </td>
                        <td>{r.received_at}</td>
                        <td>{r.stage}</td>
                        <td>
                          {r.status}
                          <small className="field-error">{r.errors.join(' ')}</small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted">
                Showing the first 20 of {preview.total} rows. Duplicate and invalid rows will be
                skipped. Only supplied milestones are recorded.
              </p>
              <Button
                busy={busy}
                disabled={!preview.valid || !!summary}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    setSummary(await post('/import/commit', { csv, mapping, source }));
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Import {preview.valid} valid leads
              </Button>
            </div>
          )}
          {summary && (
            <div className="alert success" role="status">
              <div>
                <strong>
                  {summary.already_imported
                    ? 'This import was already completed.'
                    : 'Import complete.'}
                </strong>
                <p>
                  {summary.created} created · {summary.duplicates} duplicates skipped ·{' '}
                  {summary.invalid} invalid
                </p>
                {summary.errors.map((r: any) => (
                  <p key={r.row}>
                    Row {r.row}: {r.errors.join(' ')}
                  </p>
                ))}
                <Link to="/leads?data=business&period=all">View your leads →</Link>
              </div>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
