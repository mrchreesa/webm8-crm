import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check, Clock3, Phone, CalendarDays, FileText, Trophy, ArrowRight } from 'lucide-react';
import type { Lead } from './domain';
import {
  ACTIVITY_KINDS,
  ACTIVITY_LABELS,
  TASK_KINDS,
  isClosed,
  nextAction,
  type ActivityKind,
  type FollowUp,
  type WorkflowDetail,
} from './workflow';
import { localInput, toUTC, date } from './format';
import { post } from './api';
import { Button, Form, Field, Submit, Modal, ModalCancel, useToast, Loading } from './ui';

function TaskFields({ task }: { task?: FollowUp | null }) {
  return (
    <>
      <Field
        name="title"
        label="Next action"
        defaultValue={task?.title || ''}
        placeholder="Call to discuss the demo"
        required
      />
      <Field
        name="kind"
        label="Follow-up type"
        defaultValue={task?.kind || 'call'}
        options={TASK_KINDS.map((value) => ({
          value,
          label: { call: 'Call', demo: 'Demo', proposal: 'Proposal', other: 'Other' }[value],
        }))}
      />
      <Field
        name="due_at"
        label="Due · London time"
        type="datetime-local"
        defaultValue={task ? localInput(task.due_at) : ''}
        required
      />
    </>
  );
}
function TaskForm({
  lead,
  task,
  action,
  onSuccess,
}: {
  lead: Lead;
  task: FollowUp | null;
  action: 'schedule' | 'reschedule' | 'complete' | 'cancel';
  onSuccess: () => void;
}) {
  const [id] = useState(() => crypto.randomUUID());
  return (
    <Form
      noValidate
      onSave={(f) =>
        post(`/leads/${lead.id}/tasks`, {
          id,
          version: lead.version,
          action,
          task_id: task?.id,
          ...(['schedule', 'reschedule'].includes(action)
            ? {
                title: f.get('title'),
                kind: f.get('kind'),
                due_at: toUTC(String(f.get('due_at') || '')) || '',
              }
            : {}),
        })
      }
      onSuccess={onSuccess}
    >
      {['schedule', 'reschedule'].includes(action) ? (
        <TaskFields task={task} />
      ) : (
        <p>
          {action === 'complete'
            ? `Mark “${task?.title}” done? This records task completion; log a result to record the conversation.`
            : `Cancel “${task?.title}”? It will stay in the lead’s history.`}
        </p>
      )}
      <div className="form-actions">
        <ModalCancel />
        <Submit>
          {action === 'complete'
            ? 'Mark follow-up done'
            : action === 'cancel'
              ? 'Cancel follow-up'
              : 'Save follow-up'}
        </Submit>
      </div>
    </Form>
  );
}
function ResultForm({
  lead,
  task,
  onSuccess,
}: {
  lead: Lead;
  task: FollowUp | null;
  onSuccess: () => void;
}) {
  const [id] = useState(() => crypto.randomUUID()),
    [opened] = useState(() => new Date().toISOString()),
    [kind, setKind] = useState(''),
    [next, setNext] = useState(false);
  const initial = localInput(opened);
  return (
    <Form
      noValidate
      onSave={(f) =>
        post(`/leads/${lead.id}/activities`, {
          id,
          version: lead.version,
          kind,
          note: f.get('note'),
          occurred_at:
            String(f.get('occurred_at')) === initial
              ? opened
              : toUTC(String(f.get('occurred_at'))) || '',
          ...(kind === 'demo_booked'
            ? { scheduled_for: toUTC(String(f.get('scheduled_for') || '')) || '' }
            : {}),
          ...(f.get('complete_task') ? { complete_task_id: task?.id } : {}),
          ...(next
            ? {
                follow_up_at: toUTC(String(f.get('follow_up_at') || '')) || '',
                follow_up_title: f.get('follow_up_title'),
                follow_up_kind: f.get('follow_up_kind'),
              }
            : {}),
        })
      }
      onSuccess={onSuccess}
    >
      <Field
        name="kind"
        label="What happened?"
        value={kind}
        onChange={(e) => setKind(e.target.value)}
        options={[
          { value: '', label: 'Choose a result' },
          ...ACTIVITY_KINDS.map((value) => ({ value, label: ACTIVITY_LABELS[value] })),
        ]}
        required
      />
      <Field
        name="occurred_at"
        label="When · London time"
        type="datetime-local"
        defaultValue={initial}
        required
      />
      {kind === 'demo_booked' && (
        <Field
          name="scheduled_for"
          label="Demo date · London time"
          type="datetime-local"
          required
        />
      )}
      <Field
        name="note"
        label="Conversation note"
        textarea
        placeholder="What was agreed? What should happen next?"
      />
      {task && (
        <label className="check">
          <input type="checkbox" name="complete_task" />
          Mark “{task.title}” done
        </label>
      )}
      {!isClosed(lead) && (
        <label className="check">
          <input type="checkbox" checked={next} onChange={(e) => setNext(e.target.checked)} />
          Set the next follow-up
        </label>
      )}
      {next && (
        <div className="followup-fields">
          {task && (
            <p className="muted">
              If the current follow-up is left open, these details reschedule it.
            </p>
          )}
          <Field
            name="follow_up_title"
            label="Next action"
            placeholder="Call after they review the proposal"
            required
          />
          <Field
            name="follow_up_kind"
            label="Follow-up type"
            defaultValue="call"
            options={TASK_KINDS.map((value) => ({
              value,
              label: { call: 'Call', demo: 'Demo', proposal: 'Proposal', other: 'Other' }[value],
            }))}
          />
          <Field
            name="follow_up_at"
            label="Follow-up due · London time"
            type="datetime-local"
            required
          />
        </div>
      )}
      <p className="form-help">
        This adds to the lead’s history. Use Change stage to record a sales outcome.
      </p>
      <div className="form-actions">
        <ModalCancel />
        <Submit>Save result</Submit>
      </div>
    </Form>
  );
}
export function LeadWorkflow({
  lead,
  workflow,
  onRefresh,
}: {
  lead: Lead;
  workflow: WorkflowDetail;
  onRefresh: () => void;
}) {
  const [dialog, setDialog] = useState<
      'result' | 'schedule' | 'reschedule' | 'complete' | 'cancel' | null
    >(null),
    toast = useToast();
  const action = nextAction(lead, workflow.task, workflow.has_activity);
  const mark = (kind: string) => workflow.milestones.find((m) => m.kind === kind);
  const first = mark('first_call_completed'),
    demo = mark('demo_held') || mark('demo_booked'),
    proposal = mark('proposal_accepted') || mark('proposal_sent');
  const milestones = [
    {
      label: 'First call',
      state: first ? 'Completed' : 'Not recorded',
      time: first?.occurred_at,
      icon: Phone,
      done: !!first,
    },
    {
      label: 'Demo',
      state: mark('demo_held') ? 'Held' : demo ? 'Booked' : 'Not recorded',
      time: demo?.kind === 'demo_booked' ? demo.scheduled_for : demo?.occurred_at,
      icon: CalendarDays,
      done: !!mark('demo_held'),
    },
    {
      label: 'Proposal',
      state: mark('proposal_accepted') ? 'Accepted' : proposal ? 'Sent' : 'Not recorded',
      time: proposal?.occurred_at,
      icon: FileText,
      done: !!mark('proposal_accepted'),
    },
    {
      label: 'Outcome',
      state: lead.stage === 'Won' ? 'Won' : isClosed(lead) ? lead.stage : 'Open',
      icon: Trophy,
      done: lead.stage === 'Won',
      time: null,
    },
  ];
  const success = () => {
    const result = dialog;
    setDialog(null);
    onRefresh();
    toast(result === 'result' ? 'Result saved' : 'Follow-up updated');
  };
  return (
    <section className="panel workflow-panel" aria-label="Lead progress and next action">
      <div className="panel-heading">
        <div>
          <h2>Progress & next action</h2>
          <p>Recorded milestones for this lead</p>
        </div>
      </div>
      <ol className="lead-milestones">
        {milestones.map((m) => (
          <li key={m.label} className={m.done ? 'attained' : ''}>
            <span className="milestone-icon">
              {m.done ? <Check size={16} /> : <m.icon size={16} />}
            </span>
            <div>
              <strong>{m.label}</strong>
              <span>{m.state}</span>
              {m.time && <small>{date(m.time)}</small>}
            </div>
          </li>
        ))}
      </ol>
      <div className={`next-action ${action.tone}`}>
        <div>
          <small>Next action</small>
          <h3>{action.label}</h3>
          {workflow.task && (
            <p>
              <Clock3 size={15} />
              {date(workflow.task.due_at)} · London
              {action.tone === 'overdue' && <strong>Overdue</strong>}
            </p>
          )}
          <span className="muted">{action.detail}</span>
        </div>
        <div className="workflow-actions">
          <Button onClick={() => setDialog('result')}>
            Log result <ArrowRight size={15} />
          </Button>
          {!isClosed(lead) && (
            <Button
              variant="outline"
              onClick={() => setDialog(workflow.task ? 'reschedule' : 'schedule')}
            >
              {workflow.task ? 'Reschedule' : 'Plan follow-up'}
            </Button>
          )}
        </div>
      </div>
      {workflow.task && (
        <div className="task-secondary">
          <Button variant="ghost" onClick={() => setDialog('complete')}>
            <Check size={15} />
            Mark done
          </Button>
          <Button variant="ghost" onClick={() => setDialog('cancel')}>
            Cancel follow-up
          </Button>
        </div>
      )}
      <div className="panel-footnote">
        Last recorded conversation:{' '}
        {workflow.last_contact_at ? date(workflow.last_contact_at) : 'None yet'}. Booked and
        completed milestones are shown separately.
      </div>
      {dialog && (
        <Modal
          title={
            dialog === 'result'
              ? 'Log a result'
              : dialog === 'reschedule'
                ? 'Reschedule follow-up'
                : dialog === 'complete'
                  ? 'Complete follow-up'
                  : dialog === 'cancel'
                    ? 'Cancel follow-up'
                    : 'Plan follow-up'
          }
          onClose={() => setDialog(null)}
        >
          {dialog === 'result' ? (
            <ResultForm lead={lead} task={workflow.task} onSuccess={success} />
          ) : (
            <TaskForm lead={lead} task={workflow.task} action={dialog} onSuccess={success} />
          )}
        </Modal>
      )}
    </section>
  );
}
function CorrectionForm({
  lead,
  activityId,
  onSuccess,
}: {
  lead: Lead;
  activityId: string;
  onSuccess: () => void;
}) {
  const [id] = useState(() => crypto.randomUUID());
  return (
    <Form
      noValidate
      onSave={(f) =>
        post(`/leads/${lead.id}/activities/${activityId}/correct`, {
          id,
          version: lead.version,
          reason: f.get('reason'),
        })
      }
      onSuccess={onSuccess}
    >
      <p>
        The entry stays in history, marked as corrected. It will no longer count toward progress.
        Any follow-up you scheduled remains available to change separately.
      </p>
      <Field name="reason" label="Correction reason" textarea required />
      <div className="form-actions">
        <ModalCancel />
        <Submit>Correct entry</Submit>
      </div>
    </Form>
  );
}
export function LeadTimeline({
  lead,
  workflow,
  loading,
  onRefresh,
}: {
  lead: Lead;
  workflow: WorkflowDetail;
  loading: boolean;
  onRefresh: () => void;
}) {
  const [params, setParams] = useSearchParams(),
    [correct, setCorrect] = useState<string | null>(null),
    toast = useToast();
  const page = Math.max(1, Number(params.get('historyPage')) || 1);
  function go(next: number) {
    const p = new URLSearchParams(params);
    p.set('historyPage', String(next));
    setParams(p, { preventScrollReset: true });
  }
  return (
    <>
      <div className="timeline-toolbar">
        <span>Recorded activity · newest first</span>
        <span>
          {workflow.total} {workflow.total === 1 ? 'entry' : 'entries'}
        </span>
      </div>
      {loading && page !== workflow.page ? (
        <Loading />
      ) : (
        <div className="timeline unified-timeline">
          {workflow.timeline.map((e) => (
            <article
              key={`${e.category}:${e.id}`}
              className={`timeline-item ${e.voided_at ? 'corrected-entry' : ''}`}
            >
              <span
                className={`timeline-dot ${e.voided_at || e.correction_reason ? 'correction' : ''}`}
              />
              <div>
                <div className="timeline-title">
                  <strong>
                    {e.category === 'note'
                      ? 'Note added'
                      : e.category === 'stage'
                        ? `${e.previous_stage ? `${e.previous_stage} → ` : ''}${e.kind}`
                        : ACTIVITY_LABELS[e.kind] || e.kind}
                  </strong>
                  {(e.voided_at || e.correction_reason) && (
                    <span className="small-label">Corrected</span>
                  )}
                </div>
                <p>
                  {date(e.occurred_at)} · {e.actor}
                </p>
                {e.note && <p className="entry-note">{e.note}</p>}
                {e.scheduled_for && (
                  <p>
                    {e.kind === 'demo_booked' ? 'Demo scheduled' : 'Follow-up due'}:{' '}
                    {date(e.scheduled_for)}
                  </p>
                )}
                {e.previous_due_at && <small>Previously due {date(e.previous_due_at)}</small>}
                {(e.void_reason || e.correction_reason) && (
                  <p>{e.void_reason || e.correction_reason}</p>
                )}
                {e.category === 'activity' &&
                  !e.voided_at &&
                  ACTIVITY_KINDS.includes(e.kind as ActivityKind) && (
                    <Button
                      variant="ghost"
                      className="timeline-correction"
                      onClick={() => setCorrect(e.id)}
                    >
                      Correct entry
                    </Button>
                  )}
              </div>
            </article>
          ))}
        </div>
      )}
      {workflow.total > workflow.page_size && (
        <div className="pagination">
          <span>
            Page {workflow.page} of {Math.ceil(workflow.total / workflow.page_size)}
          </span>
          <div>
            <Button
              variant="outline"
              disabled={loading || workflow.page === 1}
              onClick={() => go(workflow.page - 1)}
            >
              Previous activity
            </Button>
            <Button
              variant="outline"
              disabled={loading || workflow.page * workflow.page_size >= workflow.total}
              onClick={() => go(workflow.page + 1)}
            >
              Next activity
            </Button>
          </div>
        </div>
      )}
      {correct && (
        <Modal title="Correct an activity" onClose={() => setCorrect(null)}>
          <CorrectionForm
            lead={lead}
            activityId={correct}
            onSuccess={() => {
              setCorrect(null);
              onRefresh();
              toast('Entry corrected');
            }}
          />
        </Modal>
      )}
    </>
  );
}
