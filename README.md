# WorldModel for Software

A visual flight simulator for software systems. The MVP maps a connected commerce repository, injects repeatable failures, shows their impact on a critical checkout journey, generates a Codex repair, replays the immutable scenario, and packages the evidence into a verification report and draft pull request.

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
- Immutable scenario replay with error rate, P95 latency, service health, resilience, and journey success
- Executable checks for scanning, score improvement, replay fingerprints, and duplicate orders
- Downloadable verification report with residual risks and draft-PR artifact
- Responsive single-route demo designed for a sub-three-minute presentation

## Local use

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. Validate with `npm test` and `npm run lint`.
