# Product and domain contract

Source: the owner's CRM brief supplied for this implementation on 3 October 2026.

One owner, one business, persistent SQLite data. All lead data, settings, exports and logs require owner authentication. Passwords use salted scrypt; sessions use hashed opaque tokens and CSRF protection. Secrets remain in the server environment.

Meta Instant Form submissions remain separate even when emails match. All Meta IDs are digit strings. The initial New milestone is the real CRM receipt time; historical imports use supplied original receipt/milestone times. Stage changes and outgoing events commit atomically. Notes/contact edits and same-stage saves do not create events. Positive milestones and New dispatch only once per lead; repeated other genuine outcomes are recorded and dispatched. Corrections record history without dispatch and do not erase attained milestones or retract accepted events.

Dashboard cohorts use CRM received time in Europe/London calendar ranges. Milestone counts use unique leads that reached each stage. Confirmed revenue is the recorded GBP value of leads currently Won within the cohort, independent of API deliveries.

Demo data and ineligible manual leads cannot dispatch. A genuine test lead captured in test mode is test-only forever. Event destination/mode/name/ID/time and hashed matching payload are snapshotted. Paused modes retain queued events; they are never promoted from test/demo to live. Live requires explicit owner confirmation and configured credentials. Failed earlier events block only their lead. Expired earlier events release later eligible milestones.

Hard deletion is user-authorised through a confirmation dialog and removes the lead, answers, history, notes, hashed outgoing identifiers and inbox notification. A one-way deleted-ID marker prevents duplicate webhooks restoring it. Backups are managed by the owner; accepted Meta events cannot be retracted by local deletion. Deletion waits while an event is in flight.

CSV imports use actual timestamps with explicit offsets. No automatic qualification, intermediate milestones, email/SMS, advertising management, billing or multi-tenancy. No legal/regulatory claims are made by the UI.

The owner-approved sales workflow of 8 October 2026 adds structured results, one active next step per lead, and a visual pipeline. See [SALES-WORKFLOW.md](SALES-WORKFLOW.md) for the factual progress, task lifecycle, correction and compatibility contract. These activities are independent of the existing stage-to-Meta event contract.
