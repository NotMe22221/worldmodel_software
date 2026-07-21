# OpenAI Build Week submission package

> Submission deadline: **Tuesday, July 21, 2026 at 5:00 PM Pacific / 7:00 PM Central**. The Devpost project description below is a draft. Edit it into your own voice before submitting; the host explicitly warns against submitting unedited AI-generated project descriptions.

## Recommended positioning

- **Project:** WorldModel for Software
- **Tagline:** Connect a repository, rehearse high-impact failures, and compare evidence-backed repairs before shipping.
- **Category:** Developer Tools
- **Live demo:** https://worldmodel-software.vercel.app
- **Repository:** https://github.com/NotMe22221/worldmodel_software
- **Thumbnail:** [`public/og-v2.png`](../../public/og-v2.png)
- **Supported platform:** Hosted web app on current desktop browsers; self-hosted Node.js 24 deployment on Vercel-compatible server functions

## Submission readiness

| Requirement | Status | Evidence or action |
| --- | --- | --- |
| Working project | Ready | Production health returns HTTP 200 with durable Turso storage. GitHub repository import returned HTTP 201 on July 21. |
| Category | Ready | Select **Developer Tools**. |
| Project description | Needs your edit | Personalize the draft below before submission. |
| Public YouTube demo under 3 minutes | Blocked on recording | Record the script below with voiceover and verify the link in an incognito window. |
| Voiceover covers the product, Codex, and GPT-5.6 | Ready to record | The script includes all three explicitly. |
| Repository URL | Ready | Use the public GitHub URL above. |
| Relevant public-repository license | Needs owner decision | Add the license you intend to grant. Do not let a tool choose your legal terms for you. |
| README setup and testing path | Ready | The root README includes local setup, deployment, judge quick start, supported platforms, and Codex/GPT-5.6 usage. |
| `/feedback` Codex Session ID | Needs your ID | Run `/feedback` in the primary Codex build task and paste the returned alphanumeric session ID. |
| Judge can test without rebuilding | Ready | Use the hosted demo and the instructions below. No provider credentials are entered by the user. |
| Team members accepted | Confirm in Devpost | Add every contributor and confirm each invitation is accepted. |
| Final submission is not a draft | Confirm in Devpost | After completing the form, use Devpost's final submit action. |

## Ready-to-paste custom fields

### Submitter Type

Choose the truthful value: `Individual`, `Team of Individuals`, or `Organization`.

### Country of Residence

Choose your actual country. Confirm that the official eligibility text applies to you: “Above legal age of majority in country of residence,” and select a country from the official included-territories list.

### Category

`Developer Tools`

### Code repository

`https://github.com/NotMe22221/worldmodel_software`

### Project URL and judge instructions

```text
Live demo: https://worldmodel-software.vercel.app

1. Create a workspace or sign in.
2. Open Integrations and click Connect GitHub.
3. Approve GitHub on the hosted consent page. No Composio credentials are requested from the user.
4. Select and import a TypeScript repository.
5. Open the imported project to review its exact-commit system model, environment manifest, bounded failure scenarios, evidence, and human approval gates.

The hosted product runs on Vercel with durable Turso/libSQL storage. Observed executions require a customer-owned GitHub Actions runner adapter; modeled planning and the repository/model review flow can be evaluated directly in the hosted demo.
```

### `/feedback` Session ID

`[PASTE THE SESSION ID RETURNED BY /feedback IN THE PRIMARY CODEX TASK]`

### Developer-tool installation, platforms, and testing

```text
Fastest testing path: use https://worldmodel-software.vercel.app in a current desktop browser; no rebuild is required.

Local installation:
1. Install Node.js 24.
2. Run npm install.
3. Copy the documented variables from .env.example into a local environment file.
4. Run npm run dev and open the printed URL.

Production deployment uses Vercel-compatible Next.js server functions and durable Turso/libSQL storage. Composio provides hosted GitHub OAuth. The README and docs/VERCEL.md contain the complete setup and smoke-test instructions.
```

## Project description draft — personalize before submitting

### Inspiration

Software teams usually discover whether a system can survive a dependency outage, latency spike, or payment failure after customers already feel it. I wanted a developer tool that turns those risks into reviewable, repeatable evidence before a release decision.

### What it does

WorldModel for Software connects a GitHub repository through one hosted consent flow, pins an exact commit, and builds a reviewable model of the system's components and dependencies. A team can approve an execution manifest, define critical journeys, draft bounded failure scenarios, replay identical conditions, compare repair candidates, and require a human decision before any repository write. Results clearly distinguish deterministic modeled evidence from observed evidence submitted by an isolated runner.

### How I built it

The product is a native Next.js and React application deployed on Vercel. Turso/libSQL stores workspaces, immutable repository provenance, run events, evidence, reports, approvals, provider connections, and rate limits. Composio hosts the one-click GitHub OAuth flow and repository discovery. OpenAI Responses powers strict, structured campaign drafting, while deterministic validators—not model prose—gate scenarios, manifests, evidence, scores, reports, and repair publication.

### How Codex and GPT-5.6 helped

I built the Build Week version in Codex with GPT-5.6. Codex let me work across the complete flow instead of treating each bug as an isolated file: React button, Next.js API route, Composio callback, Turso schema, and Vercel runtime. GPT-5.6 helped simplify GitHub onboarding to one click, diagnose a production-only missing-table failure, refactor schema initialization into an idempotent repair path, and verify the real import from browser to HTTP 201. It also accelerated the regression pass across 139 tests, lint, and a 47-route production build.

The important product and security decisions stayed explicit: users authorize GitHub themselves, provider credentials stay server-side, observed claims require signed runner evidence, and every sensitive change remains human-approved.

### Challenges

The hardest boundary was making a multi-provider flow feel simple without weakening it. The browser needed one button, but the server still had to bind OAuth state to a workspace, discover repositories with least privilege, persist immutable provenance, survive partially migrated production databases, and fail honestly when an optional execution adapter was absent.

### Accomplishments

- A real hosted product with tenant-backed authentication and durable storage
- One-click GitHub consent without asking users for Composio credentials
- Exact-commit repository models with provenance and review gates
- Evidence labels that distinguish modeled from observed execution
- Human approval boundaries for campaigns, repairs, reports, and draft pull requests
- Production verification through the UI, API, data layer, tests, and Vercel logs

### What I learned

A trustworthy agentic product is less about generating more prose and more about enforcing boundaries around what can be claimed or changed. Idempotent schema repair, immutable inputs, deterministic validators, explicit evidence types, and human approvals made the AI workflow substantially more useful.

### What's next

The next milestone is a packaged customer-owned GitHub Actions runner adapter, followed by richer repository-language coverage, stronger observability, and pilot feedback on which failure scenarios deliver the most release confidence.

## Demo video script — target 2:40

**0:00–0:18 — Problem and promise**
“This is WorldModel for Software. It helps engineering teams connect the system they actually ship, rehearse high-impact failures, and compare evidence-backed repairs before customers discover the failure first.”

**0:18–0:38 — Product overview**
Show the landing page and workflow screenshot. “The flow is repository to exact-commit model, bounded scenarios, identical replay, repair comparison, and a human release decision.”

**0:38–1:05 — One-click GitHub**
Open the live dashboard, choose Integrations, and click Connect GitHub. “The user clicks one button and approves GitHub on a hosted consent page. They never paste Composio credentials into WorldModel. OAuth state is workspace-bound and one-time.”

**1:05–1:35 — Import and model**
Select a repository, import it, and open the project. “WorldModel pins the selected commit, scans the TypeScript tree, and creates a reviewable component graph and environment manifest. Nothing runs against production by default.”

**1:35–2:05 — Scenarios, evidence, and repairs**
Show a scenario/project view or the landing workflow panel. “Teams define bounded incidents, compare runs under the same inputs, and keep modeled evidence separate from signed observed evidence. Agents can propose, but deterministic gates and people approve sensitive actions.”

**2:05–2:31 — Codex and GPT-5.6**
“I built this Build Week version in Codex with GPT-5.6. Codex traced the entire browser-to-database flow, simplified GitHub onboarding to one click, found a production schema gap, implemented an idempotent repair, and verified the real import as HTTP 201. The final regression pass covered 139 tests and a 47-route production build.”

**2:31–2:40 — Close**
“WorldModel turns reliability from a promise into reviewable evidence. The live demo and code are linked below.”

## Video upload checks

- Keep the final runtime below 3:00.
- Include audible narration; a silent screencast or music-only video is not valid.
- Say **Codex** and **GPT-5.6** explicitly and explain how each affected the build.
- Upload to YouTube and make it public as required by the submission form.
- Open the final link in an incognito window before pasting it into Devpost.
- Cut loading, typing, and OAuth wait time. Do not expose email addresses, passwords, tokens, or repository secrets in the recording.

## Screenshots

1. [Landing hero](screenshots/01-landing-hero.png) — product promise and system map
2. [Repository-to-decision workflow](screenshots/02-workflow.png) — end-to-end product flow
3. [Trust center](screenshots/03-trust-center.png) — boundaries and honest posture
4. [Authenticated dashboard](screenshots/04-dashboard.png) — live workspace experience
5. [One-click GitHub integration](screenshots/05-github-integration.png) — hosted OAuth path with no user-supplied Composio credentials
6. [Focused GitHub integration](screenshots/06-github-integration-focus.png) — close crop for a submission carousel or video cutaway

## Final evidence captured July 21, 2026

- Production URL: `https://worldmodel-software.vercel.app`
- Health: HTTP 200, `{"status":"ok","storage":"durable","platform":"vercel"}`
- GitHub repository import: `POST /api/integrations/composio/github/repositories` returned HTTP 201
- Production 5xx responses in the audited four-hour window: none
- GitHub connection button: one visible, enabled control in the live authenticated UI
- Automated tests: 139 passing
- Lint: passing
- TypeScript/Next.js production build: passing, 47 routes generated

## User-only blockers before final submission

1. Personalize the description above.
2. Choose the truthful submitter type and country.
3. Choose and add the public repository license you intend to grant.
4. Retrieve the primary `/feedback` Session ID.
5. Record and upload the narrated YouTube demo.
6. Confirm team invitations, add the video URL, and complete Devpost's final submit action.
