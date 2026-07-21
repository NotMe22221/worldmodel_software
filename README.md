# WorldModel for Software

A self-serve reliability platform for TypeScript systems. A customer connects a GitHub repository, approves an exact-commit model and executable manifest, defines critical journeys, asks the project AI to draft up to twenty tests, observes real isolated executions, investigates failures, compares three independently verified repairs, and explicitly approves any draft pull request.

## Product architecture

- Project-centered routes for model review, environment approval, journeys, persistent AI, campaigns, live replay, repair tournaments, and reports.
- Vercel runs the native Next.js application while Turso/libSQL persists workspace data, ordered run events, and bounded evidence artifacts.
- GitHub Actions is the only supported customer execution backend. The generated workflow uses GitHub OIDC and short-lived run tokens; no permanent WorldModel repository secret is generated.
- Automatic campaign dispatch requires a compatible external campaign orchestrator and runner adapter. Those adapters are not bundled, so production readiness fails closed until they are connected.
- Run replay uses authenticated HTTP polling over persisted events instead of a provider-specific live-event service.
- OpenAI Responses uses a strict `draft_campaign` function call with provider-side response storage disabled by default, while WorldModel records the model, response ID, prompt version, usage, tool arguments, validation, and approval state in its own durable database.
- Deterministic server validators—not model prose—gate manifests, scenarios, campaign limits, evidence promotion, candidate scores, report approval, sharing, and draft PR publication.

Customer metrics are labeled observed only after a configured runner submits a matching scenario fingerprint and seed plus teardown attestation. Missing providers fail closed with an actionable configuration state.

Every approved execution manifest must define a safe `observeCommand`. The runner sets `WORLDMODEL_EXECUTION_SPEC` to a protected JSON file containing the full immutable execution descriptor; the command must read its `.scenario` value and write the completed evidence payload to `.worldmodel/observed-run.json`. Existing approved environment revisions without `observeCommand` are intentionally rejected and must be replaced with a newly reviewed and approved revision.

## Judge quick start

The hosted demo is available at [worldmodel-software.vercel.app](https://worldmodel-software.vercel.app). Judges can test the primary repository-onboarding path without rebuilding the project:

1. Create a workspace or sign in.
2. Open **Integrations** and choose **Connect GitHub**.
3. Approve the hosted GitHub consent screen. Users do not enter Composio credentials; the platform owns that configuration.
4. Select a repository and import it. WorldModel records an immutable commit and builds the reviewable project model.
5. Open the imported project to inspect the model, environment manifest, bounded scenarios, verification evidence, and approval gates.

The product is a web application tested on current desktop browsers. Self-hosting requires Node.js 24, a Turso/libSQL database, and Vercel-compatible server functions. Composio is required for the one-click GitHub flow. OpenAI and runner credentials enable the corresponding AI and observed-execution features. No Cloudflare service is used.

## How Codex and GPT-5.6 were used

This Build Week version was developed in Codex with GPT-5.6. Codex traced the product across the React UI, Next.js route handlers, Composio OAuth, Turso/libSQL persistence, and Vercel runtime logs. GPT-5.6 helped identify and implement the high-leverage fixes while preserving security boundaries: simplifying GitHub connection to a single hosted-consent button, automatically repairing an incomplete production schema before repository import, and validating the result at the UI, API, storage, and deployment layers.

Codex also accelerated repository-wide regression work: the final GitHub import returned HTTP 201 in production, `/api/health` reported durable storage, the full test suite passed 139 tests, lint passed, and the native Next.js build generated all 47 routes. Key product decisions remained human-controlled, including provider permissions, repository writes, campaign approval, repair approval, and public licensing.

The OpenAI Build Week submission checklist, ready-to-personalize copy, demo script, and current screenshots are in [`docs/submission/OPENAI_BUILD_WEEK.md`](docs/submission/OPENAI_BUILD_WEEK.md).

## Verified scope

- Public SaaS landing page with real registration and sign-in entry points
- PBKDF2-hashed credentials, revocable HTTP-only sessions, protected application routes, and empty customer workspace provisioning
- Owner-only encrypted local provider configuration for Composio GitHub OAuth and OpenAI credentials; production uses Vercel environment secrets
- Exact-commit TypeScript repository modeling with evidence-linked components and dependencies
- Editable project graph, disposable-environment manifest, and baseline health gates
- Traffic spike, database slowdown, and payment outage scenarios
- Natural-language scenario interpretation with explicit safety limits
- Six-step Playwright checkout journey fixture at `/journey-test`
- Codex repair flow with a visible timeout, idempotency, queue, and regression-test patch
- Runnable Codex-generated checkout regression test in the prepared repository
- Immutable scenario replay with error rate, P95 latency, service health, resilience, and journey success
- Executable checks for scanning, score improvement, replay fingerprints, and duplicate orders
- Disposable virtual-lab harness that seeds data, starts five HTTP services, injects and recovers a fault, and destroys its temporary workspace
- Downloadable verification report with residual risks and draft-PR artifact
- Tenant-backed workspace with projects, run history, reports, usage, roles, integrations, and plan state
- Persisted customer activation milestones for repository connection, first simulation, verified replay, and team adoption
- Durable repository provenance that distinguishes manual unverified entries and installation-validated GitHub imports; ownership claims, activation, verification reports, and draft-PR handoff honor that boundary
- Simulation evidence provenance that labels prepared fixtures, deterministic modeled replays, and observed virtual-environment runs; reports and draft PRs carry the same disclosure
- Scoped and rate-limited CI ingestion for idempotent observed Playwright evidence with bounded metrics, scenario-contract validation, environment teardown attestations, and immediate key revocation
- Authenticated per-project GitHub Actions workflow downloads that reference CI-managed secrets, require a customer-owned disposable-test command, and submit the resulting evidence artifact without embedding credentials
- Customer activation and operator conversion KPIs that count modeled planning runs separately and require observed evidence for the verification milestone
- Installation-token GitHub tree scanning that persists an evidence-linked component graph, mapping summary, truncation disclosure, and scan timestamp for each verified project
- Durable scenario fingerprints, replay evidence, metered simulation minutes, and tenant-isolated report downloads
- Hosted Composio GitHub OAuth, workspace-bound one-time state, scoped repository sync/import, and exact-commit provenance; a custom GitHub App remains an advanced fallback
- Stripe-hosted subscription checkout with signed, idempotent entitlement webhooks
- Stripe-hosted customer portal sessions for owner/admin self-service payment methods, invoices, subscription changes, and cancellation
- Deny-by-default internal operator console for tenant health, commercial lifecycle, usage, and audited cross-tenant support operations without workspace impersonation
- Append-only tenant audit events with administrator-only spreadsheet-safe CSV export
- Role-aware JSON portability, reversible workspace deletion reviews, and an evidence-backed commercial launch gate
- Hashed, revocable developer API keys with least-privilege scopes, durable rate limiting, and CI-oriented project/run endpoints
- Durable 14-day trials, calendar-month usage rollover, Stripe-aware access states, and server-enforced project, seat, simulation, and API-key entitlements
- Durable support cases visible to the requester and workspace administrators
- Identity-bound, one-time team invitation links with hashed secrets, expiry, revocation, pending-seat accounting, workspace switching, role changes, removals, rate limiting, and audit evidence
- Durable Codex repair review queues with written approval evidence, enforced state transitions, residual-risk packets, role-gated decisions, and truthful draft-PR handoff status
- Public trust, security, privacy, pilot terms, and support disclosures that distinguish implemented controls from planned certifications
- Responsive project-centered product experience

## Local use

```bash
npm install
npm run dev
```

Open the URL printed by the dev server and create an account. New accounts begin with no prepared projects, runs, or reports. Local owners can configure a Composio project key, GitHub auth config, and optional OpenAI key at `/settings/providers`; credentials are encrypted before storage and never returned by the API.

Validate with `npm test` and `npm run lint`.

## Vercel deployment

Vercel uses the native Next.js build and a server-only Turso/libSQL database
adapter; it never uses temporary function storage for customer data. Follow
the required storage, environment, callback, execution-boundary, and smoke-test
steps in [`docs/VERCEL.md`](docs/VERCEL.md) before promoting a deployment.

## Production integrations

Copy the keys from `.env.example` into the production environment rather than committing secrets. Set the platform-owned `COMPOSIO_API_KEY`; `COMPOSIO_GITHUB_AUTH_CONFIG_ID` is only an optional override because WorldModel reuses or creates a Composio-managed GitHub auth config automatically. Keep Vercel's **Automatically expose System Environment Variables** project setting enabled. For a scoped Composio project key, grant Auth configs read/write, Connected accounts read/write, and Tool execution write; Proxy execute write is additionally required for immutable archive downloads, exact runner-workflow revision verification, and approved draft-PR publication. WorldModel then uses `VERCEL_PROJECT_PRODUCTION_URL` as the canonical production origin; set `WORLDMODEL_PUBLIC_ORIGIN` only to choose a different canonical HTTPS domain. Composio hosts GitHub consent and returns to `/api/integrations/composio/github/callback`. Request repository write permissions only when approved draft-PR publication is enabled. The custom GitHub App routes are an advanced fallback, not the primary connection shown to customers. GitHub Actions callbacks exchange a repository/branch/workflow-revision-bound OIDC assertion at `/api/v1/runner/token`; evidence is accepted once at `/api/v1/runner/evidence` with an expiring token.

Deploy the native Next.js application to Vercel, connect Turso, set `OPENAI_API_KEY` and a `RUNNER_TOKEN_SECRET` containing at least 32 random bytes (for example, from `openssl rand -hex 32`) when those features are enabled, and apply the registered migrations through `drizzle/0020_premium_dragon_lord.sql` in numeric order. Long-running execution is intentionally unavailable until a campaign orchestrator and GitHub Actions runner adapter are connected; the readiness screen reports that gap explicitly.

Configure Stripe Checkout prices for Starter and Pro, activate and brand the Stripe customer portal, then register `/api/billing/webhook` for `checkout.session.completed` and `customer.subscription.*` lifecycle events. Subscription limits change only after a fresh, matching raw-body webhook signature is processed. Portal sessions are created on demand only for authenticated workspace owners/admins with a linked Stripe customer and return to the same WorldModel origin.
