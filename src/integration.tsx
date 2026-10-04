import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Workflow,
  Check,
  Copy,
  ArrowUpRight,
  RefreshCw,
  ShieldCheck,
  Radio,
  KeyRound,
  CircleAlert,
  ExternalLink,
} from 'lucide-react';
import { api, post } from './api';
import { STAGES, type OutboxEvent } from './domain';
import { date } from './format';
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
  SyncBadge,
  Modal,
  useToast,
  Check as Checkbox,
} from './ui';
import { useWorkspace } from './App';
import { PageHeading } from './lists';
export function Integration() {
  const w = useWorkspace(),
    state = w.integration,
    toast = useToast(),
    [mode, setMode] = useState<string | null>(null);
  if (state.loading && !state.data) return <Loading />;
  if (state.error) return <ErrorState error={state.error} retry={state.refresh} />;
  if (!state.data) return null;
  const d = state.data,
    s = d.settings,
    currentMode = mode || s.mode;
  const secrets = [
    ['page_token', 'Page access token'],
    ['capi_token', 'CAPI access token'],
    ['app_secret', 'App secret'],
    ['verify_token', 'Webhook verification token'],
    ['test_event_code', 'Test event code'],
    ['page_id', 'Page ID'],
  ];
  return (
    <>
      <PageHeading
        eyebrow="CLOSE THE LOOP"
        title="A connection that counts."
        description="Bring leads in from Meta. Send their real outcomes back."
      >
        <Button variant="outline" onClick={state.refresh}>
          <RefreshCw size={16} />
          Refresh status
        </Button>
      </PageHeading>
      <div className={`integration-status ${d.connected ? 'ready' : ''}`}>
        <div className="integration-emblem">
          <Workflow size={27} />
        </div>
        <div>
          <h2>{d.connected ? 'Meta credentials configured' : 'Meta is disconnected'}</h2>
          <p>
            {d.connected
              ? `Configured for ${s.mode} mode. Check Events Manager to verify real delivery and complete funnel setup.`
              : 'Add your credentials on the server to receive leads and send outcomes. Your CRM remains usable.'}
          </p>
        </div>
        <span className="badge">
          {s.mode === 'demo' ? 'Demo mode' : s.mode === 'test' ? 'Meta test mode' : 'Live mode'}
        </span>
      </div>
      <div className="integration-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Connection settings</h2>
              <p>Choose where and how outcomes are sent</p>
            </div>
            <Workflow size={19} />
          </div>
          <div className="panel-content">
            <Form
              noValidate
              key={`${s.mode}-${s.dataset_id}`}
              onSave={async (f) => {
                const event_names = Object.fromEntries(
                  STAGES.map((stage) => [stage, String(f.get(`event_${stage}`) || '')]),
                );
                await api('/integration', {
                  method: 'PUT',
                  body: JSON.stringify({
                    mode: currentMode,
                    dataset_id: f.get('dataset_id'),
                    application_name: f.get('application_name'),
                    checklist: String(f.get('checklist') || '')
                      .split('\n')
                      .map((v) => v.trim())
                      .filter(Boolean),
                    event_names,
                    enable_live: f.get('enable_live') === 'yes' ? true : undefined,
                  }),
                });
              }}
              onSuccess={() => {
                toast('Changes saved');
                state.refresh();
                setMode(null);
              }}
            >
              <Field
                name="application_name"
                label="Application name"
                defaultValue={s.application_name}
                hint="Identifies this CRM in your Meta events."
              />
              <Field
                name="dataset_id"
                label="Meta dataset ID"
                defaultValue={s.dataset_id}
                placeholder="Exact ID from Events Manager"
                inputMode="numeric"
                hint="Keep the ID as text. All digits are preserved."
              />
              <Field
                name="mode"
                label="Delivery mode"
                options={[
                  { value: 'demo', label: 'Demo — no events sent' },
                  { value: 'test', label: 'Meta test — test_event_code required' },
                  { value: 'live', label: 'Live — real events sent' },
                ]}
                value={currentMode}
                onChange={(e) => setMode(e.target.value)}
              />
              {currentMode === 'live' && s.mode !== 'live' && (
                <div className="live-confirm">
                  <Checkbox
                    name="enable_live"
                    label="Enable live delivery to this dataset. I have tested the connection and reviewed my funnel settings."
                  />
                  <p>
                    Existing demo and test events stay in their original mode. They are never
                    promoted to live.
                  </p>
                </div>
              )}
              <Field
                name="checklist"
                label="Your qualification checklist"
                textarea
                defaultValue={s.checklist.join('\n')}
                hint="One item per line, up to eight. Checklist ticks never qualify a lead automatically."
              />
              <details className="advanced">
                <summary>Stage event names</summary>
                <p className="muted">
                  Use these names when configuring your funnel in Meta. New, Contacted, Lost and
                  Unqualified are feedback stages; positive outcomes are Qualified, Appointment
                  Booked and Won.
                </p>
                {STAGES.map((stage) => (
                  <Field
                    key={stage}
                    name={`event_${stage}`}
                    label={stage}
                    defaultValue={s.event_names[stage]}
                  />
                ))}
              </details>
              <div className="form-actions">
                <Submit>Save changes</Submit>
              </div>
            </Form>
          </div>
        </section>
        <div>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Server credentials</h2>
                <p>Configuration status only</p>
              </div>
              <KeyRound size={18} />
            </div>
            <div className="panel-content">
              <p className="muted">
                Credentials are read from server environment variables. After changing them, restart
                the web service and worker.
              </p>
              <div className="credential-list">
                {secrets.map(([key, label]) => (
                  <div key={key}>
                    <span>{label}</span>
                    <span className={`credential-state ${d.credentials[key] ? 'set' : 'missing'}`}>
                      {d.credentials[key] ? <Check size={14} /> : <CircleAlert size={14} />}{' '}
                      {d.credentials[key] ? 'Configured' : 'Missing'}
                    </span>
                  </div>
                ))}
              </div>
              <div className="meta-detail-line">
                <span>Graph API</span>
                <code>{d.graph_version}</code>
              </div>
              <div className="meta-detail-line">
                <span>Page ID</span>
                <code>{d.page_id || 'Not configured'}</code>
              </div>
            </div>
          </section>
          <section className="panel spaced">
            <div className="panel-heading">
              <div>
                <h2>Lead webhook</h2>
                <p>Use this public HTTPS URL in your Meta app</p>
              </div>
            </div>
            <div className="panel-content">
              <code className="webhook-url">{d.webhook_url}</code>
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(d.webhook_url);
                    toast('Webhook URL copied');
                  } catch {
                    toast('Select the webhook URL and copy it.');
                  }
                }}
              >
                <Copy size={15} />
                Copy URL
              </Button>
              <p className="form-help">
                Subscribe to the Page’s leadgen notifications. A signed notification is saved before
                it is acknowledged; the worker retrieves the full lead.
              </p>
            </div>
          </section>
          <section className="worker-panel spaced">
            <Radio size={21} />
            <div>
              <h3>
                {d.worker.running
                  ? 'Background worker is running'
                  : 'Background worker is not reporting'}
              </h3>
              <p>
                {d.worker.last_seen
                  ? `Last seen ${date(d.worker.last_seen)}`
                  : 'Start npm run worker. Delivery continues with the browser closed.'}
              </p>
            </div>
          </section>
          <Link className="guide-card" to={w.link('/guide')}>
            <BookIcon />
            <div>
              <strong>Finish your Meta setup</strong>
              <p>Permissions, test leads and account-side funnel configuration.</p>
            </div>
            <ArrowUpRight size={18} />
          </Link>
        </div>
      </div>
      <section className="panel spaced">
        <div className="panel-heading">
          <div>
            <h2>Recent integration problems</h2>
            <p>Resolve configuration errors, then retry</p>
          </div>
        </div>
        <div className="panel-content">
          {d.errors.length ? (
            d.errors.map((e: any, i: number) => (
              <div className="integration-error" key={`${e.id}-${i}`}>
                <CircleAlert size={18} />
                <div>
                  <strong>{e.kind === 'retrieval' ? 'Lead retrieval' : 'Event delivery'}</strong>
                  <p>{e.error}</p>
                  <small>{date(e.created_at)}</small>
                </div>
                {e.kind === 'retrieval' ? (
                  <RetryAction
                    path={`/integration/retrieval/${e.id}/retry`}
                    onSuccess={state.refresh}
                  />
                ) : (
                  <Link className="text-link" to={w.link('/sync')}>
                    Open sync log →
                  </Link>
                )}
              </div>
            ))
          ) : (
            <Empty title="No integration errors recorded">
              Delivery results will appear once genuine leads and outcomes are processed.
            </Empty>
          )}
          {d.retrieval.length > 0 && (
            <details>
              <summary>Pending lead retrievals ({d.retrieval.length} shown)</summary>
              {d.retrieval.map((r: any) => (
                <div className="retrieval-item" key={r.seq}>
                  <code>{r.meta_lead_id}</code>
                  <span>
                    {r.status} · {r.attempts} attempt(s)
                  </span>
                  {r.last_error && <p>{r.last_error}</p>}
                </div>
              ))}
            </details>
          )}
        </div>
      </section>
      <p className="page-note">
        Configured credentials do not prove API delivery. “Accepted by Meta” does not prove
        matching, attribution, funnel validation or optimization eligibility.
      </p>
    </>
  );
}
function BookIcon() {
  return <ShieldCheck size={24} />;
}
export function RetryAction({ path, onSuccess }: { path: string; onSuccess: () => void }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    toast = useToast();
  return (
    <div className="retry-action">
      <Button
        variant="outline"
        busy={busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            await post(path, {});
            toast('Retry queued');
            onSuccess();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <RefreshCw size={14} />
        Retry
      </Button>
      {error && (
        <small className="field-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}
export function SyncLog() {
  const w = useWorkspace(),
    [params, setParams] = useSearchParams(),
    query = new URLSearchParams({
      data: w.scope,
      status: params.get('status') || '',
      page: params.get('page') || '1',
    }),
    state = useLoad(`/events?${query}`, true),
    [selected, setSelected] = useState<OutboxEvent | null>(null);
  const change = (status: string) => {
    const p = new URLSearchParams(params);
    if (status) p.set('status', status);
    else p.delete('status');
    p.delete('page');
    setParams(p);
  };
  return (
    <>
      <PageHeading
        eyebrow="DELIVERY, IN PLAIN SIGHT"
        title="Every event accounted for."
        description="Inspect delivery, fix problems, and retry with the same event ID and occurrence time."
      >
        <Button variant="outline" onClick={state.refresh}>
          <RefreshCw size={16} />
          Refresh log
        </Button>
      </PageHeading>
      <section className="panel">
        <div className="table-toolbar">
          <div className="status-filters" aria-label="Event status filters">
            {[
              ['', 'All events'],
              ['pending', 'Pending'],
              ['accepted', 'Accepted by Meta'],
              ['failed', 'Failed'],
              ['expired', 'Expired'],
              ['suppressed', 'Not sent'],
            ].map(([value, label]) => (
              <button
                key={value}
                className={
                  params.get('status') === value || (!params.get('status') && value === '')
                    ? 'active'
                    : ''
                }
                onClick={() => change(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="table-frame">
          {state.loading && !state.data ? (
            <Loading />
          ) : state.error ? (
            <ErrorState error={state.error} retry={state.refresh} />
          ) : state.data?.rows.length ? (
            <div className="table-scroll">
              <table aria-label="Meta event delivery log">
                <thead>
                  <tr>
                    <th scope="col">Lead / event</th>
                    <th scope="col">Occurred · London</th>
                    <th scope="col">Mode</th>
                    <th scope="col">Status</th>
                    <th scope="col">Attempts</th>
                    <th scope="col">Last error</th>
                    <th scope="col">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {state.data.rows.map((e: OutboxEvent) => (
                    <tr key={e.event_id}>
                      <td>
                        <Link to={w.link(`/leads/${e.lead_id}`)}>{e.lead_name}</Link>
                        <small className="mono">{e.event_name}</small>
                        <button className="inline-button" onClick={() => setSelected(e)}>
                          Inspect event ↗
                        </button>
                      </td>
                      <td>{date(new Date(e.event_time * 1000).toISOString())}</td>
                      <td>
                        <span className="mode-label">{e.mode}</span>
                      </td>
                      <td>
                        <SyncBadge status={e.status} />
                      </td>
                      <td className="attempt-count">{e.attempts}</td>
                      <td className="error-cell">{e.last_error || '—'}</td>
                      <td>
                        {['failed', 'pending'].includes(e.status) ? (
                          <RetryAction
                            path={`/events/${e.event_id}/retry`}
                            onSuccess={state.refresh}
                          />
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No events in this view">
              Genuine stage changes for eligible Meta leads will appear here. Demo events are
              labelled as not sent.
            </Empty>
          )}
        </div>
        {state.data && <Pagination page={state.data.page} total={state.data.total} />}
      </section>
      <div className="sync-explainer">
        <CircleAlert size={19} />
        <p>
          A failed event holds later events for that lead while other leads continue. Events older
          than seven days expire; retries never change their time. Changing delivery mode pauses
          events from other modes.
        </p>
      </div>
      {selected && (
        <Modal title="Event delivery details" onClose={() => setSelected(null)}>
          <dl className="source-ids">
            <div>
              <dt>Stable event ID</dt>
              <dd className="mono">{selected.event_id}</dd>
            </div>
            <div>
              <dt>Original event time</dt>
              <dd>
                {selected.event_time} · {date(new Date(selected.event_time * 1000).toISOString())}
              </dd>
            </div>
            <div>
              <dt>Delivery</dt>
              <dd>
                <SyncBadge status={selected.status} />
              </dd>
            </div>
            <div>
              <dt>Destination dataset</dt>
              <dd className="mono">{selected.dataset_id || 'Not configured'}</dd>
            </div>
            <div>
              <dt>Attempts</dt>
              <dd>{selected.attempts}</dd>
            </div>
            <div>
              <dt>Next attempt</dt>
              <dd>{selected.status === 'pending' ? date(selected.next_attempt_at) : '—'}</dd>
            </div>
            <div>
              <dt>Accepted at</dt>
              <dd>{date(selected.accepted_at)}</dd>
            </div>
            <div>
              <dt>Meta trace ID</dt>
              <dd className="mono">{selected.response_trace_id || '—'}</dd>
            </div>
          </dl>
          {selected.last_error && <div className="alert error">{selected.last_error}</div>}
          <h3>Minimal outgoing payload</h3>
          <pre className="payload">{JSON.stringify(JSON.parse(selected.payload), null, 2)}</pre>
          <p className="form-help">
            Matching identifiers are normalised and hashed on the server. Meta lead IDs are sent as
            exact strings without hashing.
          </p>
        </Modal>
      )}
    </>
  );
}
export function OwnerGuide() {
  const w = useWorkspace();
  const steps = [
    {
      title: 'Prepare your Meta app and Page access',
      body: 'Use a Meta app associated with your business and a Page access token with leads_retrieval. The person or system user must have access to the Page, ad account and leads in Business Settings → Integrations → Leads Access. Page subscription commonly requires pages_manage_metadata; Page discovery may require pages_show_list and pages_read_engagement. App review, advanced access and business verification depend on your app and who uses it. Confirm the permissions available in your current Meta dashboard.',
    },
    {
      title: 'Connect the signed lead webhook',
      body: 'Give the app a public HTTPS callback ending in /api/webhooks/meta and the verification token from your server environment. Subscribe the app to Page leadgen and subscribe the specific Page to the app. The app secret verifies every POST. Confirm the webhook subscription and send a genuine test lead; the worker retrieves contact details using the original leadgen_id.',
    },
    {
      title: 'Configure a CRM dataset in Events Manager',
      body: 'Create or select the dataset intended for CRM outcomes, follow Meta’s Conversions API / CRM connection flow, and generate an access token with access to that dataset. Add its exact ID here and set META_CAPI_ACCESS_TOKEN on the server. Meta’s dashboard labels and dataset setup options vary by account. This application sends CRM stage events to the dataset’s events endpoint.',
    },
    {
      title: 'Test with a genuine Meta test lead',
      body: 'Set META_TEST_EVENT_CODE from Events Manager’s Test Events tab. Restart both services and select Meta test mode before creating a lead in the Lead Ads Testing Tool for your actual Page and form. Verify that the original Meta lead ID and answers arrived, change its stage, and look for the events in Test Events. A synthetic demo lead cannot validate this. Leads captured in test mode stay test-only forever.',
    },
    {
      title: 'Define the sales funnel and positive stages',
      body: 'Use the configured CRM event names in Events Manager’s CRM funnel setup. Send all genuine stages, including New and unsuccessful outcomes. Choose Qualified, Appointment Booked or Won as positive optimization milestones according to what matters to your business. Contacted, Lost and Unqualified are not positive qualification targets. A form submission is not automatically Qualified. Complete Meta’s validation and any requested volume/history checks in the account.',
    },
    {
      title: 'Give the ad account access to the dataset',
      body: 'In Business Settings and Events Manager, assign the intended ad account to the dataset and grant appropriate permissions to the people or system user operating the connection. Dataset delivery alone does not connect an ad account or complete this account-side setup.',
    },
    {
      title: 'Enable live delivery explicitly',
      body: 'After verifying receipt and test events, set your server credentials, review the dataset, select Live, check the confirmation and save. Incoming live leads and new genuine milestones can now dispatch. Demo and previously queued test events are never promoted. Expired events are kept for inspection and cannot be made eligible by changing their timestamp.',
    },
    {
      title: 'Select Conversion Leads when available and suitable',
      body: 'In Ads Manager, use the Leads objective with Instant Forms and select the Conversion Leads performance goal when your account, dataset and funnel are eligible. Complete the ad-set and funnel configuration and follow current account prompts. This CRM cannot finish Meta’s funnel validation, configure your advertising or guarantee optimization eligibility by sending events. API acceptance does not prove matching or attribution.',
    },
  ];
  return (
    <>
      <PageHeading
        eyebrow="A SHORT OWNER GUIDE"
        title="Get your feedback loop going."
        description="The CRM does the recording and delivery. These steps finish the Meta side."
      />
      <div className="guide-intro">
        <ShieldCheck size={25} />
        <p>
          Start in demo, test with a real Meta lead, then deliberately enable live delivery. Your
          server must run the web service and persistent worker together.
        </p>
        <Link className="button outline" to={w.link('/integration')}>
          Open integration <ArrowUpRight size={16} />
        </Link>
      </div>
      <div className="guide-steps">
        {steps.map((s, i) => (
          <section className="guide-step" key={s.title}>
            <span>{i + 1}</span>
            <div>
              <h2>{s.title}</h2>
              <p>{s.body}</p>
            </div>
          </section>
        ))}
      </div>
      <section className="panel">
        <div className="panel-content">
          <h2>Keep it dependable</h2>
          <p>
            Use Sync log to resolve failures and retry within seven days. Keep tokens valid, back up
            SQLite, and run the worker under a restart policy. Changing a stage records a real
            outcome; corrections and deletion cannot retract an event already accepted by Meta.
          </p>
          <p>
            See README.md and docs/SETUP.md in this project for deployment, environment variables,
            imports and backups.
          </p>
          <div className="guide-links">
            <a
              href="https://developers.facebook.com/docs/marketing-api/conversions-api/guides/conversions-api-for-crm/"
              target="_blank"
              rel="noreferrer"
            >
              Meta CRM integration guide <ExternalLink size={14} />
            </a>
            <a
              href="https://developers.facebook.com/docs/marketing-api/guides/lead-ads/retrieving/"
              target="_blank"
              rel="noreferrer"
            >
              Lead retrieval permissions <ExternalLink size={14} />
            </a>
            <a
              href="https://developers.facebook.com/tools/lead-ads-testing/"
              target="_blank"
              rel="noreferrer"
            >
              Lead Ads Testing Tool <ExternalLink size={14} />
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
