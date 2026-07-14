# WorldModel for Software

A visual flight simulator for software systems. The MVP maps a connected commerce repository, injects repeatable failures, shows their impact on a critical checkout journey, generates a Codex repair, replays the immutable scenario, and packages the evidence into a verification report and draft pull request.

## Demo

1. Open the Twin and click **Run simulation** with **Payment outage** selected.
2. Follow the red propagation path from Stripe API through Checkout and Orders to the customer journey.
3. Click **Investigate with Codex**, review the repair, and choose **Replay identical scenario**.
4. Compare the before/after metrics, open the verification report, and prepare the draft PR.

The full path is deterministic and takes roughly 20 seconds. Traffic spike and database slowdown are available from the scenario rail and use the same run contract.

## Verified scope

- Interactive seven-node system graph for `shopstream/demo-store`
- Traffic spike, database slowdown, and payment outage scenarios
- Six-step Playwright checkout journey fixture at `/journey-test`
- Codex repair flow with timeout, circuit breaker, idempotency, and durable retry strategy
- Immutable scenario replay with error rate, P95 latency, service health, resilience, and journey success
- Downloadable verification report and draft-PR artifact
- Responsive single-route demo designed for a sub-three-minute presentation

## Local use

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. Validate with `npm test` and `npm run lint`.
