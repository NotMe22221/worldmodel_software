# Deploying WorldModel to Vercel

The repository contains a native Next.js build for Vercel. `vercel.json` forces
`npm run build:vercel` so Vercel does not accidentally run the Cloudflare
`vinext` build from the generic `build` script.

## Required durable storage

Vercel Functions do not provide Cloudflare Worker bindings or a durable local
filesystem. The Vercel runtime therefore connects to a Cloudflare D1 database
through its authenticated REST API. It also stores bounded evidence artifacts
in a dedicated table in the same D1 database.

Create a D1 database and configure these **server-only** Vercel environment
variables for Production and Preview:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_D1_DATABASE_ID`
- `CLOUDFLARE_D1_API_TOKEN`

The API token should be scoped to the selected account/database and only grant
D1 Read and D1 Write. Never prefix these variables with `NEXT_PUBLIC_`.
Data-backed requests fail closed with `VERCEL_STORAGE_NOT_CONFIGURED` if any
value is missing; the application never falls back to temporary SQLite storage.
The Vercel build warns when durable storage is incomplete but continues so the
public pages and explicit configuration state can be deployed. `/api/health`
continues to return HTTP 503 until durable storage is configured and reachable.

## Application configuration

Set `WORLDMODEL_PUBLIC_ORIGIN` to the canonical `https://` production domain.
Until it is set, request-derived origins are used and the build emits a warning.
Then add the provider secrets needed for the features you intend to enable:

- Composio: `COMPOSIO_API_KEY`, `COMPOSIO_GITHUB_AUTH_CONFIG_ID`
- OpenAI: `OPENAI_API_KEY`, optionally `OPENAI_AGENT_MODEL`
- Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`
- Runner callbacks: `RUNNER_EVIDENCE_SECRET`, `RUNNER_TOKEN_SECRET`
- Internal access: `WORLDMODEL_OPERATOR_EMAILS`

Use the deployed origin for OAuth callbacks and `/api/billing/webhook` for the
Stripe webhook. Store secrets separately in Preview and Production.

## Execution boundary

The web application, authentication, workspace data, integrations, billing,
reports, and D1-backed evidence work on Vercel. Cloudflare Durable Objects,
Workflows, and Sandbox bindings do not run inside Vercel Functions. Campaign
execution therefore remains unavailable until a compatible external execution
control plane is connected; the product readiness screen reports this as an
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
Review Vercel Function logs for D1 errors before enabling OAuth or billing.
