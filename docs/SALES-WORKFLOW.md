# Sales workflow

Source: the owner's 8 October 2026 approval of the recommendations inspired by `webm8-agency/ops-dashboard`, and their selection of Sales pipeline. The existing stage, Meta delivery and website-evidence contracts still apply.

## Daily use

Pipeline is the default Leads view. The Lead desk remains available for working through conversations. Both show source, current stage age, last recorded result and next action. Priority sorting puts overdue tasks first, then New leads with no result, then open leads without a next step. Closed leads follow open work. All-time receipt is the default here so older obligations remain visible; users can narrow the cohort explicitly.

The default board has four open stages: New, Contacted, Qualified and Appointment Booked. Won, Lost and Unqualified have separate outcome links. Each column shows eight cards and its full matching count; View all opens the paginated desk with that stage selected. Stage changes continue through the existing explicit form, including qualification, appointment, value and closure requirements. Logging a result does not infer a stage or dispatch a Meta conversion.

## Results and progress

Record call attempted, no answer, voicemail, connected, wrong number, first call completed, demo booked/held, no-show, proposal sent/accepted. The result has a real occurrence time, recording time, actor and optional note. Dates before lead receipt or in the future are rejected. A booking additionally has a scheduled date after its booking time; the UI never treats a booking as a completed demo. Legacy notes/stages do not fabricate historical calls or demos.

First call, Demo, Proposal and Outcome show recorded state and dates, without a percentage. Current sales outcome comes from the existing stage. Completed/accepted milestones take precedence over earlier booked/sent states. For repeated entries of the same kind, use the latest actual occurrence and its own scheduled date. Corrected entries are excluded. A correction keeps the original, voiding time and reason; it does not retract Meta events or automatically change related tasks.

Last recorded conversation uses connected, first call completed, demo held and proposal accepted. A note, no-answer attempt or task completion is not contact. First-attempt reporting uses actual call-result timestamps. Overview shows overdue/missing follow-ups for its selected received cohort and median time from receipt to first recorded call attempt, with a sample count. It does not pretend historical unrecorded calls are known.

## Follow-up lifecycle

Each lead has at most one open sales follow-up: title, type and London-displayed due time (UTC storage). Owners can schedule, reschedule, complete or cancel it. Completed/cancelled tasks and prior due dates remain in the activity history. A result can complete the current task and schedule the next task in one transaction. If the current task is left open, entering a next step reschedules it. No email, SMS or telephone call is sent by these actions.

Closing a lead as Won, Lost or Unqualified cancels its active sales reminder, preserving history. Reopening does not revive a cancelled reminder; plan a fresh next step. Closed leads can retain historical results but cannot schedule active sales follow-up. Existing intake/import and legacy edit paths write through the same lifecycle.

All writes require the existing authenticated owner/workspace membership, same-origin CSRF and a current lead version. Each new workflow mutation has a UUID and hash of its parsed request. A retry of a committed request returns success without duplication; reuse with a changed payload fails. Version conflicts never overwrite newer work. Combined result/task operations roll back together. Deleting a lead removes both new tables through existing cascade deletion.

## Upgrade and data portability

Migration 009 runs transactionally on both SQLite and PostgreSQL. Existing follow-up dates become tasks with an explicit Migration history entry explaining that original scheduling time was not recorded. Existing dates on closed leads are retained as cancelled tasks and removed from the active reminder projection. No past call, demo or proposal is invented. An empty activity history means Not recorded, not proof no contact occurred.

`leads.follow_up_at` remains the due date of the active task for existing exports and readers. JSON export includes every task and activity in addition to the paginated UI timeline. Database transfer preserves both tables and foreign keys. CSV remains a lead snapshot, not a complete activity archive.

## Website evidence

Source labels describe captured lead origin. Named lead history and anonymous possible website visits remain separate. Timing, direct `/demo` entry and ad identifiers are evidence for comparison, not proof that a specific Instant Form respondent visited. Website measurement and cross-browser limitations follow [WEBSITE-ACTIVITY.md](WEBSITE-ACTIVITY.md); these sales changes do not upgrade possible matches to identified people.
