# WebM8 — Meta lead CRM

The **CRM / Analytics** tabs keep leads and website reporting in one workspace. Switching retains drafts, reports and active calls. Production uses one Supabase sign-in and serves Analytics at `/app` through Vercel rewrites. Configure `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `CRM_WORKSPACE_ID` and `CRM_AUTH_MODE=supabase`. See [configuration and deployment order](https://github.com/mrchreesa/webm8-platform/blob/main/docs/crm-workspace.md) and the [unified login and lead-journey plan](https://github.com/mrchreesa/webm8-platform/blob/main/docs/unified-workspace-plan.md). Use your Analytics account; the configured workspace requires owner/manager membership. Exact lead-to-visit matching is not yet implemented.

A team-authenticated React/Express CRM with PostgreSQL (Neon) or local SQLite storage, signed Meta leadgen webhooks, a durable retrieval inbox, and a persistent Conversions API outbox worker. GBP by default; London display and UTC storage. No external service is required for demo use.

## Run locally

Requires Node.js 22+ and npm. The API and worker must share the same database: `DATABASE_URL` selects PostgreSQL; when blank, `DATABASE_PATH` selects local SQLite.

```sh
npm ci
npm run setup
npm run demo
npm run dev
```

Open **http://localhost:5174**. Sign in with `owner@example.com` and the generated password printed once by setup. `npm run setup -- --email you@example.com` changes the owner email; set `OWNER_SETUP_PASSWORD` in your shell to supply a password (12+ characters) instead of generating one. Setup stores only a salted scrypt hash and invalidates prior sessions. `.env` and database files are private and ignored by Git. Rotate owner access for deployment.

`npm run dev` runs the API on 3001, Vite on 5174, and the worker. A production build is served by Express:

```sh
npm run build
npm start
# In another terminal/service, using the same environment and database:
npm run worker
```

For a local production build without HTTPS, keep `NODE_ENV=development` and set `APP_URL=http://localhost:3001`. Production requires HTTPS.

## Owner workflow

- Overview counts unique leads in a **received cohort**, using milestones, never delivery retries. Confirmed revenue is recorded value for leads currently Won.
- Leads provides search, stage/date/form/problem filters, quick stage changes, manual entry, CSV import and export.
- Lead detail holds contact data, qualification checklist, dates, sale value, notes, original IDs and stage history. Changes record your configured owner name.
- Meta integration shows credential configuration, mode, webhook callback and worker heartbeat.
- Sync log shows Pending, Accepted by Meta, Failed, Expired, or Not sent; retry keeps the original event ID/time. Authentication/permission/validation failures need intervention. Temporary failures retry automatically.

Demo data is visibly synthetic and permanently barred from sending. Real manual leads are CRM-only. Stage corrections create an audit entry without a new event, preserve attained milestones, and cannot retract accepted Meta events. Lost, Unqualified and Contacted are not positive qualification targets. The checklist never changes stage automatically.

## Connect and deploy

See [the setup guide](docs/SETUP.md) for Meta permissions, HTTPS webhooks, genuine test leads, dataset/funnel/ad-account configuration, and persistent deployment. See [architecture](docs/ARCHITECTURE.md) for transaction boundaries, queue ordering, leases, privacy and backups.

Copy `.env.example` only when creating a new environment; never overwrite an existing `.env` containing credentials. Configure `META_*` secrets on the server, then restart **both** services. Modes are saved in SQL. See [Neon migration and hosting](docs/NEON.md). Live cannot be enabled solely through an environment variable; enable it explicitly in the authenticated integration screen.

## Verify

```sh
npm test
npm run test:postgres
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
npm run format:check
```

Unit/integration tests use isolated temporary databases and fake Graph responses; the PostgreSQL suite runs PostgreSQL through PGlite. E2E uses an isolated synthetic workspace. Automated tests never send requests to Meta. Genuine Meta test-lead receipt and CAPI acceptance have been verified separately; **live customer delivery remains outstanding and disabled**. API acceptance is not evidence of matching, attribution, optimization eligibility or account-side funnel validation.

See [the verification report](docs/VERIFICATION.md) for acceptance coverage and outstanding external checks.

For Vercel hosting, see [the Vercel deployment and live release guide](docs/VERCEL.md). The hosted app uses Neon and a private queue; do not run an infinite worker in a Vercel Function.
