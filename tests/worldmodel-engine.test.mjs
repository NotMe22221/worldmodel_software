import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { calculateResilience, checkOrderIntegrity, immutableScenario, scenarioProfiles, scanManifest, verifyReplay } from "../worldmodel/simulation-engine.mjs";

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
