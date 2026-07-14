import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { calculateResilience, checkOrderIntegrity, immutableScenario, scenarioProfiles, scanManifest, verifyReplay } from "../worldmodel/simulation-engine.mjs";
import { formatVerificationReport } from "../worldmodel/verification-report.mjs";
import { createHmac } from "node:crypto";
import { verifyStripeSignature } from "../server/stripe.ts";
import { authorizedInstallation } from "../server/github.ts";

test("repository scanner detects seven evidenced components", async () => {
  const manifest = JSON.parse(await readFile(new URL("../sample-app/worldmodel.manifest.json", import.meta.url)));
  const components = scanManifest(manifest);
  assert.equal(components.length, 7);
  assert.ok(components.every((component) => component.evidence.length > 0));
  assert.ok(components.every((component) => component.confidence === "verified"));
});

test("all three scenarios improve after the repair model", () => {
  for (const profile of Object.values(scenarioProfiles)) {
    assert.ok(profile.after.errors < profile.before.errors);
    assert.ok(profile.after.latencyMs < profile.before.latencyMs);
    assert.ok(profile.after.journeySuccess > profile.before.journeySuccess);
    assert.ok(calculateResilience(profile.after) > calculateResilience(profile.before));
  }
});

test("verification replays the identical immutable scenario", () => {
  const replay = verifyReplay(immutableScenario, { ...immutableScenario });
  assert.equal(replay.identical, true);
  assert.equal(replay.before, replay.after);
});

test("order integrity rejects duplicate idempotency keys", () => {
  assert.deepEqual(checkOrderIntegrity([{ idempotencyKey: "order-1" }, { idempotencyKey: "order-2" }]), { passed: true, duplicateOrders: 0, ordersChecked: 2 });
  assert.equal(checkOrderIntegrity([{ idempotencyKey: "order-1" }, { idempotencyKey: "order-1" }]).passed, false);
});

test("verification report preserves immutable replay evidence and before-after metrics", () => {
  const report = formatVerificationReport({
    id: "run_test", project_name: "Checkout resilience", repository: "shopstream/demo-store", branch: "main",
    scenario: "Payment outage", scenario_fingerprint: "scn_payment_503_45s_v1", seed: "seed_test", verified_at: "2026-07-13T23:42:00Z",
    before_score: 31, after_score: 94, before_error_rate: "32.1%", after_error_rate: "0.4%",
    before_latency_ms: 4060, after_latency_ms: 488, before_journey_success: 22, after_journey_success: 100,
  });
  assert.match(report, /Scenario fingerprint: scn_payment_503_45s_v1/);
  assert.match(report, /Resilience: 31 → 94/);
  assert.match(report, /Journey success: 22% → 100%/);
  assert.match(report, /tenant-owned simulation record/);
});

test("Stripe webhook verification accepts only a fresh matching raw-body signature", async () => {
  const body = '{"id":"evt_verified","type":"checkout.session.completed"}';
  const secret = "whsec_test_worldmodel";
  const timestamp = 1_800_000_000;
  const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  assert.equal(await verifyStripeSignature(body, `t=${timestamp},v1=${digest}`, secret, timestamp + 30), true);
  assert.equal(await verifyStripeSignature(`${body} `, `t=${timestamp},v1=${digest}`, secret, timestamp + 30), false);
  assert.equal(await verifyStripeSignature(body, `t=${timestamp},v1=${digest}`, secret, timestamp + 301), false);
});

test("GitHub connection accepts only an installation visible to the authorized user", () => {
  const installations = [{ id: 42, account: { login: "northstar", type: "Organization" }, repository_selection: "selected", permissions: { contents: "read" } }];
  assert.equal(authorizedInstallation(installations, "42")?.account.login, "northstar");
  assert.equal(authorizedInstallation(installations, "999"), null);
});
