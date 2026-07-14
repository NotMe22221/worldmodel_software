# WorldModel for Software

A visual flight simulator and SaaS control plane for software systems. WorldModel maps a connected repository, injects repeatable failures, shows their impact on a critical journey, generates a Codex repair, replays the immutable scenario, and preserves the evidence for release review.

## Demo

1. Click **Start a simulation**, name the project, and select the prepared TypeScript repository.
2. Review the seven detected components, evidence confidence, disposable environment, and healthy baseline.
3. Confirm the structured payment-outage scenario and click **Run simulation**.
4. Follow the red propagation path from Stripe API through Checkout and Orders to the customer journey.
5. Click **Investigate with Codex**, inspect the code and regression-test diff, and replay the identical scenario.
6. Compare the verified metrics, download the risk-aware report, and prepare the draft PR.

The full path is deterministic and takes roughly 20 seconds. Traffic spike and database slowdown are available from the scenario rail and use the same run contract.

## Verified scope

- Landing page and uninterrupted five-step project setup
- Prepared TypeScript repository manifest with seven evidenced components and six dependencies
- Editable interactive system graph for `shopstream/demo-store`
- Disposable-environment specification and baseline health gate
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
- Explicit sample/customer workspace modes with one-click idempotent clean-workspace provisioning, isolated repositories and evidence, sample-labeled exports, and sample draft-PR publication denial
- Persisted customer activation milestones for repository connection, first simulation, verified replay, and team adoption, plus a sample-excluding operator conversion funnel
- Durable repository provenance that distinguishes samples, manual unverified entries, and installation-validated GitHub imports; ownership claims, activation, verification reports, and draft-PR handoff honor that boundary
- Simulation evidence provenance that labels prepared fixtures, deterministic modeled replays, and observed virtual-environment runs; reports and draft PRs carry the same disclosure
- Scoped and rate-limited CI ingestion for idempotent observed Playwright evidence with bounded metrics, scenario-contract validation, environment teardown attestations, and immediate key revocation
- Durable scenario fingerprints, replay evidence, metered simulation minutes, and tenant-isolated report downloads
- GitHub App install/OAuth ownership validation, installation-scoped repository sync, and repository import
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
- Responsive product and sub-three-minute demonstration path

## Local use

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. Validate with `npm test` and `npm run lint`.

## Production integrations

Copy the keys from `.env.example` into the Sites production environment rather than committing secrets. Configure the GitHub App setup URL as `/api/integrations/github/setup` and its OAuth callback as `/api/integrations/github/callback`. Grant repository **Contents: write** and **Pull requests: write** only if draft-PR publication is enabled. The connection flow validates a one-time workspace state and confirms the installation appears in the authorizing user’s accessible installations before saving repository metadata. Approved handoffs use a short-lived installation token to create an idempotent branch, commit the review packet under `.worldmodel/repairs/`, and open a draft pull request.

Configure Stripe Checkout prices for Starter and Pro, activate and brand the Stripe customer portal, then register `/api/billing/webhook` for `checkout.session.completed` and `customer.subscription.*` lifecycle events. Subscription limits change only after a fresh, matching raw-body webhook signature is processed. Portal sessions are created on demand only for authenticated workspace owners/admins with a linked Stripe customer and return to the same WorldModel origin.
