# UX Contract

## Product context

Owner-operated UK CRM, en-GB, GBP; display Europe/London, store UTC. Target WCAG 2.2 AA. Visual contract: [DESIGN.md](DESIGN.md), with runtime CSS token ownership.

## Business-context sources

| Domain                          | Source          | Type                                   |
| ------------------------------- | --------------- | -------------------------------------- |
| Permissions                     | docs/PRODUCT.md | Owner brief and domain contract        |
| Milestones, deliveries, revenue | docs/PRODUCT.md | Owner brief and domain contract        |
| Deletion, privacy               | docs/PRODUCT.md | Explicit owner-requested hard deletion |
| Market, language, dates         | docs/PRODUCT.md | Owner requirements                     |
| Billing, legal claims           | Not in scope    | MVP exclusion                          |

## Canonical UI Map

| Capability     | Canonical owner                        | Source of truth | Allowed variants                                         | Verification              |
| -------------- | -------------------------------------- | --------------- | -------------------------------------------------------- | ------------------------- |
| Select/Listbox | src/ui.tsx Field                       | This contract   | native platform popup accepted                           | Keyboard/browser          |
| Date           | src/ui.tsx Field and src/format.ts     | This contract   | native date and datetime-local, platform locale accepted | London DST tests/browser  |
| Form           | src/ui.tsx Form, Field, Submit         | This contract   | create/edit; noValidate                                  | Browser error recovery    |
| Scrollbar      | src/styles.css                         | DESIGN.md       | geometry only                                            | Computed style            |
| Toast          | src/ui.tsx ToastProvider               | This contract   | success/info/error                                       | Live-region browser test  |
| CRUD           | src/App.tsx routes and server/leads.ts | docs/PRODUCT.md | create returns list; edit stays detail                   | E2E                       |
| Dialog         | src/ui.tsx Modal                       | This contract   | native showModal, app-owned content                      | Focus/Escape/confirmation |

## Dataset navigation

Leads and events paginate on the server, 20 rows per page, with clamping. Date/stage/form/status/page/data filters are URL parameters. Search is transient in memory because it often contains contact PII; it debounces at 300ms, ignores IME composition, cancels stale requests, offers clear, and resets page. Detail back links retain filters. Empty/error/loading retain the table frame and offer recovery. No bulk selection.

On the initial Overview visit, select Demo data only when demo mode is active and synthetic records exist. With no synthetic records, default to Your leads even while Meta is disconnected.

## Flow ledger

| Operation            | Pending                                       | Success                                  | Failure                              | Source          |
| -------------------- | --------------------------------------------- | ---------------------------------------- | ------------------------------------ | --------------- |
| Create manual lead   | Disable submit                                | Close dialog, refresh list, toast        | Keep form, inline errors             | docs/PRODUCT.md |
| Edit lead/stage/note | Disable submit                                | Stay on lead, refresh, toast             | Keep values; conflicts offer refresh | docs/PRODUCT.md |
| Delete lead          | Cancel initially focused; dialog remains busy | Return to leads, toast                   | Keep dialog and error                | docs/PRODUCT.md |
| Import CSV           | Preview first, then explicit import           | Display counts and invalid row reasons   | Preserve file/mapping                | docs/PRODUCT.md |
| Enable live          | Explicit checkbox, then save                  | Stay in settings                         | Preserve form                        | docs/PRODUCT.md |
| Retry event          | Pessimistic action                            | Queue feedback; original event unchanged | Inline error                         | docs/PRODUCT.md |

## Navigation and feedback

CRM and Analytics are in-page tabs. Both panels stay mounted after first use, preserving drafts, the current CRM route, report filters and the phone. Switching cannot discard data and does not invoke the navigation guard; route navigation still does. Arrow keys and Home/End select labelled panels. The browser URL remains the CRM route; a reload returns to CRM. Meta connection/demo controls are hidden in Analytics because they do not filter website reports. At the owner’s request on 8 October, Analytics opens directly on the report without a heading, introduction or Open separately action. Its only report control is the labelled Refresh analytics icon in the shared top navigation; it reloads the report while preserving CRM drafts.

Production CRM and Analytics share Supabase sign-in, administrator MFA and logout through one browser origin. CRM requires active owner/manager membership in the configured WebM8 workspace. Verified iframe readiness is required; loading times out with guidance to use Refresh analytics in the navigation bar. Expiry recovery retains the same user's drafts; switching identity reloads the workspace. No lead PII is sent through the iframe. The lead’s Website activity panel reads permitted Analytics data and suggests possible visits; it never confirms identity. See docs/WEBSITE-ACTIVITY.md. Source: the owner's 7 October 2026 request and ../../webm8-platform/docs/crm-workspace.md.

Every route sets its document title. Real links navigate; table row clicks navigate only outside nested buttons/selects and have an equivalent name link. Native dialog owns focus containment and inert background; restore focus on close. Destructive confirmation names the record and permanent removal, with danger intent and initial Cancel focus. Toast stays bottom-right and live; critical errors remain in context.

Unsaved forms block in-app link/navigation through an app-owned discard dialog, and page unload through beforeunload only. Modal close also checks dirty state. Mutation failure never clears input. Owner expiry locks the app with a reauthentication dialog and preserves current forms in memory; no personal-data drafts in local storage. Version conflicts return 409 and require refresh.

## Async and validation

Pessimistic writes; duplicate-submit guards. Remote reads use AbortController and ignore stale completions. Per the owner’s 8 October request, `useLoad` has no polling interval. Views load on opening or changing their query, and after their existing save/refresh actions. Overview, Sync log and Website activity retain manual refresh. Incoming Meta notifications and website measurements are recorded independently of screen reads. Offline failures preserve inputs with retry. Server Zod schemas provide field errors; fields expose aria-invalid/describedby and focus the first error. Native popup behaviour is intentionally accepted for this English owner product. All mutation requests use CSRF and origin validation. Secrets are only configured on the server; the settings screen shows boolean configuration status.

## Verification

Typecheck, build, unit/integration tests, Playwright full-flow and accessibility checks, design lint and strict premium audit. Browser matrix: desktop and narrow mobile, keyboard, empty, failed requests, session expiry, reduced motion. Sibling comparison: leads and sync tables; lead and integration forms. Evidence: tests/crm.test.ts and tests/ui.spec.ts.

## Hosted delivery status

On Vercel, Integration distinguishes a configured private queue from a continuously running process. It shows the last completed queue cycle and persistent publication failures, and offers an authenticated background check. A server live lock is shown beside the existing explicit live confirmation. Source: docs/VERCEL.md and server/jobs.ts.

## Website intake and answer recovery

Website enquiries use the same lead detail and follow-up controls, labelled Website demo. Their website submission key is preserved; they do not impersonate Meta Instant Form leads. See docs/WEBSITE-INTAKE.md. Optional or malformed form answers must never hide contact details or actions. Test-mode delivery badges explicitly say Test.

## Possible website visits

`WebsiteActivityPanel` uses shared Button, Empty, ErrorState, useLoad and the existing panel tokens. Five possible visits and 25 measured pages per group are server-paginated. `activityVisit`, `activityVisits` and `activityPage` are URL state. These three parameters and read-only `historyPage` within the same lead bypass the navigation draft guard because all forms remain mounted; route, data scope and other query changes keep the guard. Browser tests verify both behaviours.

Every candidate is labelled possible, with timing, matching/conflicting ad tags and competing-lead counts. No probability, verified identity, conversion, or automatic CRM link is invented. Empty, expired, unconfigured and unavailable are distinct. Async reads are cancelled through useLoad; the checked timestamp remains visible. Inspecting another visit hides the previous visit’s detail while loading. The panel is independent of lead capture, notes, calls and Meta delivery.

## Lead desk (7 October 2026)

The approved route is `/leads`; `/` redirects there and Overview remains at `/overview`. The 8 October sales workflow below supersedes the original Lead desk default. `Leads` is the persistent parent route for `/leads/:id`. Search stays in memory across record selection and Back; date/stage/form/page/data filters remain in the URL. A selected record is keyed by lead ID, so unsaved state can never carry into a different lead. The existing navigation guard requires discarding or keeping edits before changing records. Read-only website activity paging preserves the same record and its forms.

The queue shows source, current stage and next follow-up (or received date), with 20 server-paginated records. It does not infer website activity for unselected leads or issue one activity query per row. Successful lead mutations invalidate the mounted queue through `crm:leads-changed`; background polling never reorders that queue. Filters and explicit refresh retain their existing cancellation/error behavior. Notes and all writes retain the existing canonical Form/Modal flow. On narrow screens the queue stays mounted but hidden during detail work, returning with search and filters intact.

Website activity uses the same API and comparison rules. Matching evidence and comparison methodology use native disclosures; conflicts and competing-lead warnings remain visible in the candidate summary. Qualification, stage history, Meta delivery and original answers remain available through labelled disclosures. CRM/Analytics remain mounted during platform switches.

Evidence: `tests/ui.spec.ts` covers queue search persistence, correct record selection, draft discard, a clean next record, mutation refresh, desktop/mobile layouts, keyboard and accessibility alongside existing CRUD/expiry/error cases.

## Sales workflow (8 October 2026)

Source: the owner approved the CRM recommendations and selected Sales pipeline. Domain decisions and compatibility guarantees live in [docs/SALES-WORKFLOW.md](docs/SALES-WORKFLOW.md).

`/leads` now defaults to Pipeline; `view=desk` retains the conversation queue. The owner’s compact-header request places view tabs, work filters and import/add actions in one row. Narrow screens keep the controls in a horizontally scrollable row; keyboard focus reveals off-screen actions. A visually hidden heading retains page context without duplicating the selected view label. Both use the same search, URL filters, canonical cards and record component. Lead receipt defaults to all time so an old overdue task is visible. Overview keeps its existing cohort date range. Work views are All leads, Untouched (New with no recorded result), Overdue, Today (London calendar day) and No next step. Their counts respect the other current filters. Sort options use actual receipt, task due dates or last recorded meaningful contact; notes never imply a conversation.

Pipeline shows eight cards per stage, full matching stage counts and an explicit View all link into the 20-row desk. Closed outcomes are separate links. No drag gesture can bypass the existing Change stage form. Filters, sort, selected view and lead remain in the URL. Card selection preserves search and focuses the record; mobile returns with Back to leads.

`src/lead-workflow.tsx` owns result, task and correction flows; it reuses `src/ui.tsx` Form/Field/Submit/Modal/ModalCancel. All saves are pessimistic. A result and its selected task completion/new follow-up save atomically. The operation identifier stays fixed across retries; failures keep form values. Conflicts preserve input and instruct closing/refreshing. Task completion and cancellation retain history. A correction keeps the original entry and reason visible and excludes it from progress.

Lead history merges notes, result/task entries and sales stages, with 30 entries per server-clamped page. `historyPage` changes preserve the same record and unsaved note; navigation to another lead/filter/view retains the draft guard. Activity timestamps display London time with named actors. Possible website visits stay in their separately labelled panel, with the established uncertainty rules.

Verification: `tests/workflow.test.ts` exercises SQLite/PostgreSQL mutations, retry identity, rollback, conflict, scope, pagination, reporting, migration and deletion. `tests/ui.spec.ts` exercises pipeline/desk, desktop/mobile, keyboard, accessibility, response loss after a committed save, correction, task lifecycle, real version conflict and history paging with a draft. Database transfer tests include tasks and activities.
