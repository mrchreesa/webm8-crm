import type { Lead } from './domain';

export const ACTIVITY_KINDS = [
  'call_attempt',
  'no_answer',
  'voicemail',
  'connected',
  'wrong_number',
  'first_call_completed',
  'demo_booked',
  'demo_held',
  'no_show',
  'proposal_sent',
  'proposal_accepted',
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
export const ACTIVITY_LABELS: Record<string, string> = {
  call_attempt: 'Call attempted',
  no_answer: 'No answer',
  voicemail: 'Voicemail left',
  connected: 'Connected',
  wrong_number: 'Wrong number',
  first_call_completed: 'First call completed',
  demo_booked: 'Demo booked',
  demo_held: 'Demo held',
  no_show: 'No-show',
  proposal_sent: 'Proposal sent',
  proposal_accepted: 'Proposal accepted',
  follow_up_scheduled: 'Follow-up scheduled',
  follow_up_rescheduled: 'Follow-up rescheduled',
  follow_up_completed: 'Follow-up completed',
  follow_up_cancelled: 'Follow-up cancelled',
  activity_corrected: 'Activity corrected',
};
export const TASK_KINDS = ['call', 'demo', 'proposal', 'other'] as const;
export const WORK_VIEWS = [
  ['all', 'All leads'],
  ['new', 'Untouched'],
  ['overdue', 'Overdue'],
  ['today', 'Today'],
  ['missing', 'No next step'],
] as const;
export const OPEN_STAGES = ['New', 'Contacted', 'Qualified', 'Appointment Booked'] as const;
export function isClosed(lead: Pick<Lead, 'stage'>) {
  return !OPEN_STAGES.includes(lead.stage as (typeof OPEN_STAGES)[number]);
}
export interface FollowUp {
  id: string;
  lead_id: string;
  title: string;
  kind: (typeof TASK_KINDS)[number];
  due_at: string;
  status: 'open' | 'completed' | 'cancelled';
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
}
export interface WorkflowLead extends Lead {
  next_task_id: string | null;
  next_task_title: string | null;
  last_activity_at: string | null;
  last_activity_kind: string | null;
  last_contact_at: string | null;
  stage_entered_at: string;
}
export interface TimelineEntry {
  id: string;
  category: 'activity' | 'note' | 'stage';
  kind: string;
  occurred_at: string;
  recorded_at: string;
  actor: string;
  note: string;
  scheduled_for: string | null;
  previous_due_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  previous_stage: string | null;
  correction_reason: string | null;
}
export interface WorkflowDetail {
  task: FollowUp | null;
  milestones: { kind: string; occurred_at: string; scheduled_for: string | null }[];
  timeline: TimelineEntry[];
  total: number;
  page: number;
  page_size: number;
  last_contact_at: string | null;
  has_activity: boolean;
}
export function nextAction(lead: Lead, task?: FollowUp | null, hasActivity = false) {
  if (isClosed(lead))
    return {
      label: lead.stage === 'Won' ? 'Customer won' : 'Lead closed',
      detail: 'Review the recorded outcome and history.',
      tone: 'closed',
    };
  if (task)
    return {
      label: task.title,
      detail: 'Agreed next step',
      tone: Date.parse(task.due_at) < Date.now() ? 'overdue' : 'scheduled',
    };
  return {
    label:
      lead.stage === 'New' && !hasActivity
        ? 'Make the first contact'
        : 'Plan the next conversation',
    detail: 'No follow-up is scheduled.',
    tone: 'missing',
  };
}
