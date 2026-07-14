import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { calculateResilience, checkOrderIntegrity, immutableScenario, scenarioProfiles, scanManifest, verifyReplay } from "../worldmodel/simulation-engine.mjs";
import { formatVerificationReport } from "../worldmodel/verification-report.mjs";
import { createHmac } from "node:crypto";
import { verifyStripeSignature } from "../server/stripe.ts";
import { authorizedInstallation } from "../server/github.ts";
import { safeCsvCell } from "../worldmodel/safe-csv.mjs";
import { launchReadiness } from "../server/readiness.ts";
import { digestApiToken, generateApiTokenMaterial } from "../worldmodel/api-key-security.mjs";
import { resolveEntitlements, usagePeriod } from "../worldmodel/entitlements.mjs";
import { digestInvitationSecret, generateInvitationSecret } from "../worldmodel/invitation-security.mjs";
import { repairCanTransition, repairTransition } from "../worldmodel/repair-workflow.mjs";

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

test("audit CSV export neutralizes spreadsheet formulas and escapes quotes", () => {
  assert.equal(safeCsvCell('=HYPERLINK("https://evil.test")'), '"\'=HYPERLINK(""https://evil.test"")"');
  assert.equal(safeCsvCell('review "ready"'), '"review ""ready"""');
});

test("commercial launch gate is derived from live state and owner attestations", () => {
  const baseline = launchReadiness({
    projects: [{}], runs: [{ status: "verified" }], githubInstallations: [], subscription: null, auditAccess: false,
    launchChecks: [
      { check_key: "legal_review", passed: 1, evidence: "Counsel review 2026-07-13" },
      { check_key: "security_review", passed: 1, evidence: "Independent assessment" },
      { check_key: "incident_plan", passed: 1, evidence: "Runbook owner assigned" },
      { check_key: "support_owner", passed: 1, evidence: "Support owner assigned" },
    ],
    configuration: { github: { configured: false }, billing: { configured: false } },
  });
  assert.equal(baseline.passed, 8);
  assert.equal(baseline.total, 10);
  assert.equal(baseline.ready, false);
  assert.match(baseline.checks.find((check) => check.key === "github_live").evidence, /credentials are missing/);

  const ready = launchReadiness({
    projects: [{}], runs: [{ status: "verified" }], githubInstallations: [{}], subscription: { status: "active" }, auditAccess: true,
    launchChecks: baseline.checks.filter((check) => check.source === "attested").map((check) => ({ check_key: check.key, passed: 1, evidence: check.evidence })),
    configuration: { github: { configured: true }, billing: { configured: true } },
  });
  assert.equal(ready.score, 100);
  assert.equal(ready.ready, true);
});

test("developer API credentials use one-time high-entropy material and irreversible stored digests", async () => {
  const first = generateApiTokenMaterial("key_securitytest");
  const second = generateApiTokenMaterial("key_securitytest");
  assert.match(first.token, /^wm_live_key_securitytest_[a-f0-9]{64}$/);
  assert.notEqual(first.token, second.token);
  assert.equal(first.keyPrefix, "wm_live_key_securitytest_…");
  const digest = await digestApiToken(first.token);
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.ok(!digest.includes(first.token));
});

test("workspace invitations use unique one-time secrets and irreversible stored digests", async () => {
  const first = generateInvitationSecret("inv_securitytest");
  const second = generateInvitationSecret("inv_securitytest");
  assert.match(first, /^wmi_inv_securitytest_[a-f0-9]{64}$/);
  assert.notEqual(first, second);
  const digest = await digestInvitationSecret(first);
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.ok(!digest.includes(first));
});

test("repair review state machine gates decisions and pull request handoff", () => {
  assert.equal(repairTransition("ready_for_review", "request-review"), "in_review");
  assert.equal(repairTransition("changes_requested", "request-review"), "in_review");
  assert.equal(repairTransition("in_review", "approve"), "approved");
  assert.equal(repairTransition("in_review", "request-changes"), "changes_requested");
  assert.equal(repairTransition("approved", "prepare-pr"), "pr_ready");
  assert.equal(repairCanTransition("ready_for_review", "prepare-pr"), false);
  assert.throws(() => repairTransition("pr_ready", "approve"), /not allowed/);
});

test("commercial entitlements follow trial, paid, delinquent, and canceled lifecycle states", () => {
  const now = new Date("2026-07-13T12:00:00Z");
  const workspace = { trial_ends_at: "2026-07-20T12:00:00Z" };
  const trial = resolveEntitlements({ workspace, subscription: null, now });
  assert.equal(trial.planKey, "pro_trial");
  assert.equal(trial.trialDaysRemaining, 7);
  assert.deepEqual(trial.limits, { simulationMinutes: 500, projects: 10, seats: 5, apiKeys: 2 });

  const starter = resolveEntitlements({ workspace, subscription: { status: "active", plan: "starter" }, now });
  assert.equal(starter.planKey, "starter");
  assert.equal(starter.canWrite, true);
  assert.deepEqual(starter.limits, { simulationMinutes: 150, projects: 3, seats: 1, apiKeys: 2 });

  const delinquent = resolveEntitlements({ workspace, subscription: { status: "past_due", plan: "pro" }, now });
  assert.equal(delinquent.planKey, "pro");
  assert.equal(delinquent.access, "read_only");
  assert.equal(delinquent.canWrite, false);

  const canceled = resolveEntitlements({ workspace, subscription: { status: "canceled", plan: "pro" }, now });
  assert.equal(canceled.planKey, "free");
  assert.equal(canceled.limits.apiKeys, 0);
});

test("usage periods roll over on calendar-month boundaries", () => {
  assert.deepEqual(usagePeriod(new Date("2026-12-31T23:59:59Z")), { start: "2026-12-01T00:00:00.000Z", end: "2027-01-01T00:00:00.000Z" });
});
