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

CRM and Analytics are in-page tabs. Both panels stay mounted after first use, preserving drafts, the current CRM route, report filters and the phone. Switching cannot discard data and does not invoke the navigation guard; route navigation still does. Arrow keys and Home/End select labelled panels. The browser URL remains the CRM route; a reload returns to CRM. Meta connection/demo controls are hidden in Analytics because they do not filter website reports.

Production CRM and Analytics share Supabase sign-in, administrator MFA and logout through one browser origin. CRM requires active owner/manager membership in the configured WebM8 workspace. Verified iframe readiness is required; loading times out with Reload/Open separately recovery. Expiry recovery retains the same user's drafts; switching identity reloads the workspace. No lead PII is sent, and individual lead activity is explicitly not linked. Source: the owner's 7 October 2026 request and ../../webm8-platform/docs/crm-workspace.md.

Every route sets its document title. Real links navigate; table row clicks navigate only outside nested buttons/selects and have an equivalent name link. Native dialog owns focus containment and inert background; restore focus on close. Destructive confirmation names the record and permanent removal, with danger intent and initial Cancel focus. Toast stays bottom-right and live; critical errors remain in context.

Unsaved forms block in-app link/navigation through an app-owned discard dialog, and page unload through beforeunload only. Modal close also checks dirty state. Mutation failure never clears input. Owner expiry locks the app with a reauthentication dialog and preserves current forms in memory; no personal-data drafts in local storage. Version conflicts return 409 and require refresh.

## Async and validation

Pessimistic writes; duplicate-submit guards. Remote reads use AbortController and ignore stale completions. Offline failures preserve inputs with retry. Server Zod schemas provide field errors; fields expose aria-invalid/describedby and focus the first error. Native popup behaviour is intentionally accepted for this English owner product. All mutation requests use CSRF and origin validation. Secrets are only configured on the server; the settings screen shows boolean configuration status.

## Verification

Typecheck, build, unit/integration tests, Playwright full-flow and accessibility checks, design lint and strict premium audit. Browser matrix: desktop and narrow mobile, keyboard, empty, failed requests, session expiry, reduced motion. Sibling comparison: leads and sync tables; lead and integration forms. Evidence: tests/crm.test.ts and tests/ui.spec.ts.

## Hosted delivery status

On Vercel, Integration distinguishes a configured private queue from a continuously running process. It shows the last completed queue cycle and persistent publication failures, and offers an authenticated background check. A server live lock is shown beside the existing explicit live confirmation. Source: docs/VERCEL.md and server/jobs.ts.

## Website intake and answer recovery

Website enquiries use the same lead detail and follow-up controls, labelled Website demo. Their website submission key is preserved; they do not impersonate Meta Instant Form leads. See docs/WEBSITE-INTAKE.md. Optional or malformed form answers must never hide contact details or actions. Test-mode delivery badges explicitly say Test.
