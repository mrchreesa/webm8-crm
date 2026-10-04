import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  Pencil,
  Trash2,
  Mail,
  Phone,
  MessageSquare,
  RefreshCw,
  CheckCircle2,
} from 'lucide-react';
import { api, post } from './api';
import { STAGES, type Lead, type Stage, type History, type Note, type OutboxEvent } from './domain';
import { date, localInput, toUTC, toMinor, money } from './format';
import {
  Button,
  Field,
  Form,
  Submit,
  Check,
  useLoad,
  Loading,
  ErrorState,
  StageBadge,
  SyncBadge,
  Modal,
  useToast,
} from './ui';
import { useWorkspace } from './App';
import { PageHeading } from './lists';
export function StageForm({
  lead,
  initialStage,
  onSuccess,
}: {
  lead: Lead;
  initialStage?: Stage;
  onSuccess: () => void;
}) {
  const [stage, setStage] = useState<Stage>(initialStage || lead.stage),
    [correction, setCorrection] = useState(false);
  const [openedAt] = useState(localInput());
  return (
    <Form
      noValidate
      onSave={async (f) => {
        if (correction && !String(f.get('correction_reason') || '').trim())
          throw new Error('Explain the correction before saving.');
        const sale = toMinor(String(f.get('sale_gbp') || ''));
        await post(`/leads/${lead.id}/stage`, {
          stage,
          version: lead.version,
          occurred_at:
            String(f.get('occurred_at')) === openedAt
              ? new Date().toISOString()
              : toUTC(String(f.get('occurred_at'))),
          reason: String(f.get('reason') || ''),
          correction_reason: correction ? String(f.get('correction_reason')) : undefined,
          appointment_at: toUTC(String(f.get('appointment_at') || '')) || undefined,
          sale_minor: sale === null ? undefined : sale,
        });
      }}
      onSuccess={onSuccess}
    >
      <div className="stage-transition">
        <StageBadge stage={lead.stage} />
        <ArrowRight size={18} />
        <span>Record the actual outcome</span>
      </div>
      <Field
        name="stage"
        label="New stage"
        options={STAGES.map((s) => ({ value: s, label: s }))}
        value={stage}
        onChange={(e) => setStage(e.target.value as Stage)}
      />
      <Field
        name="occurred_at"
        label="When it happened · London time"
        type="datetime-local"
        defaultValue={openedAt}
        required
        hint="Leave the default to record now, or choose the actual past time. It is preserved on every retry."
      />
      {stage === 'Qualified' && (
        <div className="alert info">
          Qualification is your decision. Check the lead’s service fit and interest; a form
          submission alone is not qualification.
        </div>
      )}
      {stage === 'Appointment Booked' && (
        <Field
          name="appointment_at"
          label="Appointment date · London time"
          type="datetime-local"
          defaultValue={lead.appointment_at ? localInput(lead.appointment_at) : ''}
          required
        />
      )}
      {stage === 'Won' && (
        <Field
          name="sale_gbp"
          label="Confirmed sale value · GBP"
          inputMode="decimal"
          defaultValue={lead.sale_minor !== null ? (lead.sale_minor / 100).toFixed(2) : ''}
          placeholder="0.00"
          required
        />
      )}
      {['Lost', 'Unqualified'].includes(stage) && (
        <Field
          name="reason"
          label={`Reason for ${stage.toLowerCase()}`}
          textarea
          defaultValue={lead.reason}
          required
        />
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={correction}
          onChange={(e) => setCorrection(e.target.checked)}
        />
        This corrects an earlier entry
      </label>
      {correction && <Field name="correction_reason" label="Correction reason" textarea required />}
      <p className="form-help">
        {correction
          ? 'A correction records history without sending a new event.'
          : 'Only a genuine stage change sends an event. Repeated positive milestones are not sent again.'}{' '}
        Correcting a stage does not retract an event already accepted by Meta.
      </p>
      <div className="form-actions">
        <Submit>Save stage</Submit>
      </div>
    </Form>
  );
}
export function LeadDetail() {
  const { id } = useParams(),
    [params] = useSearchParams(),
    w = useWorkspace(),
    state = useLoad<{ lead: Lead; history: History[]; notes: Note[]; events: OutboxEvent[] }>(
      `/leads/${id}`,
    ),
    toast = useToast(),
    navigate = useNavigate();
  const returnPath = params.get('return'),
    listPath = returnPath?.startsWith('/leads?') ? returnPath : w.link('/leads');
  const [stage, setStage] = useState(false),
    [edit, setEdit] = useState(false),
    [remove, setRemove] = useState(false),
    [noteKey, setNoteKey] = useState(0);
  if (state.loading && !state.data) return <Loading />;
  if (state.error) return <ErrorState error={state.error} retry={state.refresh} />;
  if (!state.data) return null;
  const { lead: l, history, notes, events } = state.data,
    answers = JSON.parse(l.form_answers) as { name: string; values: string[] }[],
    qualification = JSON.parse(l.qualification) as string[];
  const checklist: string[] = w.integration.data?.settings.checklist || [];
  return (
    <>
      <Link className="back-link" to={listPath}>
        ← Back to leads
      </Link>
      <PageHeading
        eyebrow={
          l.is_demo
            ? 'SYNTHETIC DEMO LEAD'
            : l.source === 'manual'
              ? 'YOUR CRM · MANUAL LEAD'
              : 'META INSTANT FORM'
        }
        title={l.name}
        description={`Received ${date(l.received_at)} · London time`}
      >
        <StageBadge stage={l.stage} />
        <Button onClick={() => setStage(true)}>
          Change stage <ArrowRight size={16} />
        </Button>
      </PageHeading>
      {l.is_demo === 1 && (
        <div className="alert info">
          Synthetic demo record. It is never sent to Meta, in any mode.
        </div>
      )}
      {l.is_test === 1 && !l.is_demo && (
        <div className="alert info">
          This lead was received in Meta test mode. It can send test events only and will never be
          promoted to live.
        </div>
      )}
      <div className="detail-grid">
        <div className="detail-primary">
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Contact & next steps</h2>
                <p>The details that keep your conversation moving</p>
              </div>
              <Button variant="ghost" onClick={() => setEdit(true)}>
                <Pencil size={15} />
                Edit details
              </Button>
            </div>
            <div className="panel-content">
              <div className="contact-cards">
                <div>
                  <Mail size={18} />
                  <div>
                    <small>Email</small>
                    {l.email ? (
                      <a href={`mailto:${l.email}`}>{l.email}</a>
                    ) : (
                      <span>Not provided</span>
                    )}
                  </div>
                </div>
                <div>
                  <Phone size={18} />
                  <div>
                    <small>Phone</small>
                    {l.phone ? <a href={`tel:${l.phone}`}>{l.phone}</a> : <span>Not provided</span>}
                  </div>
                </div>
              </div>
              <dl className="detail-values">
                <div>
                  <dt>Next follow-up</dt>
                  <dd>{date(l.follow_up_at)}</dd>
                </div>
                <div>
                  <dt>Appointment</dt>
                  <dd>{date(l.appointment_at)}</dd>
                </div>
                <div>
                  <dt>Confirmed sale</dt>
                  <dd>{l.sale_minor !== null ? money(l.sale_minor) : 'Not recorded'}</dd>
                </div>
                {l.reason && (
                  <div>
                    <dt>Outcome reason</dt>
                    <dd>{l.reason}</dd>
                  </div>
                )}
              </dl>
              <div className="qualification">
                <h3>Qualification checklist</h3>
                <p className="muted">
                  A reminder to assess fit. Checking these does not change the stage.
                </p>
                {checklist.map((c) => (
                  <div className="qualification-item" key={c}>
                    <CheckCircle2
                      size={16}
                      className={qualification.includes(c) ? 'checked' : 'unchecked'}
                    />
                    {c}
                    <small>{qualification.includes(c) ? 'Confirmed' : 'Not checked'}</small>
                  </div>
                ))}
                <Button variant="ghost" onClick={() => setEdit(true)}>
                  Update checklist →
                </Button>
              </div>
            </div>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Conversation notes</h2>
                <p>Private to your CRM. Never sent to Meta.</p>
              </div>
              <MessageSquare size={19} />
            </div>
            <div className="panel-content">
              <Form
                noValidate
                key={noteKey}
                onSave={async (f) => {
                  await post(`/leads/${l.id}/notes`, { text: f.get('text') });
                }}
                onSuccess={() => {
                  setNoteKey((k) => k + 1);
                  state.refresh();
                  toast('Note added');
                }}
              >
                <Field
                  name="text"
                  label="Add a note"
                  textarea
                  placeholder="What did you discuss? What should happen next?"
                />
                <div className="form-actions">
                  <Submit>Add note</Submit>
                </div>
              </Form>
              <div className="notes-list">
                {notes.map((n) => (
                  <article className="note" key={n.id}>
                    <p>{n.text}</p>
                    <small>
                      {n.author} · {date(n.created_at)}
                    </small>
                  </article>
                ))}
              </div>
            </div>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Stage history</h2>
                <p>What happened, when it happened, and who recorded it</p>
              </div>
            </div>
            <div className="timeline">
              {history.map((h) => (
                <article key={h.id} className="timeline-item">
                  <span className={`timeline-dot ${h.correction_reason ? 'correction' : ''}`} />
                  <div>
                    <div className="timeline-title">
                      {h.previous_stage && (
                        <>
                          <span>{h.previous_stage}</span>
                          <ArrowRight size={14} />
                        </>
                      )}
                      <strong>{h.new_stage}</strong>
                      {h.correction_reason && <span className="small-label">CORRECTION</span>}
                    </div>
                    <p>
                      {date(h.occurred_at)} · {h.changed_by}
                    </p>
                    {h.correction_reason && <p>{h.correction_reason}</p>}
                    <small>Recorded {date(h.recorded_at)}</small>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
        <div className="detail-secondary">
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Meta feedback</h2>
                <p>API delivery, event by event</p>
              </div>
              <RefreshCw size={18} />
            </div>
            <div className="panel-content">
              {events.length ? (
                events.map((e) => (
                  <div className="lead-event" key={e.event_id}>
                    <strong>
                      {history.find((h) => h.id === e.history_id)?.new_stage || e.event_name}
                    </strong>
                    <SyncBadge status={e.status} />
                    <small>
                      {date(new Date(e.event_time * 1000).toISOString())} · {e.mode} mode
                    </small>
                    {e.last_error && <p className="muted">{e.last_error}</p>}
                  </div>
                ))
              ) : (
                <p className="muted">
                  This manual lead is available in your CRM and excluded from the Conversion Leads
                  integration.
                </p>
              )}
              <Link className="text-link" to={w.link('/sync')}>
                Inspect the sync log <ArrowUpRightIcon />
              </Link>
            </div>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Original source</h2>
                <p>Identifiers stay exactly as received</p>
              </div>
            </div>
            <div className="panel-content">
              <dl className="source-ids">
                {[
                  ['Source', l.source],
                  ['Meta lead ID', l.meta_lead_id],
                  ['Page ID', l.page_id],
                  ['Form ID', l.form_id],
                  ['Form', l.form_name],
                  ['Ad ID', l.ad_id],
                  ['Ad set ID', l.adset_id],
                  ['Campaign ID', l.campaign_id],
                  ['Meta submission', date(l.meta_submitted_at)],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd className={label?.includes('ID') ? 'mono' : ''}>
                      {value || 'Not provided'}
                    </dd>
                  </div>
                ))}
              </dl>
              {answers.length > 0 && (
                <div className="form-answers">
                  <h3>Form answers</h3>
                  {answers.map((a, i) => (
                    <div key={i}>
                      <small>{a.name.replaceAll('_', ' ')}</small>
                      <p>{a.values.join(', ')}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
          <div className="delete-area">
            <Button variant="ghost" className="danger-text" onClick={() => setRemove(true)}>
              <Trash2 size={15} />
              Delete lead
            </Button>
            <small>Remove this lead and its personal data.</small>
          </div>
        </div>
      </div>
      {stage && (
        <Modal title="Record an outcome" onClose={() => setStage(false)}>
          <StageForm
            lead={l}
            onSuccess={() => {
              setStage(false);
              state.refresh();
              toast('Stage saved');
            }}
          />
        </Modal>
      )}
      {edit && (
        <Modal title="Edit lead details" onClose={() => setEdit(false)}>
          <Form
            noValidate
            onSave={async (f) => {
              await api(`/leads/${l.id}`, {
                method: 'PATCH',
                body: JSON.stringify({
                  version: l.version,
                  name: f.get('name'),
                  email: f.get('email'),
                  phone: f.get('phone'),
                  follow_up_at: toUTC(String(f.get('follow_up_at') || '')),
                  appointment_at: toUTC(String(f.get('appointment_at') || '')),
                  sale_minor: toMinor(String(f.get('sale_gbp') || '')),
                  qualification: f.getAll('qualification'),
                }),
              });
            }}
            onSuccess={() => {
              setEdit(false);
              state.refresh();
              toast('Changes saved');
            }}
          >
            <Field name="name" label="Name" defaultValue={l.name} required />
            <Field name="email" label="Email" type="email" defaultValue={l.email} />
            <Field name="phone" label="Phone" type="tel" defaultValue={l.phone} />
            <Field
              name="follow_up_at"
              label="Next follow-up · London time"
              type="datetime-local"
              defaultValue={l.follow_up_at ? localInput(l.follow_up_at) : ''}
            />
            <Field
              name="appointment_at"
              label="Appointment · London time"
              type="datetime-local"
              defaultValue={l.appointment_at ? localInput(l.appointment_at) : ''}
            />
            <Field
              name="sale_gbp"
              label="Confirmed sale value · GBP"
              inputMode="decimal"
              defaultValue={l.sale_minor !== null ? (l.sale_minor / 100).toFixed(2) : ''}
            />
            <h3>Qualification checklist</h3>
            {checklist.map((c) => (
              <Check
                key={c}
                name="qualification"
                value={c}
                label={c}
                defaultChecked={qualification.includes(c)}
              />
            ))}
            <p className="form-help">
              These edits do not create a conversion. Updating a sale value does not resend an
              existing Won event.
            </p>
            <div className="form-actions">
              <Submit>Save changes</Submit>
            </div>
          </Form>
        </Modal>
      )}
      {remove && (
        <Modal title={`Delete ${l.name}?`} onClose={() => setRemove(false)}>
          <p>
            This permanently removes the lead, form answers, notes, stage history and outgoing
            payloads from your CRM. An event already accepted by Meta cannot be retracted here.
          </p>
          <Form
            noValidate
            onSave={async () => {
              await api(`/leads/${l.id}`, { method: 'DELETE' });
            }}
            onSuccess={() => {
              setRemove(false);
              toast('Lead deleted');
              navigate(listPath);
            }}
          >
            <div className="form-actions">
              <Button type="button" variant="outline" autoFocus onClick={() => setRemove(false)}>
                Cancel
              </Button>
              <DeleteSubmit />
            </div>
          </Form>
        </Modal>
      )}
    </>
  );
}
function ArrowUpRightIcon() {
  return <span aria-hidden="true">↗</span>;
}
function DeleteSubmit() {
  return <Submit variant="danger">Delete lead</Submit>;
}
