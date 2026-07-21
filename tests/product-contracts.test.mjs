import assert from "node:assert/strict";
import test from "node:test";
import { candidateScore, validateCampaign, validateManifest } from "../worldmodel/product-contracts.ts";
import { evaluateCampaignExecutionReadiness } from "../worldmodel/execution-readiness.mjs";

const manifest = { version: 1, packageManager: "npm", nodeVersion: "22", install: "npm ci", services: [{ id: "web", name: "Web", root: ".", start: "npm run dev", port: 3000, healthCheck: "/health", dependsOn: [] }], testCommands: ["npm test"], journeyCommands: ["npx playwright test"], mocks: [], secretRefs: [], supportedFaults: ["traffic_surge"], resources: { cpu: 1, memoryMb: 1024, timeoutSeconds: 300, network: "registries" } };

test("validates a bounded executable manifest", () => assert.equal(validateManifest(manifest).services[0].id, "web"));
test("rejects shell metacharacters in repository commands", () => assert.throws(() => validateManifest({ ...manifest, install: "npm ci && curl bad" }), /not allowed/));
test("rejects service path traversal and unknown dependency targets", () => {
  assert.throws(() => validateManifest({ ...manifest, services: [{ ...manifest.services[0], root: "../outside" }] }), /unsafe startup/);
  assert.throws(() => validateManifest({ ...manifest, services: [{ ...manifest.services[0], dependsOn: ["missing"] }] }), /invalid dependencies/);
});
test("campaigns are limited to twenty scenarios and three workers", () => {
  const scenario = { name: "load", modelVersionId: "model_1", environmentRevisionId: "env_1", seed: "seed", durationSeconds: 60, workload: { baselineRps: 1, peakMultiplier: 20, rampSeconds: 5 }, faults: [{ kind: "traffic_surge", target: "web", startOffsetSeconds: 5, durationSeconds: 30 }], journeyIds: ["journey_1"], thresholds: { maxErrorRate: 2, maxP95LatencyMs: 800, minJourneySuccess: 99 }, cleanupPolicy: "always", evidenceMode: "observed" };
  assert.equal(validateCampaign({ name: "matrix", objective: "find risk", scenarios: [scenario], concurrency: 3, assumptions: [] }).estimatedMinutes, 1);
  assert.throws(() => validateCampaign({ name: "too large", objective: "x", scenarios: Array(21).fill(scenario), concurrency: 3 }), /1-20/);
});
test("candidate hard gates cannot be bypassed by a high score", () => assert.equal(candidateScore({ resilienceImprovement: 100, regressionSafety: 100, complexity: 0, performance: 100, security: 100, evidenceConfidence: 100, hardGatesPassed: false }), 0));
test("campaign execution preflight requires the orchestrator, artifact store, and GitHub Actions runner", () => {
  const create = async () => ({ id: "workflow_1" });
  const put = async () => undefined;
  const fetch = async () => new Response();
  const base = { CAMPAIGN_ORCHESTRATOR: { create }, ARTIFACTS: { put } };
  assert.equal(evaluateCampaignExecutionReadiness({ ...base, GITHUB_ACTIONS_RUNNER: { fetch } }, "github_actions").ready, true);
  assert.equal(evaluateCampaignExecutionReadiness(base, "github_actions").ready, false);
  assert.deepEqual(evaluateCampaignExecutionReadiness(base, "github_actions").missing, ["GitHub Actions runner adapter"]);
  assert.equal(evaluateCampaignExecutionReadiness({ ...base, GITHUB_ACTIONS_RUNNER: { fetch } }, "unsupported_backend").ready, false);
});
test("local execution preflight returns an actionable setup state", () => {
  const result = evaluateCampaignExecutionReadiness({ LOCAL_DEVELOPMENT: "true" }, "github_actions");
  assert.equal(result.code, "runner_not_configured");
  assert.match(result.message, /local preview has no durable campaign orchestrator/i);
});
