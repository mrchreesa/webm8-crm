export const STAGES = [
  'New',
  'Contacted',
  'Qualified',
  'Appointment Booked',
  'Won',
  'Lost',
  'Unqualified',
] as const;
export type Stage = (typeof STAGES)[number];
export const EVENT_NAMES: Record<Stage, string> = {
  New: 'CRM_NewLead',
  Contacted: 'CRM_Contacted',
  Qualified: 'CRM_Qualified',
  'Appointment Booked': 'CRM_AppointmentBooked',
  Won: 'CRM_Won',
  Lost: 'CRM_Lost',
  Unqualified: 'CRM_Unqualified',
};
export type Mode = 'demo' | 'test' | 'live';
export type EventStatus =
  'pending' | 'processing' | 'accepted' | 'failed' | 'expired' | 'suppressed';
export interface Lead {
  id: string;
  /** Direct website intake; legacy source remains manual for CRM-only delivery eligibility. */
  website_submission_key?: string | null;
  source: 'meta_instant_form' | 'manual' | 'demo';
  meta_lead_id: string | null;
  page_id: string | null;
  form_id: string | null;
  form_name: string;
  ad_id: string | null;
  adset_id: string | null;
  campaign_id: string | null;
  name: string;
  email: string;
  phone: string;
  meta_submitted_at: string | null;
  received_at: string;
  stage: Stage;
  appointment_at: string | null;
  follow_up_at: string | null;
  sale_minor: number | null;
  currency: string;
  reason: string;
  form_answers: string;
  qualification: string;
  is_demo: number;
  is_test: number;
  created_at: string;
  updated_at: string;
  version: number;
  sync_status?: string;
}
export interface History {
  seq: number;
  id: string;
  lead_id: string;
  previous_stage: Stage | null;
  new_stage: Stage;
  occurred_at: string;
  recorded_at: string;
  changed_by: string;
  correction_reason: string | null;
}
export interface Note {
  id: string;
  lead_id: string;
  text: string;
  author: string;
  created_at: string;
}
export interface OutboxEvent {
  seq: number;
  event_id: string;
  lead_id: string;
  history_id: string;
  event_name: string;
  event_time: number;
  payload: string;
  mode: Mode;
  dataset_id: string;
  test_event_code: string | null;
  status: EventStatus;
  attempts: number;
  next_attempt_at: string;
  lease_until: string | null;
  lease_token: string | null;
  last_error: string | null;
  response_trace_id: string | null;
  response_messages: string | null;
  accepted_at: string | null;
  created_at: string;
  lead_name?: string;
}
export interface Settings {
  mode: Mode;
  dataset_id: string;
  application_name: string;
  event_names: Record<Stage, string>;
  checklist: string[];
}
