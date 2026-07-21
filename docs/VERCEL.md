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
`drizzle/0019_isolate_github_workspaces.sql` before enabling production
traffic. Migrations `0017` through `0019` are additive: `0018` installs the
Composio connection tables, and `0019` copies legacy GitHub App records into
tenant-scoped tables without dropping the legacy rows. Migration `0017` is
intentionally idempotent because earlier deployments applied that file manually
before it was added to the Drizzle journal.

## Application configuration

Set `WORLDMODEL_PUBLIC_ORIGIN` to the canonical `https://` production domain.
Until it is set, request-derived origins are used and the build emits a warning.
Then add the provider secrets needed for the features you intend to enable:

- Composio: `COMPOSIO_API_KEY`, `COMPOSIO_GITHUB_AUTH_CONFIG_ID`
- OpenAI: `OPENAI_API_KEY`, optionally `OPENAI_AGENT_MODEL`
- Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`
- GitHub Actions evidence exchange: `RUNNER_TOKEN_SECRET`
- Internal access: `WORLDMODEL_OPERATOR_EMAILS` and matching immutable account IDs in `WORLDMODEL_OPERATOR_USER_IDS` (both are required in production)

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
npm run build:vercel
```

After deployment, verify `/`, `/login`, and `/signup`. Then request
`/api/health`; it must return HTTP 200 with `{"status":"ok","storage":"durable"}`.
A 503 means the deployment must not be promoted. Finally, create a disposable
account and confirm it still exists after a second request and a new deployment.
Review Vercel Function logs for libSQL errors before enabling OAuth or billing.
