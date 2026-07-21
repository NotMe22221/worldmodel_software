# Deploying WorldModel to Vercel

The repository contains a native Next.js build for Vercel. `vercel.json` forces
`npm run build:vercel` so Vercel uses the supported Next.js runtime.

## Required durable storage

Vercel Functions do not provide a durable local filesystem. The Vercel runtime
therefore connects to Turso/libSQL through the Vercel Marketplace integration.
It also stores bounded evidence artifacts in a dedicated table in the same
database.

Install Turso from the Vercel Marketplace and connect it to the project. Vercel
will provision these **server-only** variables for Production and Preview:

- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`

Never prefix either variable with `NEXT_PUBLIC_`. Data-backed requests fail
closed with `VERCEL_STORAGE_NOT_CONFIGURED` if either value is missing; the
application never falls back to temporary local storage.
Production builds fail with an explicit preflight error when durable storage is
incomplete. Preview builds warn, and `/api/health` returns HTTP 503 until durable
storage is configured and reachable.

Apply the registered migrations in numeric order through
`drizzle/0020_premium_dragon_lord.sql` before enabling production
traffic. Migrations `0017` through `0020` are additive: `0018` installs the
Composio connection tables, and `0019` copies legacy GitHub App records into
tenant-scoped tables without dropping the legacy rows. Migration `0020` adds
the Stripe event clock used to reject stale subscription updates. Migration `0017` is
intentionally idempotent because earlier deployments applied that file manually
before it was added to the Drizzle journal.

## Application configuration

Enable **Automatically expose System Environment Variables** in the Vercel
project settings. WorldModel uses the resulting
`VERCEL_PROJECT_PRODUCTION_URL` in Production and `VERCEL_URL` in Preview as
the canonical OAuth, billing, and runner origin. The deployment preflight fails
closed when those variables are unavailable. Set `WORLDMODEL_PUBLIC_ORIGIN`
only to select a different canonical `https://` domain. Then add the provider
secrets needed for the features you intend to enable:

- Composio: `COMPOSIO_API_KEY`, `COMPOSIO_GITHUB_AUTH_CONFIG_ID`
- OpenAI: `OPENAI_API_KEY`, optionally `OPENAI_AGENT_MODEL`
- Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`
- GitHub Actions evidence exchange: `RUNNER_TOKEN_SECRET`
- Internal access: `WORLDMODEL_OPERATOR_EMAILS` and matching immutable account IDs in `WORLDMODEL_OPERATOR_USER_IDS` (both are required in production)

For a scoped Composio project key, grant Connected accounts read/write and
Tool execution write. Grant Proxy execute write when enabling immutable archive
downloads, exact runner-workflow revision verification, or approved draft-PR
publication. Never place a provider key in source control or a support message.

Use the deployed origin for OAuth callbacks and `/api/billing/webhook` for the
Stripe webhook. Store secrets separately in Preview and Production.

## Execution boundary

The web application, authentication, workspace data, integrations, billing,
reports, and libSQL-backed evidence work on Vercel. Long-running campaign
execution remains unavailable until a compatible external execution control
plane and GitHub Actions runner adapter are connected. No second hosting runtime
is required; the product readiness screen reports the missing adapters as an
explicit configuration gap rather than fabricating a successful run.

## Verification

Before deploying:

```text
npm run lint
npm run test:unit
npm run build:local
```

Vercel itself runs `npm run build:vercel`; that command includes the
deployment-only environment preflight and intentionally fails in a normal local
shell where Vercel system variables are absent.

After deployment, verify `/`, `/login`, and `/signup`. Then request
`/api/health`; it must return HTTP 200 with `{"status":"ok","storage":"durable"}`.
A 503 means the deployment must not be promoted. Finally, create a disposable
account and confirm it still exists after a second request and a new deployment.
Review Vercel Function logs for libSQL errors before enabling OAuth or billing.
